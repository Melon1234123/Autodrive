"""Deterministic, evidence-grounded scene diagnosis harness."""

from .catalog import SceneCatalog, SceneNotFoundError, UnsafeAssetPathError
from .models import DiagnosisProgress, DiagnosisReport

__all__ = [
    "DiagnosisProgress",
    "DiagnosisReport",
    "SceneCatalog",
    "SceneNotFoundError",
    "UnsafeAssetPathError",
]

__version__ = "0.1.0"
