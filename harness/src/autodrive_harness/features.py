from __future__ import annotations

from typing import List, Set

import numpy as np

from .models import PerceptionRow, SceneBundle, SceneFeatures, TimelineSample


class FeatureExtractionError(ValueError):
    pass


def _peak_gradient(values: np.ndarray, time: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    dt = np.maximum(np.gradient(time), 1e-3)
    return float(np.max(np.abs(np.gradient(values) / dt)))


def _tracking_continuity_rows(rows: List[PerceptionRow]) -> float:
    if len(rows) < 2:
        return 1.0
    ids: List[Set[str]] = [
        {item.id for item in row.objects} for row in rows
    ]
    similarities: List[float] = []
    for previous, current in zip(ids, ids[1:]):
        union = previous | current
        similarities.append(1.0 if not union else len(previous & current) / len(union))
    return float(round(sum(similarities) / len(similarities), 6))


def _tracking_continuity(samples: List[TimelineSample]) -> float:
    return _tracking_continuity_rows([sample.perception.value for sample in samples])


def _trajectory_deviation(samples: List[TimelineSample]) -> float:
    lateral_offsets = [
        abs(point.y)
        for sample in samples
        for point in sample.perception.value.plannedPath
    ]
    return float(max(lateral_offsets, default=0.0))


def extract_features(samples: List[TimelineSample]) -> SceneFeatures:
    if not samples:
        raise FeatureExtractionError("at least one timeline sample is required")
    time = np.array([sample.time for sample in samples], dtype=float)
    speed = np.array([sample.telemetry.value.speedKmh for sample in samples], dtype=float)
    accel = np.array([sample.telemetry.value.accel for sample in samples], dtype=float)
    brake = np.array([sample.telemetry.value.brake for sample in samples], dtype=float)
    throttle = np.array([sample.telemetry.value.throttle for sample in samples], dtype=float)
    steering = np.array([sample.telemetry.value.steering for sample in samples], dtype=float)
    if len(samples) < 2:
        dt = np.zeros(1, dtype=float)
    else:
        dt = np.maximum(np.gradient(time), 1e-3)

    object_counts = [len(sample.perception.value.objects) for sample in samples]
    high_counts = [
        sum(item.risk == "high" for item in sample.perception.value.objects)
        for sample in samples
    ]
    medium_counts = [
        sum(item.risk == "medium" for item in sample.perception.value.objects)
        for sample in samples
    ]
    return SceneFeatures(
        duration=float(max(0.0, time[-1] - time[0])),
        peak_speed=float(max(0.0, np.max(speed))),
        peak_abs_accel=float(np.max(np.abs(accel))),
        peak_abs_jerk=_peak_gradient(accel, time),
        peak_steering_rate=_peak_gradient(steering, time),
        control_conflict_duration=float(np.sum(dt[(brake > 0.4) & (throttle > 0.2)])),
        object_peak=max(object_counts, default=0),
        high_risk_object_peak=max(high_counts, default=0),
        medium_risk_object_peak=max(medium_counts, default=0),
        tracking_continuity=_tracking_continuity(samples),
        trajectory_deviation=_trajectory_deviation(samples),
        provenance={
            "speed": "estimated",
            "controls": "estimated",
            "objects": "real-derived",
            "ego_pose": "real",
            "trajectory": "demo-visualization",
        },
    )


def extract_independent_features(bundle: SceneBundle) -> SceneFeatures:
    telemetry = sorted(bundle.telemetry, key=lambda row: row.time)
    perception = sorted(bundle.perception, key=lambda row: row.time)
    spans = [
        rows[-1].time - rows[0].time
        for rows in (telemetry, perception)
        if rows
    ]

    peak_speed = peak_abs_accel = peak_abs_jerk = peak_steering_rate = 0.0
    control_conflict_duration = 0.0
    if telemetry:
        time = np.array([row.time for row in telemetry], dtype=float)
        speed = np.array([row.speedKmh for row in telemetry], dtype=float)
        accel = np.array([row.accel for row in telemetry], dtype=float)
        steering = np.array([row.steering for row in telemetry], dtype=float)
        brake = np.array([row.brake for row in telemetry], dtype=float)
        throttle = np.array([row.throttle for row in telemetry], dtype=float)
        dt = np.zeros(1, dtype=float) if len(telemetry) < 2 else np.maximum(
            np.gradient(time), 1e-3
        )
        peak_speed = float(max(0.0, np.max(speed)))
        peak_abs_accel = float(np.max(np.abs(accel)))
        peak_abs_jerk = _peak_gradient(accel, time)
        peak_steering_rate = _peak_gradient(steering, time)
        control_conflict_duration = float(
            np.sum(dt[(brake > 0.4) & (throttle > 0.2)])
        )

    object_counts = [len(row.objects) for row in perception]
    high_counts = [
        sum(item.risk == "high" for item in row.objects) for row in perception
    ]
    medium_counts = [
        sum(item.risk == "medium" for item in row.objects) for row in perception
    ]
    trajectory_deviation = max(
        (abs(point.y) for row in perception for point in row.plannedPath),
        default=0.0,
    )
    provenance = {}
    if telemetry:
        provenance.update({"speed": "estimated", "controls": "estimated"})
    if perception:
        provenance.update({"objects": "real-derived", "ego_pose": "real"})
    if any(row.plannedPath for row in perception):
        provenance["trajectory"] = "demo-visualization"

    return SceneFeatures(
        duration=float(max(spans, default=0.0)),
        peak_speed=peak_speed,
        peak_abs_accel=peak_abs_accel,
        peak_abs_jerk=peak_abs_jerk,
        peak_steering_rate=peak_steering_rate,
        control_conflict_duration=control_conflict_duration,
        object_peak=max(object_counts, default=0),
        high_risk_object_peak=max(high_counts, default=0),
        medium_risk_object_peak=max(medium_counts, default=0),
        tracking_continuity=_tracking_continuity_rows(perception) if perception else 0.0,
        trajectory_deviation=float(trajectory_deviation),
        provenance=provenance,
    )
