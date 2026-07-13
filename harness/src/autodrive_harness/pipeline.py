from __future__ import annotations

from typing import Callable, Optional

from .catalog import SceneCatalog
from .causality import build_causal_chains
from .enhancement import ReportEnhancer, enhance_report
from .events import mine_risk_episodes
from .features import extract_features
from .models import (
    DiagnosisContext,
    DiagnosisProgress,
    DiagnosisReport,
    RiskScores,
    SceneFeatures,
)
from .reporting import assemble_report, prepare_report_context
from .scoring import score_scene
from .timeline import align_timeline
from .validation import validate_bundle


ProgressCallback = Callable[[DiagnosisProgress], None]


def _degraded_context(bundle, validation, data_version: str) -> DiagnosisContext:
    times = [row.time for row in bundle.telemetry] + [row.time for row in bundle.perception]
    duration = max(times) - min(times) if times else 0.0
    features = SceneFeatures(
        duration=max(0.0, duration),
        peak_speed=0.0,
        peak_abs_accel=0.0,
        peak_abs_jerk=0.0,
        peak_steering_rate=0.0,
        control_conflict_duration=0.0,
        object_peak=0,
        high_risk_object_peak=0,
        medium_risk_object_peak=0,
        tracking_continuity=0.0,
        trajectory_deviation=0.0,
        provenance={},
    )
    scores = RiskScores(
        perception=0,
        motion=0,
        control=0,
        trajectory=0,
        data_quality=validation.quality_score,
        overall=0,
        confidence=round(validation.quality_score / 100.0, 3),
    )
    return DiagnosisContext(
        bundle=bundle,
        validation=validation,
        samples=[],
        features=features,
        episodes=[],
        scores=scores,
        data_version=data_version,
    )


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
    if validation.usable:
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
    else:
        emit(DiagnosisProgress(stage="features", percent=42))
        emit(DiagnosisProgress(stage="events", percent=58))
        context = _degraded_context(bundle, validation, data_version)
    emit(DiagnosisProgress(stage="causality", percent=72))
    context, evidence_index = prepare_report_context(context)
    causal_chains = build_causal_chains(context, evidence_index)
    emit(DiagnosisProgress(stage="report", percent=86))
    report = assemble_report(
        context,
        causal_chains=causal_chains,
        evidence_index=evidence_index,
    )
    if enhancer is not None:
        emit(DiagnosisProgress(stage="enhancement", percent=94))
        report = enhance_report(report, enhancer)
    emit(DiagnosisProgress(stage="complete", percent=100))
    return report
