from autodrive_harness.causality import build_causal_chains
from autodrive_harness.models import DiagnosisContext


def high_risk_context(scene_key="internal-key", scene_name="城市路口侧向超车"):
    return DiagnosisContext.model_validate({
        "bundle": {
            "scene_key": scene_key,
            "scene_name": scene_name,
            "description": "路口中存在侧向超车与行人。",
            "telemetry": [{"time": 12.4, "speedKmh": 30, "brake": 0.7,
                           "throttle": 0.4, "steering": 0.1, "accel": -2}],
            "perception": [{"time": 12.4, "ego": {}, "objects": [{
                "id": "risk-object", "label": "行人", "category": "human.pedestrian.adult",
                "x": 4, "y": 1, "width": 1, "length": 1, "height": 1.7, "risk": "high",
            }], "lanes": [], "plannedPath": [{"x": 0, "y": 0.2}]}],
            "metadata": {},
            "lidar_index": None,
        },
        "validation": {"usable": True, "quality_score": 80, "findings": []},
        "samples": [{
            "time": 12.4,
            "telemetry": {"value": {"time": 12.4, "speedKmh": 30, "brake": 0.7,
                            "throttle": 0.4, "steering": 0.1, "accel": -2},
                          "provenance": "source", "source_times": [12.4]},
            "perception": {"value": {"time": 12.4, "ego": {}, "objects": [{
                             "id": "risk-object", "label": "行人",
                             "category": "human.pedestrian.adult", "x": 4, "y": 1,
                             "width": 1, "length": 1, "height": 1.7, "risk": "high",
                             }], "lanes": [], "plannedPath": [{"x": 0, "y": 0.2}]},
                           "provenance": "nearest", "source_times": [12.4]},
            "lidar": {"value": None, "provenance": "unavailable", "source_times": []},
        }],
        "features": {
            "duration": 0, "peak_speed": 30, "peak_abs_accel": 2,
            "peak_abs_jerk": 0, "peak_steering_rate": 0,
            "control_conflict_duration": 0.1, "object_peak": 0,
            "high_risk_object_peak": 0, "medium_risk_object_peak": 0,
            "tracking_continuity": 1, "trajectory_deviation": 0,
            "provenance": {"controls": "estimated"},
        },
        "episodes": [{
            "id": "ep-0001", "start_time": 12.3, "end_time": 12.6,
            "peak_time": 12.4, "risk": "high", "summary": "控制冲突持续出现。",
            "evidence_ids": ["ev-0001", "ev-0002", "ev-0003"],
            "control_conflict": True,
        }],
        "scores": {"perception": 20, "motion": 30, "control": 70, "trajectory": 10,
                   "data_quality": 80, "overall": 34, "confidence": 0.8},
        "data_version": "test-v1",
    })


def test_causal_chain_separates_observation_from_inference():
    chain = build_causal_chains(high_risk_context())[0]
    assert chain.observation.startswith("在 12.4 秒")
    assert chain.mechanism.startswith("推断：")
    assert chain.possible_impact.startswith("可能")
    assert chain.evidence_ids == ["ev-0002"]
    perception_chain = build_causal_chains(high_risk_context())[1]
    assert perception_chain.evidence_ids == ["ev-0001"]


def test_causal_chain_has_a_baseline_when_no_episode_exists():
    context = high_risk_context().model_copy(update={"episodes": []})
    chain = build_causal_chains(context)[0]
    assert chain.observation
    assert chain.confidence == 0.8
