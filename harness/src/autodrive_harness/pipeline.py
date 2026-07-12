from __future__ import annotations

from typing import Callable, Optional

from .catalog import SceneCatalog
from .causality import build_causal_chains
from .enhancement import ReportEnhancer, enhance_report
from .events import mine_risk_episodes
from .features import extract_features
from .models import DiagnosisContext, DiagnosisProgress, DiagnosisReport
from .reporting import assemble_report
from .scoring import score_scene
from .timeline import align_timeline
from .validation import validate_bundle


ProgressCallback = Callable[[DiagnosisProgress], None]


def run_scene_diagnosis(
    catalog: SceneCatalog,
    scene_key: str,
    data_version: str,
    progress_callback: Optional[ProgressCallback] = None,
    enhancer: Optional[ReportEnhancer] = None,
) -> DiagnosisReport:
    emit = progress_callback or (lambda _progress: None)
    bundle = catalog.load(scene_key)

    emit(DiagnosisProgress(stage="validation", percent=10))
    validation = validate_bundle(bundle)
    emit(DiagnosisProgress(stage="timeline", percent=24))
    samples = align_timeline(bundle)
    emit(DiagnosisProgress(stage="features", percent=42))
    features = extract_features(samples)
    emit(DiagnosisProgress(stage="events", percent=58))
    episodes = mine_risk_episodes(samples, features)
    scores = score_scene(features, episodes, validation)
    context = DiagnosisContext(
        bundle=bundle,
        validation=validation,
        samples=samples,
        features=features,
        episodes=episodes,
        scores=scores,
        data_version=data_version,
    )
    emit(DiagnosisProgress(stage="causality", percent=72))
    build_causal_chains(context)
    emit(DiagnosisProgress(stage="report", percent=86))
    report = assemble_report(context)
    if enhancer is not None:
        emit(DiagnosisProgress(stage="enhancement", percent=94))
        report = enhance_report(report, enhancer)
    emit(DiagnosisProgress(stage="complete", percent=100))
    return report
