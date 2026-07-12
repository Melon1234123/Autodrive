import json
from pathlib import Path

import pytest

from autodrive_harness.catalog import SceneCatalog

from fixture_support import extract_fixture


REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def real_catalog(tmp_path_factory):
    public_root = extract_fixture(tmp_path_factory.mktemp("ten-scenes-fixture"))
    return SceneCatalog(public_root, public_root / "scenes.json")


@pytest.fixture(scope="session")
def live_catalog():
    public_root = REPO_ROOT / "frontend" / "public"
    if not (public_root / "scenes" / "scene-0061" / "telemetry.json").exists():
        pytest.skip("live ten-scene assets are not present in this checkout")
    return SceneCatalog(public_root, public_root / "scenes.json")


@pytest.fixture(scope="session")
def golden_summary():
    path = Path(__file__).parent / "golden" / "summary.json"
    return json.loads(path.read_text(encoding="utf-8"))
