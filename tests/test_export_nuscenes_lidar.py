from pathlib import Path

from scripts.export_nuscenes_lidar import crop_and_voxel_downsample, write_lidar_index


def test_crop_and_voxel_downsample_keeps_one_point_per_voxel():
    points = [(1.01, 1.01, 0.0, 0.2), (1.03, 1.02, 0.0, 0.8), (70.0, 0.0, 0.0, 1.0)]

    assert crop_and_voxel_downsample(points, max_range_m=60, voxel_m=0.5) == [
        (1.01, 1.01, 0.0, 0.2)
    ]


def test_write_lidar_index_uses_relative_frame_paths(tmp_path: Path):
    write_lidar_index(
        tmp_path,
        [{"time": 1.0, "timestampUs": 1000000, "file": "frames/000001.bin", "pointCount": 12}],
    )

    assert '"pointFormat": "xyzI-f32-le"' in (tmp_path / "index.json").read_text()
