"""Compatibility exports for the constrained V2 narrative boundary."""

from __future__ import annotations

from .narrative import (
    NarrativeComposer,
    NarrativeFailure,
    NarrativePayload,
    NarrativePromptProjection,
    build_narrative_projection,
    compose_report,
    validate_narrative,
)


__all__ = [
    "NarrativeComposer",
    "NarrativeFailure",
    "NarrativePayload",
    "NarrativePromptProjection",
    "build_narrative_projection",
    "compose_report",
    "validate_narrative",
]
