from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_scene_builder_declares_all_authored_scene_ids():
    script = (ROOT / "scripts" / "build_demo_assets.sh").read_text(encoding="utf-8")
    scene_pairs = {
        "default": "scene-0796",
        "scene-0061": "scene-0061",
        "scene-0103": "scene-0103",
        "scene-0553": "scene-0553",
        "scene-0655": "scene-0655",
        "scene-0757": "scene-0757",
        "scene-0916": "scene-0916",
        "scene-1077": "scene-1077",
        "scene-1094": "scene-1094",
        "scene-1100": "scene-1100",
    }
    for authored_id, nuscenes_id in scene_pairs.items():
        assert f'"{authored_id}:{nuscenes_id}"' in script

    assert "convert_nuscenes_rich.py" in script
    assert "export_nuscenes_lidar.py" in script
    assert "--scene-id" in script

    converter_args = script.split(
        '"$PYTHON" "$ROOT/scripts/convert_nuscenes_rich.py"', maxsplit=1
    )[1].split('"$PYTHON" "$ROOT/scripts/export_nuscenes_lidar.py"', maxsplit=1)[0]
    assert "--manifest" not in converter_args
