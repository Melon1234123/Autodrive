import json
from pathlib import Path

import pytest

from autodrive_harness.catalog import SceneCatalog


REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def real_catalog():
    return SceneCatalog(
        REPO_ROOT / "frontend" / "public",
        REPO_ROOT / "frontend" / "public" / "scenes.json",
    )


@pytest.fixture(scope="session")
def golden_summary():
    path = Path(__file__).parent / "golden" / "summary.json"
    return json.loads(path.read_text(encoding="utf-8"))
