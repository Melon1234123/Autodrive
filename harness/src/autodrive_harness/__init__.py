"""Deterministic, evidence-grounded scene diagnosis harness."""

from .catalog import SceneCatalog, SceneNotFoundError, UnsafeAssetPathError
from .models import DiagnosisProgress, DiagnosisReport
from .pipeline import run_scene_diagnosis

__all__ = [
    "DiagnosisProgress",
    "DiagnosisReport",
    "SceneCatalog",
    "SceneNotFoundError",
    "UnsafeAssetPathError",
    "run_scene_diagnosis",
]

__version__ = "0.1.0"
