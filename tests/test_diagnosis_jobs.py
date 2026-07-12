import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from autodrive_harness import DiagnosisProgress

from backend.diagnosis_jobs import DiagnosisJobManager


def wait_for_stage(manager: DiagnosisJobManager, job_id: str, stage: str, timeout: float = 3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        record = manager.get(job_id)
        if record is not None and record.stage == stage:
            return record
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not reach {stage}")


def test_manager_deduplicates_concurrent_running_and_completed_jobs():
    started = threading.Event()
    release = threading.Event()

    def fake_pipeline(_scene_key, _data_version, progress_callback):
        progress_callback(DiagnosisProgress(stage="validation", percent=10))
        started.set()
        assert release.wait(2)
        return {"scene_name": "测试场景"}

    manager = DiagnosisJobManager(run_pipeline=fake_pipeline)
    with ThreadPoolExecutor(max_workers=12) as callers:
        records = list(callers.map(lambda _index: manager.create("default", "v1"), range(24)))

    assert started.wait(1)
    assert len({record.job_id for record in records}) == 1
    job_id = records[0].job_id
    release.set()
    wait_for_stage(manager, job_id, "complete")
    assert manager.create("default", "v1").job_id == job_id


def test_manager_deduplicates_a_job_waiting_in_the_executor_queue():
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

    manager = DiagnosisJobManager(run_pipeline=blocking_pipeline)
    manager.create("worker-a", "v1")
    manager.create("worker-b", "v1")
    assert workers_busy.wait(1)

    queued = manager.create("queued-scene", "v1")
    duplicate = manager.create("queued-scene", "v1")
    assert duplicate.job_id == queued.job_id
    release.set()


def test_manager_retries_failed_jobs_and_hides_internal_exception_details():
    attempts = 0

    def failing_pipeline(_scene_key, _data_version, _progress_callback):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("/Users/private/source.py\nTraceback: secret")

    manager = DiagnosisJobManager(run_pipeline=failing_pipeline)
    first = manager.create("default", "v1")
    failed = wait_for_stage(manager, first.job_id, "failed")

    assert failed.error
    assert any("\u4e00" <= character <= "\u9fff" for character in failed.error)
    assert "/Users" not in failed.error
    assert "Traceback" not in failed.error
    assert "secret" not in failed.error

    second = manager.create("default", "v1")
    assert second.job_id != first.job_id
    wait_for_stage(manager, second.job_id, "failed")
    assert attempts == 2


def test_manager_keeps_progress_monotonic_and_snapshot_contract_exact():
    regressed = threading.Event()
    release = threading.Event()

    def fake_pipeline(_scene_key, _data_version, progress_callback):
        progress_callback(DiagnosisProgress(stage="features", percent=42))
        progress_callback(DiagnosisProgress(stage="timeline", percent=18))
        regressed.set()
        assert release.wait(2)
        return {"scene_name": "测试场景", "data_version": "v1"}

    manager = DiagnosisJobManager(run_pipeline=fake_pipeline)
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


def test_manager_evicts_oldest_completed_job_and_its_dedupe_entry():
    def fake_pipeline(scene_key, data_version, _progress_callback):
        return {"scene_name": scene_key, "data_version": data_version}

    manager = DiagnosisJobManager(run_pipeline=fake_pipeline, max_completed=1)
    first = manager.create("default", "v1")
    wait_for_stage(manager, first.job_id, "complete")
    second = manager.create("scene-0061", "v1")
    wait_for_stage(manager, second.job_id, "complete")

    assert manager.get(first.job_id) is None
    assert manager.get(second.job_id) is not None
    replacement = manager.create("default", "v1")
    assert replacement.job_id != first.job_id
