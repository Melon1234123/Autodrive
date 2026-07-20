import json
import logging
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import server
from backend.diagnosis_jobs import DiagnosisJobManager
from autodrive_harness.fact_bundle import protected_facts_fingerprint
from autodrive_harness.narrative import NarrativeFailure, NarrativePromptProjection
from autodrive_harness.models import RiskScores


CATALOG_SCENES = (
    "default",
    "scene-0061",
    "scene-0103",
    "scene-0553",
    "scene-0655",
    "scene-0757",
    "scene-0916",
    "scene-1077",
    "scene-1094",
    "scene-1100",
)


def wait_for_complete(client: TestClient, job_id: str, timeout: float = 10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/diagnoses/{job_id}")
        assert response.status_code == 200
        snapshot = response.json()
        if snapshot["stage"] == "complete":
            return snapshot
        if snapshot["stage"] == "failed":
            raise AssertionError(snapshot["error"])
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not complete")


def wait_for_terminal(client: TestClient, job_id: str, timeout: float = 3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/diagnoses/{job_id}")
        assert response.status_code == 200
        snapshot = response.json()
        if snapshot["stage"] in {"complete", "failed", "cancelled"}:
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach a terminal stage")


@pytest.fixture
def client(monkeypatch):
    manager = DiagnosisJobManager(run_pipeline=server.run_diagnosis_pipeline, max_completed=5)
    monkeypatch.setattr(server, "diagnosis_jobs", manager)
    monkeypatch.setattr(server, "OPENAI_API_KEY", "")
    try:
        with TestClient(server.app) as test_client:
            yield test_client
    finally:
        manager.shutdown(wait=True)


def test_job_progress_and_complete_report_are_serializable(client):
    response = client.post(
        "/api/v1/diagnoses",
        json={"sceneKey": "default", "dataVersion": "api-test-v1"},
    )
    assert response.status_code == 202
    job_id = response.json()["jobId"]
    completed = wait_for_complete(client, job_id)

    assert completed["stage"] == "complete"
    assert completed["percent"] == 100
    report = completed["report"]
    assert report["meta"]["scene_name"] == "城市路口侧向超车"
    assert report["meta"]["schema_version"] == "2.0"
    assert set(report) == {"meta", "analysis", "evidence", "support"}
    assert "scene-" not in json.dumps(completed["report"], ensure_ascii=False)
    assert set(completed) == {
        "jobId", "sceneKey", "dataVersion", "stage", "percent", "report", "error",
    }


def test_create_force_reruns_a_completed_diagnosis(client, monkeypatch):
    calls = []

    def pipeline(scene_key, data_version, _progress, _cancelled):
        calls.append((scene_key, data_version))
        return {"scene_name": scene_key, "data_version": data_version}

    manager = DiagnosisJobManager(run_pipeline=pipeline)
    monkeypatch.setattr(server, "diagnosis_jobs", manager)
    try:
        payload = {"sceneKey": "default", "dataVersion": "rerun-v1"}
        first = client.post("/api/v1/diagnoses", json=payload)
        assert first.status_code == 202
        wait_for_complete(client, first.json()["jobId"])

        duplicate = client.post("/api/v1/diagnoses", json=payload)
        assert duplicate.status_code == 202
        assert duplicate.json()["jobId"] == first.json()["jobId"]

        rerun = client.post(
            "/api/v1/diagnoses",
            json={**payload, "force": True},
        )
        assert rerun.status_code == 202
        assert rerun.json()["jobId"] != first.json()["jobId"]
        wait_for_complete(client, rerun.json()["jobId"])
        assert calls == [("default", "rerun-v1"), ("default", "rerun-v1")]
    finally:
        manager.shutdown(wait=True)


def test_create_force_deduplicates_a_running_diagnosis(client, monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def blocking_pipeline(_scene_key, _data_version, _progress, _cancelled):
        entered.set()
        assert release.wait(2)
        return {"scene_name": "default"}

    manager = DiagnosisJobManager(run_pipeline=blocking_pipeline)
    monkeypatch.setattr(server, "diagnosis_jobs", manager)
    try:
        payload = {"sceneKey": "default", "dataVersion": "active-rerun-v1"}
        created = client.post("/api/v1/diagnoses", json=payload)
        assert created.status_code == 202
        assert entered.wait(1)

        forced = client.post("/api/v1/diagnoses", json={**payload, "force": True})
        assert forced.status_code == 202
        assert forced.json()["jobId"] == created.json()["jobId"]
    finally:
        release.set()
        manager.shutdown(wait=True)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"sceneKey": "default"},
        {"sceneKey": "default", "dataVersion": "v1", "extra": True},
        {"sceneKey": "unknown", "dataVersion": "v1"},
        {"sceneKey": "scene key", "dataVersion": "v1"},
        {"sceneKey": "default", "dataVersion": ""},
        {"sceneKey": "default", "dataVersion": "v" * 129},
        {"sceneKey": "default", "dataVersion": 1},
        {"sceneKey": "default", "dataVersion": "v1", "force": "true"},
        {"sceneKey": "default", "dataVersion": "v1", "force": 1},
        {"sceneKey": "default", "dataVersion": "v1", "force": None},
    ],
)
def test_create_rejects_invalid_or_non_catalog_requests(client, payload):
    assert client.post("/api/v1/diagnoses", json=payload).status_code == 422


def test_unknown_job_is_404_with_safe_chinese_error(client):
    response = client.get("/api/v1/diagnoses/not-a-job")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert any("\u4e00" <= character <= "\u9fff" for character in detail)
    assert "Traceback" not in detail


def test_create_accepts_exactly_the_ten_catalog_scenes(client, monkeypatch):
    manager = DiagnosisJobManager(
        run_pipeline=lambda scene_key, data_version, _progress, _cancelled: {
            "scene_name": scene_key,
            "data_version": data_version,
        }
    )
    monkeypatch.setattr(server, "diagnosis_jobs", manager)
    for scene_key in CATALOG_SCENES:
        response = client.post(
            "/api/v1/diagnoses",
            json={"sceneKey": scene_key, "dataVersion": "catalog-v1"},
        )
        assert response.status_code == 202


def test_cors_allows_frontend_post_and_preflight(client):
    origin = "http://localhost:5173"
    response = client.options(
        "/api/v1/diagnoses",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "POST" in response.headers["access-control-allow-methods"]

    created = client.post(
        "/api/v1/diagnoses",
        json={"sceneKey": "default", "dataVersion": "cors-v1"},
        headers={"Origin": origin},
    )
    assert created.status_code == 202
    assert created.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", ["http://localhost:5174", "http://127.0.0.1:5175"])
def test_cors_allows_delete_preflight_for_report_clients(client, origin):
    response = client.options(
        "/api/v1/diagnoses/example-job",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "DELETE",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "DELETE" in response.headers["access-control-allow-methods"]


def test_delete_cancels_an_active_job_and_suppresses_late_result(client, monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def blocking_pipeline(_scene_key, _data_version, progress, cancelled):
        progress(server.DiagnosisProgress(stage="validation", percent=10))
        entered.set()
        assert release.wait(2)
        assert cancelled()
        return {"late": "result"}

    manager = DiagnosisJobManager(run_pipeline=blocking_pipeline)
    monkeypatch.setattr(server, "diagnosis_jobs", manager)
    try:
        created = client.post(
            "/api/v1/diagnoses",
            json={"sceneKey": "default", "dataVersion": "delete-v2"},
        )
        assert entered.wait(1)

        cancelled = client.delete(f"/api/v1/diagnoses/{created.json()['jobId']}")
        assert cancelled.status_code == 200
        assert cancelled.json()["stage"] == "cancelled"
        assert cancelled.json()["report"] is None
        assert cancelled.json()["error"] is None

        repeated = client.delete(f"/api/v1/diagnoses/{created.json()['jobId']}")
        assert repeated.status_code == 200
        assert repeated.json() == cancelled.json()

        release.set()
        manager.shutdown(wait=True)
        current = client.get(f"/api/v1/diagnoses/{created.json()['jobId']}")
        assert current.json() == cancelled.json()
    finally:
        release.set()
        manager.shutdown(wait=True)


def test_delete_unknown_and_terminal_jobs_is_idempotent(client, monkeypatch):
    def pipeline(scene_key, _data_version, _progress, _cancelled):
        if scene_key == "scene-0061":
            raise RuntimeError("fixture failure")
        return {"scene_name": scene_key}

    manager = DiagnosisJobManager(run_pipeline=pipeline)
    monkeypatch.setattr(server, "diagnosis_jobs", manager)
    try:
        unknown = client.delete("/api/v1/diagnoses/not-a-job")
        assert unknown.status_code == 404
        assert unknown.json() == {"detail": "诊断任务不存在"}

        completed = client.post(
            "/api/v1/diagnoses",
            json={"sceneKey": "default", "dataVersion": "delete-complete-v2"},
        ).json()
        complete_snapshot = wait_for_terminal(client, completed["jobId"])
        assert complete_snapshot["stage"] == "complete"
        assert client.delete(f"/api/v1/diagnoses/{completed['jobId']}").json() == complete_snapshot

        failed = client.post(
            "/api/v1/diagnoses",
            json={"sceneKey": "scene-0061", "dataVersion": "delete-failed-v2"},
        ).json()
        failed_snapshot = wait_for_terminal(client, failed["jobId"])
        assert failed_snapshot["stage"] == "failed"
        assert client.delete(f"/api/v1/diagnoses/{failed['jobId']}").json() == failed_snapshot
    finally:
        manager.shutdown(wait=True)


def test_legacy_http_and_websocket_routes_remain_available(client):
    root = client.get("/")
    health = client.get("/health")
    assert root.status_code == 200
    assert root.json()["service"] == "Autodrive AI Diagnosis Backend"
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({
            "type": "diagnose",
            "frame": {
                "time": 1.0,
                "speedKmh": 10.0,
                "brake": 0.0,
                "throttle": 0.1,
                "steering": 0.0,
                "accel": 0.0,
                "scene": "道路畅通",
            },
        })
        result = websocket.receive_json()
    assert result["riskLevel"] == "low"
    assert result["mode"] in {"model", "fallback"}


def test_app_lifespan_shuts_down_the_active_diagnosis_manager(monkeypatch):
    manager = DiagnosisJobManager(
        run_pipeline=lambda scene_key, _data_version, _progress, _cancelled: {
            "scene_name": scene_key
        }
    )
    monkeypatch.setattr(server, "diagnosis_jobs", manager)

    with TestClient(server.app) as test_client:
        assert test_client.get("/health").status_code == 200
        created = test_client.post(
            "/api/v1/diagnoses",
            json={"sceneKey": "default", "dataVersion": "lifespan-v1"},
        ).json()

    assert manager.get(created["jobId"]).stage == "complete"
    with pytest.raises(RuntimeError, match="已关闭"):
        manager.create("default", "lifespan-v1")


class StaticCatalog:
    def __init__(self, bundle):
        self.bundle = bundle

    def load(self, _scene_key):
        return self.bundle


def api_degraded_bundle(case):
    bundle = server.scene_catalog.load("default").model_copy(deep=True)
    if case == "missing-telemetry":
        bundle.telemetry = []
    elif case == "missing-perception":
        bundle.perception = []
    elif case == "partial-overlap":
        cutoff = bundle.telemetry[-1].time - 0.2
        bundle.perception = [row for row in bundle.perception if row.time >= cutoff]
    elif case == "excessive-skew":
        for row in bundle.perception:
            row.time += 10_000.0
    return bundle


@pytest.mark.parametrize("case", [
    "missing-telemetry", "missing-perception", "partial-overlap", "excessive-skew",
])
def test_api_serializes_modality_aware_degraded_reports(client, monkeypatch, case):
    monkeypatch.setattr(server, "scene_catalog", StaticCatalog(api_degraded_bundle(case)))

    created = client.post(
        "/api/v1/diagnoses",
        json={"sceneKey": "default", "dataVersion": f"api-{case}-v1"},
    )
    completed = wait_for_complete(client, created.json()["jobId"])

    report = completed["report"]
    assert report["meta"]["generation"]["mode"] == "local-harness"
    assert report["evidence"]["timeline"] == []
    assert report["support"]["limitations"]
    assert report["support"]["data_quality"]
    sources = {item["source"] for item in report["evidence"]["index"]}
    assert report["analysis"]["risk_profile"]["overall"] is None
    if case == "missing-telemetry":
        assert "telemetry" not in sources
        assert report["analysis"]["risk_profile"]["motion"] is None
        assert report["analysis"]["risk_profile"]["perception"] is not None
    elif case == "missing-perception":
        assert not sources & {"camera", "perception", "ego_pose", "trajectory"}
        assert report["analysis"]["risk_profile"]["perception"] is None
        assert report["analysis"]["risk_profile"]["motion"] is not None
    else:
        assert sources == {
            "camera", "perception", "lidar", "ego_pose", "telemetry", "trajectory",
        }
        assert report["analysis"]["risk_profile"]["motion"] is not None
        assert report["analysis"]["risk_profile"]["perception"] is not None
    json.dumps(completed, ensure_ascii=False)


class CompletionResponse:
    def __init__(self, content):
        self.choices = [type("Choice", (), {
            "message": type("Message", (), {"content": content})(),
        })()]


class FakeCompletions:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        if isinstance(self.result, EmptyCompletionResponse):
            return self.result
        if isinstance(self.result, CompletionResponse):
            return self.result
        return CompletionResponse(self.result)


class FakeModelClient:
    def __init__(self, result):
        self.chat = type("Chat", (), {"completions": FakeCompletions(result)})()


class EmptyCompletionResponse:
    choices = []


def valid_narrative_payload():
    return {
        "executive_summary": "依据当前证据生成的受约束解释。",
        "finding_explanations": [],
        "causal_explanations": [],
        "recommendation_rationales": [],
        "analysis_notes": [],
    }


def minimal_projection():
    return NarrativePromptProjection(
        fact_fingerprint="0" * 64,
        scene_name="测试场景",
        scores=RiskScores(
            perception=1,
            motion=1,
            control=1,
            trajectory=1,
            data_quality=100,
            overall=1,
            confidence=1.0,
        ),
        priority_findings=[],
        causal_chains=[],
        recommendations=[],
        evidence_index=[],
        limitations=[],
    )


def test_full_scene_pipeline_uses_grounded_model_narrative(monkeypatch):
    payload = valid_narrative_payload()
    client = FakeModelClient(json.dumps(payload))
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "OPENAI_MODEL", "fake-narrative-model")
    monkeypatch.setattr(server, "get_openai_client", lambda: client)

    local = server.run_scene_diagnosis(server.scene_catalog, "default", "model-test-v2")
    progress = []
    report = server.run_diagnosis_pipeline("default", "model-test-v2", progress.append)

    assert report.meta.generation.mode == "model-grounded"
    assert report.meta.generation.model == "fake-narrative-model"
    assert payload["executive_summary"] not in report.analysis.executive_summary
    assert "全程" in report.analysis.executive_summary
    assert report.meta.protected_facts_fingerprint == (
        local.meta.protected_facts_fingerprint
    )
    assert [item.stage for item in progress][-3:] == ["narrative", "report", "complete"]
    assert len(client.chat.completions.calls) == 1


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (RuntimeError("offline"), "unavailable"),
        (EmptyCompletionResponse(), "invalid_response"),
        (CompletionResponse(None), "invalid_response"),
        ("not-json", "invalid_response"),
        (
            json.dumps({
                "executive_summary": "依据当前证据生成解释。",
                "finding_explanations": [{
                    "finding_id": "finding-9999",
                    "interpretation": "引用了不存在的发现。",
                    "evidence_ids": [],
                }],
                "causal_explanations": [],
                "recommendation_rationales": [],
                "analysis_notes": [],
            }),
            "invalid_response",
        ),
        (json.dumps({
            **valid_narrative_payload(),
            "executive_summary": "新增 999 km/h 的未经验证结论。",
        }), "invalid_response"),
    ],
)
def test_full_scene_model_failure_returns_complete_local_report(
    monkeypatch, failure, reason
):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "OPENAI_MODEL", "fake-narrative-model")
    monkeypatch.setattr(server, "get_openai_client", lambda: FakeModelClient(failure))
    progress = []
    result = server.run_diagnosis_pipeline(
        "default", "fallback-test-v2", progress.append
    )

    assert result.meta.generation.mode == "local-harness"
    assert result.meta.generation.model == "fake-narrative-model"
    assert result.meta.generation.attempted is True
    assert result.meta.generation.fallback_reason == reason
    assert [item.stage for item in progress][-3:] == ["narrative", "report", "complete"]


def test_absent_model_credentials_skip_full_scene_adapter(monkeypatch):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "")
    monkeypatch.setattr(
        server,
        "get_openai_client",
        lambda: (_ for _ in ()).throw(AssertionError("model client must not be created")),
    )
    monkeypatch.setattr(
        server,
        "create_model_narrative_composer",
        lambda _client, _model: (_ for _ in ()).throw(
            AssertionError("narrative composer must not be created")
        ),
        raising=False,
    )

    progress = []
    report = server.run_diagnosis_pipeline("default", "local-only-v2", progress.append)

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.attempted is False
    assert report.meta.generation.fallback_reason == "disabled"
    assert "narrative" not in [item.stage for item in progress]


def test_full_scene_composer_initialization_failure_is_fail_local(monkeypatch, caplog):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "OPENAI_MODEL", "fake-narrative-model")
    monkeypatch.setattr(
        server,
        "get_openai_client",
        lambda: (_ for _ in ()).throw(RuntimeError("private constructor detail")),
    )

    with caplog.at_level(logging.WARNING):
        report = server.run_diagnosis_pipeline("default", "init-fail-v2", lambda _item: None)

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.attempted is True
    assert report.meta.generation.fallback_reason == "unavailable"
    assert "model narrative initialization failed: RuntimeError" in caplog.text
    assert "private constructor detail" not in caplog.text


def test_configured_client_without_a_composer_falls_back_as_unavailable(monkeypatch):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "OPENAI_MODEL", "fake-narrative-model")
    monkeypatch.setattr(server, "get_openai_client", lambda: object())
    monkeypatch.setattr(
        server,
        "create_model_narrative_composer",
        lambda _client, _model: None,
    )

    report = server.run_diagnosis_pipeline(
        "default", "missing-composer-v2", lambda _item: None
    )

    assert report.meta.generation.mode == "local-harness"
    assert report.meta.generation.attempted is True
    assert report.meta.generation.fallback_reason == "unavailable"


def test_api_composer_initialization_failure_completes_local_report(
    client, monkeypatch, caplog
):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "OPENAI_MODEL", "fake-narrative-model")
    monkeypatch.setattr(
        server,
        "get_openai_client",
        lambda: (_ for _ in ()).throw(RuntimeError("private constructor detail")),
    )

    with caplog.at_level(logging.WARNING):
        created = client.post(
            "/api/v1/diagnoses",
            json={"sceneKey": "default", "dataVersion": "api-init-fail-v2"},
        )
        completed = wait_for_complete(client, created.json()["jobId"])

    assert completed["stage"] == "complete"
    assert completed["report"]["meta"]["generation"]["mode"] == "local-harness"
    assert completed["report"]["meta"]["generation"]["fallback_reason"] == "unavailable"
    assert "model narrative initialization failed: RuntimeError" in caplog.text
    assert "private constructor detail" not in caplog.text


def test_openai_narrative_composer_uses_one_safe_json_completion():
    from backend.model_narrative import (
        NARRATIVE_REQUEST_TIMEOUT_SECONDS,
        OpenAIModelNarrativeComposer,
    )

    payload = valid_narrative_payload()
    client = FakeModelClient(json.dumps(payload))
    projection = minimal_projection()

    result = OpenAIModelNarrativeComposer(client, "fake-narrative-model").compose(
        projection
    )

    assert result == payload
    assert len(client.chat.completions.calls) == 1
    call = client.chat.completions.calls[0]
    assert call["model"] == "fake-narrative-model"
    assert call["temperature"] == 0
    assert call["response_format"] == {"type": "json_object"}
    assert call["timeout"] == NARRATIVE_REQUEST_TIMEOUT_SECONDS
    assert call["messages"][1]["content"] == projection.model_dump_json()
    system_prompt = call["messages"][0]["content"]
    assert "不得新增任何分数" in system_prompt
    assert '"executive_summary"' in system_prompt
    assert "整段路段" in system_prompt
    assert "单一事件举例" in system_prompt
    assert "fact_fingerprint" in system_prompt


@pytest.mark.parametrize(
    ("exception_symbol", "reason"),
    [
        ("APITimeoutError", "timeout"),
        ("APIConnectionError", "unavailable"),
        ("APIStatusError", "unavailable"),
        ("APIError", "unavailable"),
    ],
)
def test_openai_narrative_composer_normalizes_provider_errors(
    monkeypatch, exception_symbol, reason
):
    from backend import model_narrative

    class ProviderFailure(Exception):
        pass

    monkeypatch.setattr(model_narrative, exception_symbol, ProviderFailure)
    composer = model_narrative.OpenAIModelNarrativeComposer(
        FakeModelClient(ProviderFailure("provider detail")), "fake-narrative-model"
    )

    with pytest.raises(NarrativeFailure) as captured:
        composer.compose(minimal_projection())

    assert captured.value.reason == reason


@pytest.mark.parametrize(
    "response",
    [
        EmptyCompletionResponse(),
        CompletionResponse(""),
        CompletionResponse(None),
        "not-json",
    ],
)
def test_openai_narrative_composer_rejects_invalid_provider_payload(response):
    from backend.model_narrative import OpenAIModelNarrativeComposer

    composer = OpenAIModelNarrativeComposer(
        FakeModelClient(response), "fake-narrative-model"
    )

    with pytest.raises(NarrativeFailure) as captured:
        composer.compose(minimal_projection())

    assert captured.value.reason == "invalid_response"
