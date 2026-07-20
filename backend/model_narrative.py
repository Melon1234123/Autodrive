"""Server-only OpenAI-compatible composer for constrained report narratives."""

from __future__ import annotations

import json

from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    OpenAI,
)

from autodrive_harness.narrative import (
    NarrativeComposer,
    NarrativeFailure,
    NarrativePayload,
    NarrativePromptProjection,
)

NARRATIVE_REQUEST_TIMEOUT_SECONDS = 30.0


class OpenAIModelNarrativeComposer(NarrativeComposer):
    """Compose only grounded explanatory prose from the safe fact projection."""

    def __init__(self, client: OpenAI, model: str) -> None:
        self._client = client
        self._model = model

    def compose(self, projection: NarrativePromptProjection) -> NarrativePayload:
        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你只能依据给定事实包生成严格 JSON 叙事。"
                            "不得新增任何分数、时间、证据、风险等级、溯源信息、"
                            "来源或结论。不得输出事实包之外的内容。"
                            "输出必须是叙事对象，至少包含 \"executive_summary\"；"
                            "其余可选键仅限 finding_explanations、causal_explanations、"
                            "recommendation_rationales、analysis_notes，无法严格引用已有"
                            "事实时请省略或返回空数组。优先只返回"
                            "{\"executive_summary\":\"面向整段路段和全程运行、不含数字和内部 ID 的简洁定性总结\"}。"
                            "executive_summary 不使用单一事件举例或逐项罗列，应概括"
                            "整段路段的运行状态、执行方向与复核边界。"
                            "绝不回显 fact_fingerprint、scene_name、scores、priority_findings、"
                            "causal_chains、recommendations、evidence_index 或 limitations。"
                        ),
                    },
                    {"role": "user", "content": projection.model_dump_json()},
                ],
                response_format={"type": "json_object"},
                temperature=0,
                timeout=NARRATIVE_REQUEST_TIMEOUT_SECONDS,
            )
        except APITimeoutError as exc:
            raise NarrativeFailure("timeout") from exc
        except (APIConnectionError, APIStatusError, APIError) as exc:
            raise NarrativeFailure("unavailable") from exc

        try:
            choices = response.choices
            if not choices:
                raise NarrativeFailure("invalid_response")
            content = choices[0].message.content
            if not isinstance(content, str) or not content.strip():
                raise NarrativeFailure("invalid_response")
            payload = json.loads(content)
            if not isinstance(payload, dict):
                raise NarrativeFailure("invalid_response")
            return payload
        except NarrativeFailure:
            raise
        except (AttributeError, IndexError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise NarrativeFailure("invalid_response") from exc


def create_model_narrative_composer(
    client: OpenAI,
    model: str,
) -> OpenAIModelNarrativeComposer:
    return OpenAIModelNarrativeComposer(client, model)
