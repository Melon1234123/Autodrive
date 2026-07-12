from __future__ import annotations

import hashlib
import json
import tarfile
from pathlib import Path
from typing import Dict


FIXTURE_DIR = Path(__file__).parent / "fixtures"
ARCHIVE_PATH = FIXTURE_DIR / "ten-scenes.tar.gz"
FINGERPRINTS_PATH = FIXTURE_DIR / "input-sha256.json"


class InputFingerprintError(ValueError):
    pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _scene_files(scene_key: str) -> Dict[str, Path]:
    base = Path(".") if scene_key == "default" else Path("scenes") / scene_key
    return {
        "telemetry": base / "telemetry.json",
        "perception": base / "perception.json",
        "metadata": base / "dataset-meta.json",
        "lidar_index": (
            Path("scenes/default/lidar/index.json")
            if scene_key == "default"
            else base / "lidar/index.json"
        ),
    }


def load_frozen_fingerprints() -> Dict:
    return json.loads(FINGERPRINTS_PATH.read_text(encoding="utf-8"))


def extract_fixture(destination: Path) -> Path:
    frozen = load_frozen_fingerprints()
    archive_data = ARCHIVE_PATH.read_bytes()
    if _sha256(archive_data) != frozen["archive_sha256"]:
        raise InputFingerprintError("fixture archive SHA-256 mismatch")
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(ARCHIVE_PATH, mode="r:gz") as archive:
        members = archive.getmembers()
        for member in members:
            candidate = (destination / member.name).resolve()
            if destination != candidate and destination not in candidate.parents:
                raise InputFingerprintError("fixture archive contains an unsafe path")
            if not member.isfile():
                raise InputFingerprintError("fixture archive contains a non-file member")
        archive.extractall(destination, members=members)
    public_root = destination / "public"
    verify_input_fingerprints(public_root)
    return public_root


def verify_input_fingerprints(public_root: Path) -> Dict[str, str]:
    frozen = load_frozen_fingerprints()
    actual_combined: Dict[str, str] = {}
    for scene_key, expected in frozen["scenes"].items():
        combined = hashlib.sha256()
        for logical_name, relative_path in _scene_files(scene_key).items():
            data = (public_root / relative_path).read_bytes()
            actual = _sha256(data)
            if actual != expected["files"][logical_name]:
                raise InputFingerprintError(
                    f"input SHA-256 mismatch: {scene_key}/{logical_name}"
                )
            combined.update(logical_name.encode("utf-8"))
            combined.update(b"\0")
            combined.update(data)
            combined.update(b"\0")
        actual_combined[scene_key] = combined.hexdigest()
        if actual_combined[scene_key] != expected["combined"]:
            raise InputFingerprintError(f"combined input SHA-256 mismatch: {scene_key}")
    return actual_combined
