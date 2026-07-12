from __future__ import annotations

from typing import List, Set

import numpy as np

from .models import SceneFeatures, TimelineSample


class FeatureExtractionError(ValueError):
    pass


def _peak_gradient(values: np.ndarray, time: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    dt = np.maximum(np.gradient(time), 1e-3)
    return float(np.max(np.abs(np.gradient(values) / dt)))


def _tracking_continuity(samples: List[TimelineSample]) -> float:
    if len(samples) < 2:
        return 1.0
    ids: List[Set[str]] = [
        {item.id for item in sample.perception.value.objects} for sample in samples
    ]
    similarities: List[float] = []
    for previous, current in zip(ids, ids[1:]):
        union = previous | current
        similarities.append(1.0 if not union else len(previous & current) / len(union))
    return float(round(sum(similarities) / len(similarities), 6))


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
