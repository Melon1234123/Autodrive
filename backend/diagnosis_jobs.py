from __future__ import annotations

import copy
import json
import logging
import threading
import uuid
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Deque, Dict, Optional, Tuple

from autodrive_harness import DiagnosisProgress, ReportV2
from autodrive_harness.pipeline import DiagnosisCancelled


logger = logging.getLogger(__name__)

CancellationCheck = Callable[[], bool]
RunPipeline = Callable[
    [str, str, Callable[[DiagnosisProgress], None], CancellationCheck], ReportV2
]


@dataclass
class DiagnosisJobRecord:
    job_id: str
    scene_key: str
    data_version: str
    stage: str = "queued"
    percent: int = 0
    report: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    cancelled: bool = False

    def public_snapshot(self) -> Dict[str, Any]:
        return {
            "jobId": self.job_id,
            "sceneKey": self.scene_key,
            "dataVersion": self.data_version,
            "stage": self.stage,
            "percent": self.percent,
            "report": copy.deepcopy(self.report),
            "error": self.error,
        }


class DiagnosisJobManager:
    def __init__(self, run_pipeline: RunPipeline, max_completed: int = 20):
        if max_completed < 1:
            raise ValueError("max_completed must be at least 1")
        self._run_pipeline = run_pipeline
        self._max_completed = max_completed
        self._jobs: Dict[str, DiagnosisJobRecord] = {}
        self._futures: Dict[str, Future[Any]] = {}
        self._dedupe: Dict[Tuple[str, str], str] = {}
        self._terminal: Deque[str] = deque()
        self._lock = threading.RLock()
        self._shutdown = False
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="diagnosis")

    @staticmethod
    def _copy_record(record: DiagnosisJobRecord) -> DiagnosisJobRecord:
        return DiagnosisJobRecord(
            job_id=record.job_id,
            scene_key=record.scene_key,
            data_version=record.data_version,
            stage=record.stage,
            percent=record.percent,
            report=copy.deepcopy(record.report),
            error=record.error,
            cancelled=record.cancelled,
        )

    def create(
        self,
        scene_key: str,
        data_version: str,
        force: bool = False,
    ) -> DiagnosisJobRecord:
        key = (scene_key, data_version)
        with self._lock:
            if self._shutdown:
                raise RuntimeError("诊断任务管理器已关闭")
            existing_job_id = self._dedupe.get(key)
            if existing_job_id is not None:
                existing = self._jobs.get(existing_job_id)
                if (
                    existing is not None
                    and existing.stage not in {"failed", "cancelled"}
                    and (not force or existing.stage != "complete")
                ):
                    return self._copy_record(existing)

            record = DiagnosisJobRecord(
                job_id=uuid.uuid4().hex,
                scene_key=scene_key,
                data_version=data_version,
            )
            self._jobs[record.job_id] = record
            self._dedupe[key] = record.job_id
            self._futures[record.job_id] = self._executor.submit(
                self._execute, record.job_id
            )
            return self._copy_record(record)

    def shutdown(self, wait: bool = True) -> None:
        with self._lock:
            self._shutdown = True
        self._executor.shutdown(wait=wait)

    def get(self, job_id: str) -> Optional[DiagnosisJobRecord]:
        with self._lock:
            record = self._jobs.get(job_id)
            return self._copy_record(record) if record is not None else None

    def cancel(self, job_id: str) -> Optional[DiagnosisJobRecord]:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                return None
            if record.stage in {"complete", "failed", "cancelled"}:
                return self._copy_record(record)

            self._mark_cancelled(record)
            future = self._futures.get(job_id)
            if future is not None:
                future.cancel()
            return self._copy_record(record)

    def _is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            record = self._jobs.get(job_id)
            return record is None or record.cancelled

    def _mark_cancelled(self, record: DiagnosisJobRecord) -> None:
        if record.cancelled:
            return
        record.cancelled = True
        record.stage = "cancelled"
        record.report = None
        record.error = None
        key = (record.scene_key, record.data_version)
        if self._dedupe.get(key) == record.job_id:
            self._dedupe.pop(key, None)
        self._add_terminal(record.job_id)

    def _publish_progress(self, job_id: str, progress: DiagnosisProgress) -> None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None or record.cancelled or record.stage in {"complete", "failed"}:
                return
            if progress.stage == "complete":
                return
            if progress.percent >= record.percent:
                record.stage = progress.stage
                record.percent = progress.percent

    @staticmethod
    def _serialize_report(report: Any) -> Dict[str, Any]:
        if hasattr(report, "model_dump"):
            payload = report.model_dump(mode="json")
        elif isinstance(report, dict):
            payload = copy.deepcopy(report)
        else:
            raise TypeError("diagnosis pipeline returned an unsupported report")
        if not isinstance(payload, dict):
            raise TypeError("diagnosis report must serialize to an object")
        json.dumps(payload, ensure_ascii=False)
        return payload

    def _execute(self, job_id: str) -> None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None or record.cancelled:
                return
            scene_key = record.scene_key
            data_version = record.data_version

        try:
            if self._is_cancelled(job_id):
                return
            report = self._run_pipeline(
                scene_key,
                data_version,
                lambda progress: self._publish_progress(job_id, progress),
                lambda: self._is_cancelled(job_id),
            )
            if self._is_cancelled(job_id):
                return
            serialized_report = self._serialize_report(report)
            if self._is_cancelled(job_id):
                return
        except DiagnosisCancelled:
            with self._lock:
                record = self._jobs.get(job_id)
                if record is not None:
                    self._mark_cancelled(record)
            return
        except Exception:
            with self._lock:
                record = self._jobs.get(job_id)
                if record is None or record.cancelled:
                    return
                record.stage = "failed"
                record.report = None
                record.error = "诊断任务执行失败，请检查场景数据后重试。"
                self._add_terminal(job_id)
                logger.exception("diagnosis pipeline failed for job %s", job_id)
            return

        with self._lock:
            record = self._jobs.get(job_id)
            if record is None or record.cancelled:
                return
            record.stage = "complete"
            record.percent = 100
            record.report = serialized_report
            record.error = None
            self._add_terminal(job_id)

    def _add_terminal(self, job_id: str) -> None:
        if job_id not in self._terminal:
            self._terminal.append(job_id)
            self._evict_terminal()

    def _evict_terminal(self) -> None:
        while len(self._terminal) > self._max_completed:
            evicted_job_id = self._terminal.popleft()
            evicted = self._jobs.pop(evicted_job_id, None)
            self._futures.pop(evicted_job_id, None)
            if evicted is None:
                continue
            key = (evicted.scene_key, evicted.data_version)
            if self._dedupe.get(key) == evicted_job_id:
                self._dedupe.pop(key, None)
