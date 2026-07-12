import pytest

from autodrive_harness.models import SceneBundle
from autodrive_harness.timeline import TimelineAlignmentError, align_timeline


def bundle(telemetry_times, perception_times, lidar=True):
    telemetry = [
        {"time": time, "speedKmh": time * 100, "brake": time, "throttle": 0.2,
         "steering": time, "accel": time * 2, "scene": "fixture"}
        for time in telemetry_times
    ]
    perception = [
        {"time": time, "objects": [], "ego": {"x": time, "y": 0.0, "yaw": 0.0},
         "lanes": [], "plannedPath": []}
        for time in perception_times
    ]
    lidar_index = ([{"time": time, "file": f"{time}.bin", "pointCount": 1}
                    for time in perception_times] if lidar else None)
    return SceneBundle(scene_key="fixture", scene_name="测试场景", telemetry=telemetry,
                       perception=perception, metadata={}, lidar_index=lidar_index)


def test_alignment_preserves_source_and_interpolation_provenance():
    samples = align_timeline(bundle([0.0, 0.2], [0.0, 0.1, 0.2]), 0.1)
    assert [sample.time for sample in samples] == [0.0, 0.1, 0.2]
    assert samples[1].telemetry.provenance == "interpolated"
    assert samples[1].telemetry.value.speedKmh == pytest.approx(10.0)
    assert samples[1].telemetry.source_times == [0.0, 0.2]
    assert samples[1].perception.provenance == "nearest"
    assert samples[1].perception.source_times == [0.1]


def test_alignment_sorts_non_monotonic_inputs_and_degrades_missing_lidar():
    samples = align_timeline(bundle([0.2, 0.0], [0.2, 0.0], lidar=False), 0.1)
    assert [sample.time for sample in samples] == [0.0, 0.1, 0.2]
    assert samples[0].lidar.provenance == "unavailable"
    assert samples[0].lidar.value is None


def test_alignment_requires_positive_step_and_usable_modalities():
    with pytest.raises(ValueError):
        align_timeline(bundle([0.0], [0.0]), 0.0)
    with pytest.raises(TimelineAlignmentError):
        align_timeline(bundle([], [0.0]), 0.1)
