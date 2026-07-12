from autodrive_harness.models import SceneBundle
from autodrive_harness.validation import validate_bundle


def bundle(telemetry_times, perception_times, lidar=True):
    telemetry = [
        {"time": time, "speedKmh": 10.0, "brake": 0.0, "throttle": 0.2,
         "steering": 0.0, "accel": 0.0, "scene": "fixture"}
        for time in telemetry_times
    ]
    perception = [
        {"time": time, "objects": [], "ego": {"x": 0.0, "y": 0.0, "yaw": 0.0},
         "lanes": [], "plannedPath": []}
        for time in perception_times
    ]
    lidar_index = ([{"time": time, "file": "frame.bin", "pointCount": 1}
                    for time in perception_times] if lidar else None)
    return SceneBundle(scene_key="fixture", scene_name="测试场景", telemetry=telemetry,
                       perception=perception, metadata={}, lidar_index=lidar_index)


def test_validation_reports_non_monotonic_time_without_hiding_usable_modalities():
    result = validate_bundle(bundle([0.0, 0.2, 0.1], [0.0, 0.1]))
    assert result.usable is True
    assert result.quality_score < 100
    assert any(item.code == "telemetry-time-non-monotonic" for item in result.findings)


def test_validation_reports_missing_modalities_as_unusable():
    result = validate_bundle(bundle([], [0.0], lidar=False))
    assert result.usable is False
    assert any(item.code == "telemetry-missing" and item.severity == "error"
               for item in result.findings)
    assert any(item.code == "lidar-unavailable" for item in result.findings)


def test_validation_reports_control_ranges_without_mutating_source():
    source = bundle([0.0], [0.0])
    source.telemetry[0].brake = 1.5
    result = validate_bundle(source)
    assert any(item.code == "telemetry-control-out-of-range" for item in result.findings)
    assert source.telemetry[0].brake == 1.5
