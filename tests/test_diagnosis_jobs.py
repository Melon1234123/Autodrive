import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from autodrive_harness import DiagnosisProgress

from backend.diagnosis_jobs import DiagnosisJobManager


@pytest.fixture
def manager_pool():
    managers = []

    def create_manager(*args, **kwargs):
        manager = DiagnosisJobManager(*args, **kwargs)
        managers.append(manager)
        return manager

    yield create_manager
    for manager in managers:
        manager.shutdown(wait=True)


def wait_for_stage(manager: DiagnosisJobManager, job_id: str, stage: str, timeout: float = 3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        record = manager.get(job_id)
        if record is not None and record.stage == stage:
            return record
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not reach {stage}")


def test_manager_deduplicates_concurrent_running_and_completed_jobs(manager_pool):
    started = threading.Event()
    release = threading.Event()

    def fake_pipeline(_scene_key, _data_version, progress_callback):
        progress_callback(DiagnosisProgress(stage="validation", percent=10))
        started.set()
        assert release.wait(2)
        return {"scene_name": "测试场景"}

    manager = manager_pool(run_pipeline=fake_pipeline)
    with ThreadPoolExecutor(max_workers=12) as callers:
        records = list(callers.map(lambda _index: manager.create("default", "v1"), range(24)))

    assert started.wait(1)
    assert len({record.job_id for record in records}) == 1
    job_id = records[0].job_id
    release.set()
    wait_for_stage(manager, job_id, "complete")
    assert manager.create("default", "v1").job_id == job_id


def test_manager_deduplicates_a_job_waiting_in_the_executor_queue(manager_pool):
    started_count = 0
    started_lock = threading.Lock()
    workers_busy = threading.Event()
    release = threading.Event()

    def blocking_pipeline(scene_key, _data_version, _progress_callback):
        nonlocal started_count
        with started_lock:
            started_count += 1
            if started_count == 2:
                workers_busy.set()
        assert release.wait(2)
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=blocking_pipeline)
    running = [manager.create("worker-a", "v1"), manager.create("worker-b", "v1")]
    assert workers_busy.wait(1)

    queued = manager.create("queued-scene", "v1")
    duplicate = manager.create("queued-scene", "v1")
    assert duplicate.job_id == queued.job_id
    release.set()
    manager.shutdown(wait=True)
    assert [manager.get(record.job_id).stage for record in [*running, queued]] == [
        "complete", "complete", "complete",
    ]


def test_manager_retries_failed_jobs_logs_cause_and_hides_public_details(caplog, manager_pool):
    attempts = 0

    def failing_pipeline(_scene_key, _data_version, _progress_callback):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("/Users/private/source.py\nTraceback: secret")

    manager = manager_pool(run_pipeline=failing_pipeline)
    first = manager.create("default", "v1")
    failed = wait_for_stage(manager, first.job_id, "failed")

    assert failed.error
    assert any("\u4e00" <= character <= "\u9fff" for character in failed.error)
    assert "/Users" not in failed.error
    assert "Traceback" not in failed.error
    assert "secret" not in failed.error
    assert "diagnosis pipeline failed" in caplog.text
    assert "/Users/private/source.py" in caplog.text

    second = manager.create("default", "v1")
    assert second.job_id != first.job_id
    wait_for_stage(manager, second.job_id, "failed")
    assert attempts == 2


def test_shutdown_waits_for_running_and_queued_jobs_and_is_idempotent(manager_pool):
    started_count = 0
    started_lock = threading.Lock()
    workers_busy = threading.Event()
    release = threading.Event()
    shutdown_finished = threading.Event()
    shutdown_errors = []

    def blocking_pipeline(scene_key, _data_version, _progress_callback):
        nonlocal started_count
        with started_lock:
            started_count += 1
            if started_count == 2:
                workers_busy.set()
        assert release.wait(2)
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=blocking_pipeline)
    records = [manager.create(f"scene-{index}", "v1") for index in range(3)]
    assert workers_busy.wait(1)

    def shutdown_manager():
        try:
            manager.shutdown(wait=True)
        except Exception as exc:
            shutdown_errors.append(exc)
        finally:
            shutdown_finished.set()

    shutdown_thread = threading.Thread(target=shutdown_manager)
    shutdown_thread.start()
    try:
        assert not shutdown_finished.wait(0.05)
        release.set()
        shutdown_thread.join(2)
        assert shutdown_finished.is_set()
        assert not shutdown_errors
        assert [manager.get(record.job_id).stage for record in records] == [
            "complete", "complete", "complete",
        ]
        manager.shutdown(wait=True)
        with pytest.raises(RuntimeError, match="已关闭"):
            manager.create("after-shutdown", "v1")
    finally:
        release.set()
        shutdown_thread.join(2)


def test_manager_keeps_progress_monotonic_and_snapshot_contract_exact(manager_pool):
    regressed = threading.Event()
    release = threading.Event()

    def fake_pipeline(_scene_key, _data_version, progress_callback):
        progress_callback(DiagnosisProgress(stage="features", percent=42))
        progress_callback(DiagnosisProgress(stage="timeline", percent=18))
        regressed.set()
        assert release.wait(2)
        return {"scene_name": "测试场景", "data_version": "v1"}

    manager = manager_pool(run_pipeline=fake_pipeline)
    created = manager.create("default", "v1")
    assert regressed.wait(1)

    running = manager.get(created.job_id)
    assert running is not None
    assert running.percent == 42
    assert set(running.public_snapshot()) == {
        "jobId", "sceneKey", "dataVersion", "stage", "percent", "report", "error",
    }

    release.set()
    completed = wait_for_stage(manager, created.job_id, "complete")
    snapshot = completed.public_snapshot()
    assert snapshot["percent"] == 100
    assert snapshot["report"] == {"scene_name": "测试场景", "data_version": "v1"}
    json.dumps(snapshot, ensure_ascii=False)


def test_manager_evicts_oldest_completed_job_and_its_dedupe_entry(manager_pool):
    def fake_pipeline(scene_key, data_version, _progress_callback):
        return {"scene_name": scene_key, "data_version": data_version}

    manager = manager_pool(run_pipeline=fake_pipeline, max_completed=1)
    first = manager.create("default", "v1")
    wait_for_stage(manager, first.job_id, "complete")
    second = manager.create("scene-0061", "v1")
    wait_for_stage(manager, second.job_id, "complete")

    assert manager.get(first.job_id) is None
    assert manager.get(second.job_id) is not None
    replacement = manager.create("default", "v1")
    assert replacement.job_id != first.job_id
