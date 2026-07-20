from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Optional

from .catalog import SceneCatalog
from .pipeline import run_scene_diagnosis


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="autodrive-diagnose",
        description="Generate a deterministic facts-first ReportV2 diagnosis.",
    )
    parser.add_argument("--public-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--scene-key", required=True)
    parser.add_argument("--data-version", default="local-v2")
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    catalog = SceneCatalog(args.public_root, args.manifest)
    report = run_scene_diagnosis(
        catalog=catalog,
        scene_key=args.scene_key,
        data_version=args.data_version,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        report.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
