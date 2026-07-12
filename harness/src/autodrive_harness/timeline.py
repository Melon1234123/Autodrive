from __future__ import annotations

from bisect import bisect_left
from typing import List, Sequence, TypeVar

import numpy as np

from .models import (
    LidarEvidence,
    LidarFrame,
    PerceptionEvidence,
    PerceptionRow,
    SceneBundle,
    TelemetryEvidence,
    TelemetryRow,
    TimelineSample,
)


class TimelineAlignmentError(ValueError):
    pass


T = TypeVar("T", PerceptionRow, LidarFrame)


def _nearest(rows: Sequence[T], time: float) -> T:
    return min(rows, key=lambda row: (abs(row.time - time), row.time))


def _interpolate_telemetry(rows: Sequence[TelemetryRow], time: float) -> TelemetryEvidence:
    times = [row.time for row in rows]
    index = bisect_left(times, time)
    if index < len(rows) and abs(rows[index].time - time) <= 1e-9:
        row = rows[index]
        return TelemetryEvidence(value=row, provenance="source", source_times=[row.time])

    right_index = min(max(index, 1), len(rows) - 1)
    left_index = right_index - 1
    left = rows[left_index]
    right = rows[right_index]
    width = right.time - left.time
    weight = 0.0 if width <= 0 else (time - left.time) / width

    def lerp(field: str) -> float:
        return float(getattr(left, field) + (getattr(right, field) - getattr(left, field)) * weight)

    value = TelemetryRow(
        time=time,
        speedKmh=lerp("speedKmh"),
        brake=lerp("brake"),
        throttle=lerp("throttle"),
        steering=lerp("steering"),
        accel=lerp("accel"),
        scene=left.scene if weight <= 0.5 else right.scene,
    )
    return TelemetryEvidence(
        value=value,
        provenance="interpolated",
        source_times=[left.time, right.time],
    )


def align_timeline(bundle: SceneBundle, step_seconds: float = 0.1) -> List[TimelineSample]:
    if step_seconds <= 0:
        raise ValueError("step_seconds must be positive")
    if not bundle.telemetry or not bundle.perception:
        raise TimelineAlignmentError("telemetry and perception are required for alignment")

    telemetry = sorted(bundle.telemetry, key=lambda row: row.time)
    perception = sorted(bundle.perception, key=lambda row: row.time)
    lidar = sorted(bundle.lidar_index or [], key=lambda row: row.time)
    start_time = max(telemetry[0].time, perception[0].time)
    end_time = min(telemetry[-1].time, perception[-1].time)
    if end_time < start_time:
        raise TimelineAlignmentError("telemetry and perception have no overlapping time range")

    raw_times = np.arange(start_time, end_time + step_seconds / 2.0, step_seconds)
    times = [float(round(time, 6)) for time in raw_times if time <= end_time + 1e-9]
    if not times:
        times = [float(round(start_time, 6))]

    samples: List[TimelineSample] = []
    for time in times:
        perception_row = _nearest(perception, time)
        if lidar:
            lidar_row = _nearest(lidar, time)
            lidar_evidence = LidarEvidence(
                value=lidar_row, provenance="nearest", source_times=[lidar_row.time]
            )
        else:
            lidar_evidence = LidarEvidence(
                value=None, provenance="unavailable", source_times=[]
            )
        samples.append(TimelineSample(
            time=time,
            telemetry=_interpolate_telemetry(telemetry, time),
            perception=PerceptionEvidence(
                value=perception_row,
                provenance="nearest",
                source_times=[perception_row.time],
            ),
            lidar=lidar_evidence,
        ))
    return samples
