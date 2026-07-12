import pytest

from autodrive_harness.models import RiskEpisode, SceneFeatures, ValidationResult
from autodrive_harness.scoring import score_scene


def high_risk_features():
    return SceneFeatures(
        duration=10, peak_speed=72, peak_abs_accel=9, peak_abs_jerk=30,
        peak_steering_rate=2.5, control_conflict_duration=1.2, object_peak=20,
        high_risk_object_peak=4, medium_risk_object_peak=8,
        tracking_continuity=0.55, trajectory_deviation=2.4, provenance={},
    )


def high_risk_episodes():
    return [RiskEpisode(
        id="ep-0001", start_time=1, end_time=2, peak_time=1.5, risk="high",
        summary="高风险目标持续存在。", evidence_ids=["ev-0001"],
        control_conflict=True,
    )]


def test_scoring_is_bounded_transparent_and_quality_weighted():
    validation = ValidationResult(usable=True, quality_score=70, findings=[])
    scores = score_scene(high_risk_features(), high_risk_episodes(), validation)
    assert all(0 <= value <= 100 for value in [
        scores.perception, scores.motion, scores.control, scores.trajectory, scores.overall,
    ])
    assert scores.confidence == pytest.approx(0.7)
    assert scores.data_quality == 70
    assert scores.overall == round(sum([
        scores.perception * .30, scores.motion * .22,
        scores.control * .23, scores.trajectory * .25,
    ]))


def test_scoring_is_deterministic_and_does_not_mutate_inputs():
    features = high_risk_features()
    episodes = high_risk_episodes()
    validation = ValidationResult(usable=True, quality_score=100, findings=[])
    first = score_scene(features, episodes, validation)
    second = score_scene(features, episodes, validation)
    assert first == second
    assert features.control_conflict_duration == 1.2
