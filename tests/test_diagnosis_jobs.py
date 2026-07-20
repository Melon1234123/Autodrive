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


def test_cancel_marks_an_active_job_as_cancelled(manager_pool):
    entered = threading.Event()
    release = threading.Event()

    def blocking_pipeline(*args):
        args[2](DiagnosisProgress(stage="validation", percent=10))
        entered.set()
        assert release.wait(2)
        return {"scene_name": "active"}

    manager = manager_pool(run_pipeline=blocking_pipeline)
    try:
        created = manager.create("active", "v2")
        assert entered.wait(1)

        cancelled = manager.cancel(created.job_id)
        assert cancelled is not None
        assert cancelled.stage == "cancelled"
    finally:
        release.set()


def test_manager_deduplicates_concurrent_running_and_completed_jobs(manager_pool):
    started = threading.Event()
    release = threading.Event()

    def fake_pipeline(_scene_key, _data_version, progress_callback, _cancelled):
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


def test_manager_force_reruns_completed_jobs_but_deduplicates_active_reruns(
    manager_pool,
):
    calls = []
    second_started = threading.Event()
    release_second = threading.Event()

    def pipeline(scene_key, _data_version, _progress_callback, _cancelled):
        calls.append(scene_key)
        if len(calls) == 2:
            second_started.set()
            assert release_second.wait(2)
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=pipeline)
    try:
        first = manager.create("default", "v1")
        wait_for_stage(manager, first.job_id, "complete")
        assert manager.create("default", "v1").job_id == first.job_id

        rerun = manager.create("default", "v1", force=True)
        assert rerun.job_id != first.job_id
        assert second_started.wait(1)
        assert manager.create("default", "v1", force=True).job_id == rerun.job_id
    finally:
        release_second.set()


def test_manager_deduplicates_a_job_waiting_in_the_executor_queue(manager_pool):
    started_count = 0
    started_lock = threading.Lock()
    workers_busy = threading.Event()
    release = threading.Event()

    def blocking_pipeline(scene_key, _data_version, _progress_callback, _cancelled):
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

    def failing_pipeline(_scene_key, _data_version, _progress_callback, _cancelled):
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

    def blocking_pipeline(scene_key, _data_version, _progress_callback, _cancelled):
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

    def fake_pipeline(_scene_key, _data_version, progress_callback, _cancelled):
        progress_callback(DiagnosisProgress(stage="features", percent=42))
        progress_callback(DiagnosisProgress(stage="evidence", percent=18))
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
    def fake_pipeline(scene_key, data_version, _progress_callback, _cancelled):
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


def test_manager_bounds_many_unique_failed_jobs(manager_pool):
    def failing_pipeline(_scene_key, _data_version, _progress_callback, _cancelled):
        raise RuntimeError("fixture failure")

    manager = manager_pool(run_pipeline=failing_pipeline, max_completed=2)
    records = []
    for index in range(5):
        record = manager.create(f"failed-{index}", "v1")
        wait_for_stage(manager, record.job_id, "failed")
        records.append(record)

    assert [manager.get(item.job_id) is not None for item in records] == [
        False, False, False, True, True,
    ]


def test_manager_evicts_oldest_terminal_job_across_complete_and_failed(manager_pool):
    def mixed_pipeline(scene_key, _data_version, _progress_callback, _cancelled):
        if scene_key.startswith("failed"):
            raise RuntimeError("fixture failure")
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=mixed_pipeline, max_completed=2)
    completed = manager.create("complete-a", "v1")
    wait_for_stage(manager, completed.job_id, "complete")
    failed = manager.create("failed-a", "v1")
    wait_for_stage(manager, failed.job_id, "failed")
    latest = manager.create("complete-b", "v1")
    wait_for_stage(manager, latest.job_id, "complete")

    assert manager.get(completed.job_id) is None
    assert manager.get(failed.job_id) is not None
    assert manager.get(latest.job_id) is not None
    retry = manager.create("complete-a", "v1")
    assert retry.job_id != completed.job_id


def test_cancelled_running_job_suppresses_late_report_and_progress(manager_pool):
    entered = threading.Event()
    release = threading.Event()

    def blocking_pipeline(_scene_key, _data_version, progress_callback, cancelled):
        progress_callback(DiagnosisProgress(stage="validation", percent=10))
        entered.set()
        assert release.wait(2)
        assert cancelled()
        progress_callback(DiagnosisProgress(stage="evidence", percent=78))
        return {"scene_name": "late-result"}

    manager = manager_pool(run_pipeline=blocking_pipeline)
    try:
        created = manager.create("default", "v2")
        assert entered.wait(1)

        cancelled = manager.cancel(created.job_id)
        assert cancelled is not None
        assert cancelled.stage == "cancelled"
        assert cancelled.percent == 10
        assert cancelled.report is None
        assert cancelled.error is None

        release.set()
        manager.shutdown(wait=True)
        final = manager.get(created.job_id)
        assert final is not None
        assert final.stage == "cancelled"
        assert final.percent == 10
        assert final.report is None
        assert final.error is None
    finally:
        release.set()


def test_cancelled_running_job_suppresses_a_late_pipeline_exception(
    caplog,
    manager_pool,
):
    entered = threading.Event()
    release = threading.Event()

    def blocking_pipeline(_scene_key, _data_version, progress_callback, cancelled):
        progress_callback(DiagnosisProgress(stage="validation", percent=10))
        entered.set()
        assert release.wait(2)
        assert cancelled()
        raise RuntimeError("late pipeline failure")

    manager = manager_pool(run_pipeline=blocking_pipeline)
    try:
        created = manager.create("default", "v2")
        assert entered.wait(1)
        assert manager.cancel(created.job_id).stage == "cancelled"

        release.set()
        manager.shutdown(wait=True)
        final = manager.get(created.job_id)
        assert final is not None
        assert final.stage == "cancelled"
        assert final.error is None
        assert "diagnosis pipeline failed" not in caplog.text
    finally:
        release.set()


def test_cancelled_queued_job_never_enters_the_pipeline(manager_pool):
    entered = []
    entered_lock = threading.Lock()
    workers_busy = threading.Event()
    release = threading.Event()

    def blocking_pipeline(scene_key, _data_version, _progress_callback, _cancelled):
        with entered_lock:
            entered.append(scene_key)
            if len(entered) == 2:
                workers_busy.set()
        assert release.wait(2)
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=blocking_pipeline)
    try:
        manager.create("worker-a", "v2")
        manager.create("worker-b", "v2")
        assert workers_busy.wait(1)
        queued = manager.create("queued-scene", "v2")

        cancelled = manager.cancel(queued.job_id)
        assert cancelled is not None
        assert cancelled.stage == "cancelled"

        release.set()
        manager.shutdown(wait=True)
        assert "queued-scene" not in entered
    finally:
        release.set()


def test_cancelling_releases_deduplication_for_an_immediate_new_run(manager_pool):
    first_entered = threading.Event()
    release_first = threading.Event()
    calls = []

    def blocking_pipeline(scene_key, _data_version, progress_callback, _cancelled):
        calls.append(scene_key)
        progress_callback(DiagnosisProgress(stage="validation", percent=10))
        if len(calls) == 1:
            first_entered.set()
            assert release_first.wait(2)
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=blocking_pipeline)
    try:
        first = manager.create("default", "v2")
        assert first_entered.wait(1)
        cancelled = manager.cancel(first.job_id)
        assert cancelled is not None
        assert cancelled.stage == "cancelled"

        replacement = manager.create("default", "v2")
        assert replacement.job_id != first.job_id

        release_first.set()
        completed = wait_for_stage(manager, replacement.job_id, "complete")
        assert completed.report == {"scene_name": "default"}
        assert manager.get(first.job_id).stage == "cancelled"
    finally:
        release_first.set()


def test_cancel_is_idempotent_and_preserves_completed_and_failed_snapshots(manager_pool):
    active_entered = threading.Event()
    release_active = threading.Event()

    def mixed_pipeline(scene_key, _data_version, progress_callback, _cancelled):
        if scene_key == "active":
            progress_callback(DiagnosisProgress(stage="validation", percent=10))
            active_entered.set()
            assert release_active.wait(2)
            return {"scene_name": "late-active"}
        if scene_key == "failed":
            raise RuntimeError("fixture failure")
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=mixed_pipeline)
    try:
        active = manager.create("active", "v2")
        assert active_entered.wait(1)
        first_cancel = manager.cancel(active.job_id)
        second_cancel = manager.cancel(active.job_id)
        assert first_cancel is not None
        assert second_cancel is not None
        assert first_cancel.public_snapshot() == second_cancel.public_snapshot()

        completed = manager.create("complete", "v2")
        completed_record = wait_for_stage(manager, completed.job_id, "complete")
        completed_snapshot = completed_record.public_snapshot()
        cancelled_completed = manager.cancel(completed.job_id)
        assert cancelled_completed is not None
        assert cancelled_completed.public_snapshot() == completed_snapshot

        failed = manager.create("failed", "v2")
        failed_record = wait_for_stage(manager, failed.job_id, "failed")
        failed_snapshot = failed_record.public_snapshot()
        cancelled_failed = manager.cancel(failed.job_id)
        assert cancelled_failed is not None
        assert cancelled_failed.public_snapshot() == failed_snapshot
    finally:
        release_active.set()


def test_cancelled_job_is_evicted_as_a_terminal_lru_entry_without_reappearing(manager_pool):
    active_entered = threading.Event()
    release_active = threading.Event()

    def mixed_pipeline(scene_key, _data_version, _progress_callback, _cancelled):
        if scene_key == "cancelled":
            active_entered.set()
            assert release_active.wait(2)
        return {"scene_name": scene_key}

    manager = manager_pool(run_pipeline=mixed_pipeline, max_completed=2)
    try:
        cancelled_job = manager.create("cancelled", "v2")
        assert active_entered.wait(1)
        assert manager.cancel(cancelled_job.job_id).stage == "cancelled"

        first_complete = manager.create("complete-a", "v2")
        wait_for_stage(manager, first_complete.job_id, "complete")
        second_complete = manager.create("complete-b", "v2")
        wait_for_stage(manager, second_complete.job_id, "complete")

        assert manager.get(cancelled_job.job_id) is None
        release_active.set()
        manager.shutdown(wait=True)
        assert manager.get(cancelled_job.job_id) is None
    finally:
        release_active.set()
