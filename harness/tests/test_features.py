import pytest

from autodrive_harness.features import extract_features
from autodrive_harness.models import TimelineSample


def sample(time, brake=0.0, throttle=0.0, accel=0.0, steering=0.0,
           speed=10.0, objects=None, path=None):
    return TimelineSample.model_validate({
        "time": time,
        "telemetry": {
            "value": {"time": time, "speedKmh": speed, "brake": brake,
                      "throttle": throttle, "steering": steering, "accel": accel},
            "provenance": "source", "source_times": [time],
        },
        "perception": {
            "value": {"time": time, "objects": objects or [], "ego": {}, "lanes": [],
                      "plannedPath": path or []},
            "provenance": "nearest", "source_times": [time],
        },
        "lidar": {"value": None, "provenance": "unavailable", "source_times": []},
    })


def test_feature_engine_detects_control_conflict_and_jerk():
    samples = [
        sample(0.0, brake=0.0, throttle=0.2, accel=0.0),
        sample(0.1, brake=0.6, throttle=0.5, accel=-1.0),
        sample(0.2, brake=0.7, throttle=0.4, accel=1.0),
    ]
    result = extract_features(samples)
    assert result.control_conflict_duration > 0
    assert result.peak_abs_jerk > 0
    assert result.provenance["controls"] == "estimated"


def test_feature_engine_measures_tracking_and_path_deviation():
    shared = {"id": "object-a", "label": "行人", "category": "human.pedestrian.adult",
              "x": 5, "y": 1, "width": 1, "length": 1, "height": 1.7, "risk": "high"}
    result = extract_features([
        sample(0.0, objects=[shared], path=[{"x": 0, "y": 0}, {"x": 2, "y": 0.4}]),
        sample(0.1, objects=[shared], path=[{"x": 0, "y": 0}, {"x": 2, "y": 0.5}]),
    ])
    assert result.high_risk_object_peak == 1
    assert result.tracking_continuity == pytest.approx(1.0)
    assert result.trajectory_deviation == pytest.approx(0.5)


def test_feature_engine_handles_a_single_sample():
    result = extract_features([sample(0.0)])
    assert result.duration == 0
    assert result.peak_abs_jerk == 0
