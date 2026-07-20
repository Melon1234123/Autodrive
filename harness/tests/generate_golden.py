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
            report = run_scene_diagnosis(catalog, scene_key, "golden-v2")
            summary[scene_key] = {
                "scene_name": report.meta.scene_name,
                "protected_facts_fingerprint": (
                    report.meta.protected_facts_fingerprint
                ),
                "generation_mode": report.meta.generation.mode,
                "overall": report.analysis.risk_profile.overall,
                "episode_count": len(report.evidence.timeline),
                "evidence_count": len(report.evidence.index),
                "limitations": report.support.limitations,
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
