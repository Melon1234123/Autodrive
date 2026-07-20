from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_scene_builder_declares_all_authored_scene_ids():
    script = (ROOT / "scripts" / "build_demo_assets.sh").read_text(encoding="utf-8")
    for scene_id in (
        "default",
        "scene-0061",
        "scene-0103",
        "scene-0553",
        "scene-0655",
        "scene-0757",
        "scene-0916",
        "scene-1077",
        "scene-1094",
        "scene-1100",
    ):
        assert scene_id in script
    assert "default:scene-0796" in script
    assert "convert_nuscenes_rich.py" in script
    assert "export_nuscenes_lidar.py" in script
    assert "--scene-id" in script
