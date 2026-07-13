from __future__ import annotations

import json
import tempfile
from pathlib import Path

from autodrive_harness.catalog import SceneCatalog
from autodrive_harness.pipeline import run_scene_diagnosis

from fixture_support import extract_fixture, verify_input_fingerprints


TEN_SCENE_KEYS = [
    "scene-0061", "scene-0103", "scene-0553", "scene-0655", "scene-0757",
    "default", "scene-0916", "scene-1077", "scene-1094", "scene-1100",
]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="autodrive-golden-") as temp_dir:
        public_root = extract_fixture(Path(temp_dir))
        verify_input_fingerprints(public_root)
        catalog = SceneCatalog(public_root, public_root / "scenes.json")
        summary = {}
        for scene_key in TEN_SCENE_KEYS:
            report = run_scene_diagnosis(catalog, scene_key, "golden-v1")
            summary[scene_key] = {
                "scene_name": report.scene_name,
                "overall": report.scores.overall,
                "event_count": len(report.timeline),
                "historical_event_count": len(report.historical_risk_events),
            }
    output = Path(__file__).parent / "golden" / "summary.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(summary)} scene summaries to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
