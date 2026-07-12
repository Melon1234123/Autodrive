from __future__ import annotations

from typing import Iterable, List

from .models import DataQualityFinding, SceneBundle, TelemetryRow, ValidationResult


QUALITY_PENALTY = {"info": 1, "warning": 10, "error": 30}


def _finding(code: str, severity: str, modules: List[str], message: str) -> DataQualityFinding:
    return DataQualityFinding(
        code=code,
        severity=severity,
        affected_modules=modules,
        message=message,
    )


def _check_monotonic(modality: str, times: Iterable[float], findings: List[DataQualityFinding]) -> None:
    values = list(times)
    if any(current <= previous for previous, current in zip(values, values[1:])):
        findings.append(_finding(
            f"{modality}-time-non-monotonic",
            "warning",
            [modality],
            f"{modality} 时间戳非严格递增，对齐阶段将使用排序副本。",
        ))


def _check_ranges(rows: List[TelemetryRow], findings: List[DataQualityFinding]) -> None:
    if any(row.speedKmh < 0 for row in rows):
        findings.append(_finding(
            "telemetry-speed-negative", "warning", ["telemetry", "motion"],
            "检测到负车速，运动分析置信度降低。",
        ))
    if any(not 0.0 <= row.brake <= 1.0 or not 0.0 <= row.throttle <= 1.0 for row in rows):
        findings.append(_finding(
            "telemetry-control-out-of-range", "warning", ["telemetry", "control"],
            "制动或油门值超出 [0, 1] 的预期范围。",
        ))
    if any(abs(row.accel) > 30.0 for row in rows):
        findings.append(_finding(
            "telemetry-acceleration-outlier", "warning", ["telemetry", "motion"],
            "加速度存在大幅离群值，可能来自位姿差分估计。",
        ))


def validate_bundle(bundle: SceneBundle) -> ValidationResult:
    findings: List[DataQualityFinding] = []
    if not bundle.telemetry:
        findings.append(_finding(
            "telemetry-missing", "error", ["telemetry", "motion", "control"],
            "遥测序列缺失，无法执行运动与控制分析。",
        ))
    if not bundle.perception:
        findings.append(_finding(
            "perception-missing", "error", ["perception", "trajectory"],
            "感知序列缺失，无法执行目标与轨迹分析。",
        ))
    _check_monotonic("telemetry", (row.time for row in bundle.telemetry), findings)
    _check_monotonic("perception", (row.time for row in bundle.perception), findings)
    _check_ranges(bundle.telemetry, findings)
    if bundle.lidar_index is None:
        findings.append(_finding(
            "lidar-unavailable", "warning", ["lidar"],
            "点云索引缺失，点云一致性分析已降级。",
        ))
    elif not bundle.lidar_index:
        findings.append(_finding(
            "lidar-empty", "warning", ["lidar"],
            "点云索引不含帧，点云一致性分析已降级。",
        ))
    score = max(0, 100 - sum(QUALITY_PENALTY[item.severity] for item in findings))
    return ValidationResult(
        usable=bool(bundle.telemetry and bundle.perception),
        quality_score=score,
        findings=findings,
    )
