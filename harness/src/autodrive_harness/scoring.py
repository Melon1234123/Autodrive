from __future__ import annotations

from typing import List

from .models import RiskEpisode, RiskScores, SceneFeatures, ValidationResult


def _bounded(value: float) -> int:
    return max(0, min(100, round(value)))


def score_scene(
    features: SceneFeatures,
    episodes: List[RiskEpisode],
    validation: ValidationResult,
) -> RiskScores:
    high_episodes = sum(episode.risk == "high" for episode in episodes)
    medium_episodes = sum(episode.risk == "medium" for episode in episodes)
    perception = _bounded(
        features.high_risk_object_peak * 14
        + features.medium_risk_object_peak * 4
        + min(features.object_peak, 20) * 0.5
        + high_episodes * 12
        + medium_episodes * 6
        + (1.0 - features.tracking_continuity) * 20
    )
    motion = _bounded(
        max(0.0, features.peak_speed - 20.0) * 1.2
        + min(40.0, features.peak_abs_accel * 4.0)
        + min(25.0, features.peak_abs_jerk * 0.5)
    )
    control = _bounded(
        features.control_conflict_duration * 35.0
        + features.peak_steering_rate * 12.0
        + high_episodes * 8.0
        + medium_episodes * 3.0
    )
    trajectory = _bounded(
        features.trajectory_deviation * 30.0
        + (1.0 - features.tracking_continuity) * 15.0
        + high_episodes * 8.0
        + medium_episodes * 4.0
    )
    overall = round(
        perception * 0.30 + motion * 0.22 + control * 0.23 + trajectory * 0.25
    )
    return RiskScores(
        perception=perception,
        motion=motion,
        control=control,
        trajectory=trajectory,
        data_quality=validation.quality_score,
        overall=overall,
        confidence=round(validation.quality_score / 100.0, 3),
    )


def score_independent_modalities(
    features: SceneFeatures,
    validation: ValidationResult,
    *,
    telemetry_available: bool,
    perception_available: bool,
    trajectory_available: bool,
) -> RiskScores:
    factual = score_scene(features, [], validation)
    available_axes = sum([
        perception_available,
        telemetry_available,
        telemetry_available,
        trajectory_available,
    ])
    return RiskScores(
        perception=factual.perception if perception_available else None,
        motion=factual.motion if telemetry_available else None,
        control=factual.control if telemetry_available else None,
        trajectory=factual.trajectory if trajectory_available else None,
        data_quality=validation.quality_score,
        overall=None,
        confidence=round(
            validation.quality_score / 100.0 * available_axes / 4.0,
            3,
        ),
    )
