from __future__ import annotations

from typing import Callable, Optional

from .catalog import SceneCatalog
from .events import mine_risk_episodes
from .features import extract_features, extract_independent_features
from .models import (
    DiagnosisContext,
    DiagnosisProgress,
)
from .narrative import (
    NarrativeComposer,
    NarrativeCompositionCancelled,
    compose_report,
)
from .report_v2 import ReportV2
from .reporting import (
    build_deterministic_facts,
    prepare_report_context,
    report_progress,
)
from .scoring import score_independent_modalities, score_scene
from .timeline import align_timeline
from .validation import validate_bundle


ProgressCallback = Callable[[DiagnosisProgress], None]
CancellationCheck = Callable[[], bool]


class DiagnosisCancelled(NarrativeCompositionCancelled):
    """Signals that a diagnosis must end without publishing a result."""


def raise_if_cancelled(cancelled: Optional[CancellationCheck]) -> None:
    if cancelled is not None and cancelled():
        raise DiagnosisCancelled()


class _CancellationAwareComposer:
    def __init__(self, composer: NarrativeComposer, cancelled: Optional[CancellationCheck]):
        self._composer = composer
        self._cancelled = cancelled

    def compose(self, projection):
        raise_if_cancelled(self._cancelled)
        payload = self._composer.compose(projection)
        raise_if_cancelled(self._cancelled)
        return payload


def _degraded_context(
    bundle,
    validation,
    data_version: str,
    cancelled: Optional[CancellationCheck] = None,
) -> DiagnosisContext:
    raise_if_cancelled(cancelled)
    features = extract_independent_features(bundle)
    raise_if_cancelled(cancelled)
    scores = score_independent_modalities(
        features,
        validation,
        telemetry_available=bool(bundle.telemetry),
        perception_available=any(row.objects for row in bundle.perception),
        trajectory_available=any(row.plannedPath for row in bundle.perception),
    )
    raise_if_cancelled(cancelled)
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
    composer: Optional[NarrativeComposer] = None,
    model_name: Optional[str] = None,
    cancelled: Optional[CancellationCheck] = None,
) -> ReportV2:
    emit = progress_callback or (lambda _progress: None)
    raise_if_cancelled(cancelled)
    bundle = catalog.load(scene_key)

    raise_if_cancelled(cancelled)
    report_progress(emit, "validation", 10)
    validation = validate_bundle(bundle)
    raise_if_cancelled(cancelled)
    raise_if_cancelled(cancelled)
    report_progress(emit, "alignment", 24)
    if validation.usable:
        samples = align_timeline(bundle)
        raise_if_cancelled(cancelled)
        raise_if_cancelled(cancelled)
        report_progress(emit, "features", 42)
        features = extract_features(samples)
        raise_if_cancelled(cancelled)
        raise_if_cancelled(cancelled)
        report_progress(emit, "events", 58)
        episodes = mine_risk_episodes(samples, features)
        raise_if_cancelled(cancelled)
        scores = score_scene(features, episodes, validation)
        raise_if_cancelled(cancelled)
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
        raise_if_cancelled(cancelled)
        report_progress(emit, "features", 42)
        raise_if_cancelled(cancelled)
        report_progress(emit, "events", 58)
        context = _degraded_context(bundle, validation, data_version, cancelled)
        raise_if_cancelled(cancelled)
    raise_if_cancelled(cancelled)
    report_progress(emit, "evidence", 78)
    context, evidence_index = prepare_report_context(context)
    raise_if_cancelled(cancelled)
    raise_if_cancelled(cancelled)
    facts = build_deterministic_facts(context, evidence_index)
    raise_if_cancelled(cancelled)
    if composer is not None:
        raise_if_cancelled(cancelled)
        report_progress(emit, "narrative", 86)
        report = compose_report(
            facts,
            _CancellationAwareComposer(composer, cancelled),
            model_name,
        )
        raise_if_cancelled(cancelled)
        raise_if_cancelled(cancelled)
        report_progress(emit, "report", 92)
        raise_if_cancelled(cancelled)
    else:
        raise_if_cancelled(cancelled)
        report_progress(emit, "report", 92)
        report = compose_report(facts, None, model_name)
        raise_if_cancelled(cancelled)
    raise_if_cancelled(cancelled)
    report_progress(emit, "complete", 100)
    raise_if_cancelled(cancelled)
    return report
