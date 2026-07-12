from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal, Optional

from .models import RiskEpisode, SceneFeatures, TimelineSample


FrameRisk = Optional[Literal["medium", "high"]]


@dataclass(frozen=True)
class _Span:
    start_index: int
    end_index: int


def _frame_risk(sample: TimelineSample) -> FrameRisk:
    risks = {item.risk for item in sample.perception.value.objects}
    if "high" in risks:
        return "high"
    if "medium" in risks:
        return "medium"
    telemetry = sample.telemetry.value
    if telemetry.brake > 0.4 and telemetry.throttle > 0.2:
        return "medium"
    return None


def _merge_active_spans(
    samples: List[TimelineSample],
    levels: List[FrameRisk],
    merge_gap_seconds: float,
    min_duration_seconds: float,
) -> List[_Span]:
    active = [index for index, level in enumerate(levels) if level is not None]
    if not active:
        return []
    spans: List[_Span] = []
    start = previous = active[0]
    for index in active[1:]:
        if samples[index].time - samples[previous].time > merge_gap_seconds:
            if samples[previous].time - samples[start].time >= min_duration_seconds:
                spans.append(_Span(start, previous))
            start = index
        previous = index
    if samples[previous].time - samples[start].time >= min_duration_seconds:
        spans.append(_Span(start, previous))
    return spans


def mine_risk_episodes(
    samples: List[TimelineSample], features: SceneFeatures
) -> List[RiskEpisode]:
    del features  # The signature keeps feature context available for future calibrated rules.
    if not samples:
        return []
    levels = [_frame_risk(sample) for sample in samples]
    spans = _merge_active_spans(
        samples, levels, merge_gap_seconds=0.75, min_duration_seconds=0.25
    )
    episodes: List[RiskEpisode] = []
    for number, span in enumerate(spans, start=1):
        indices = range(span.start_index, span.end_index + 1)
        peak_candidates = [
            index for index in indices if levels[index] is not None
        ]
        peak_index = min(
            peak_candidates,
            key=lambda index: (-({"medium": 1, "high": 2}[levels[index]]), samples[index].time),
        )
        risk = "high" if any(levels[index] == "high" for index in indices) else "medium"
        conflict = any(
            samples[index].telemetry.value.brake > 0.4
            and samples[index].telemetry.value.throttle > 0.2
            for index in indices
        )
        summary = (
            "高风险目标或控制冲突在时间窗内持续出现。"
            if risk == "high"
            else "中风险目标或控制冲突在时间窗内持续出现。"
        )
        episodes.append(RiskEpisode(
            id=f"ep-{number:04d}",
            start_time=samples[span.start_index].time,
            end_time=samples[span.end_index].time,
            peak_time=samples[peak_index].time,
            risk=risk,
            summary=summary,
            evidence_ids=[f"ev-{number:04d}"],
            control_conflict=conflict,
        ))
    return episodes
