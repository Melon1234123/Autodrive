from autodrive_harness.events import mine_risk_episodes
from autodrive_harness.models import SceneFeatures

from test_features import sample


def features():
    return SceneFeatures(
        duration=0.3, peak_speed=10, peak_abs_accel=1, peak_abs_jerk=2,
        peak_steering_rate=1, control_conflict_duration=0, object_peak=1,
        high_risk_object_peak=1, medium_risk_object_peak=1,
        tracking_continuity=1, trajectory_deviation=0, provenance={},
    )


def object_with_risk(risk):
    return {"id": f"object-{risk}", "label": "目标", "category": "vehicle.car",
            "x": 5, "y": 0, "width": 2, "length": 4, "height": 1.5, "risk": risk}


def test_event_miner_merges_short_low_risk_gap_and_keeps_peak_anchor():
    levels = ["medium", "low", "high", "high"]
    samples = [sample(index / 10, objects=[object_with_risk(level)])
               for index, level in enumerate(levels)]
    episodes = mine_risk_episodes(samples, features())
    assert len(episodes) == 1
    assert episodes[0].peak_time == 0.2
    assert episodes[0].risk == "high"
    assert episodes[0].evidence_ids == ["ev-0001"]


def test_event_miner_drops_short_isolated_pulse():
    samples = [sample(0.0), sample(0.1, objects=[object_with_risk("high")]), sample(0.2)]
    assert mine_risk_episodes(samples, features()) == []


def test_event_miner_can_anchor_sustained_control_conflict():
    samples = [sample(index / 10, brake=0.7, throttle=0.5) for index in range(4)]
    episodes = mine_risk_episodes(samples, features())
    assert len(episodes) == 1
    assert episodes[0].control_conflict is True
