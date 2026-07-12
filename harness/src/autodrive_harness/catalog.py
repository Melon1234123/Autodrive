from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

from .models import SceneBundle


APPROVED_SCENE_NAMES = {
    "scene-0061": "工区左转跟车",
    "scene-0103": "人车混流待转",
    "scene-0553": "斑马线母婴穿越",
    "scene-0655": "停车场行人横穿",
    "scene-0757": "繁忙路口公交博弈",
    "default": "城市路口侧向超车",
    "scene-0916": "停车区人车密集",
    "scene-1077": "夜间主干道施工",
    "scene-1094": "雨夜行人横穿",
    "scene-1100": "低照路口混行",
}


class SceneCatalogError(Exception):
    """Base error for scene catalog loading failures."""


class SceneNotFoundError(SceneCatalogError):
    pass


class UnsafeAssetPathError(SceneCatalogError):
    pass


class InvalidSceneManifestError(SceneCatalogError):
    pass


class SceneCatalog:
    def __init__(self, public_root: Path, manifest_path: Path):
        self.public_root = public_root.resolve()
        self.manifest_path = manifest_path.resolve()

    def _asset(self, manifest_value: str) -> Path:
        candidate = (self.public_root / manifest_value.lstrip("/")).resolve()
        if self.public_root != candidate and self.public_root not in candidate.parents:
            raise UnsafeAssetPathError(manifest_value)
        return candidate

    @staticmethod
    def _read_json(path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise InvalidSceneManifestError(str(path)) from exc

    def _load_optional_lidar(self, manifest_value: Optional[str]):
        if not manifest_value:
            return None
        index_path = self._asset(manifest_value)
        payload = self._read_json(index_path)
        if not isinstance(payload, dict) or not isinstance(payload.get("frames"), list):
            raise InvalidSceneManifestError("lidar index must contain a frames list")
        for frame in payload["frames"]:
            if not isinstance(frame, dict) or not isinstance(frame.get("file"), str):
                raise InvalidSceneManifestError("lidar frame must contain a file path")
            candidate = (index_path.parent / frame["file"]).resolve()
            if self.public_root != candidate and self.public_root not in candidate.parents:
                raise UnsafeAssetPathError(frame["file"])
        return payload["frames"]

    def load(self, scene_key: str) -> SceneBundle:
        approved_name = APPROVED_SCENE_NAMES.get(scene_key)
        if approved_name is None:
            raise SceneNotFoundError(scene_key)
        manifest = self._read_json(self.manifest_path)
        if not isinstance(manifest, dict) or not isinstance(manifest.get("scenes"), list):
            raise InvalidSceneManifestError("manifest must contain a scenes list")
        entry: Optional[Dict[str, Any]] = next(
            (item for item in manifest["scenes"] if item.get("id") == scene_key), None
        )
        if entry is None:
            raise SceneNotFoundError(scene_key)
        try:
            return SceneBundle(
                scene_key=scene_key,
                scene_name=approved_name,
                description=entry.get("description", ""),
                telemetry=self._read_json(self._asset(entry["telemetryFile"])),
                perception=self._read_json(self._asset(entry["perceptionFile"])),
                metadata=self._read_json(self._asset(entry["metadataFile"])),
                lidar_index=self._load_optional_lidar(entry.get("lidarIndexFile")),
            )
        except KeyError as exc:
            raise InvalidSceneManifestError(f"missing scene asset field: {exc.args[0]}") from exc
