"""Deterministic, evidence-grounded scene diagnosis harness."""

from .catalog import SceneCatalog, SceneNotFoundError, UnsafeAssetPathError
from .fact_bundle import FactBundle, build_fact_bundle
from .models import DiagnosisProgress
from .pipeline import run_scene_diagnosis
from .report_v2 import GenerationMetadata, ReportV2, assemble_report_v2

__all__ = [
    "DiagnosisProgress",
    "FactBundle",
    "GenerationMetadata",
    "ReportV2",
    "SceneCatalog",
    "SceneNotFoundError",
    "UnsafeAssetPathError",
    "assemble_report_v2",
    "build_fact_bundle",
    "run_scene_diagnosis",
]

__version__ = "0.1.0"
