import json
import logging
import time

import pytest
from fastapi.testclient import TestClient

from backend import server
from backend.diagnosis_jobs import DiagnosisJobManager
from autodrive_harness.reporting import protected_fingerprint


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
    assert completed["report"]["scene_name"] == "城市路口侧向超车"
    assert "scene-" not in json.dumps(completed["report"], ensure_ascii=False)
    assert set(completed) == {
        "jobId", "sceneKey", "dataVersion", "stage", "percent", "report", "error",
    }


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
        run_pipeline=lambda scene_key, data_version, _progress: {
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
        run_pipeline=lambda scene_key, _data_version, _progress: {"scene_name": scene_key}
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


@pytest.mark.parametrize(
    "case",
    ["missing-telemetry", "missing-perception", "partial-overlap", "excessive-skew"],
)
def test_api_serializes_complete_degraded_reports(client, monkeypatch, case):
    monkeypatch.setattr(server, "scene_catalog", StaticCatalog(api_degraded_bundle(case)))

    created = client.post(
        "/api/v1/diagnoses",
        json={"sceneKey": "default", "dataVersion": f"api-{case}-v1"},
    )
    completed = wait_for_complete(client, created.json()["jobId"])

    assert completed["report"]["generation_mode"] == "local-harness"
    assert completed["report"]["historical_risk_events"] == []
    assert completed["report"]["limitations"]
    assert completed["report"]["data_quality"]
    json.dumps(completed, ensure_ascii=False)


class CompletionResponse:
    def __init__(self, content):
        self.choices = [type("Choice", (), {
            "message": type("Message", (), {"content": content})(),
        })()]


class FakeCompletions:
    def __init__(self, result):
        self.result = result

    def create(self, **_kwargs):
        if isinstance(self.result, Exception):
            raise self.result
        return CompletionResponse(self.result)


class FakeModelClient:
    def __init__(self, result):
        self.chat = type("Chat", (), {"completions": FakeCompletions(result)})()


def test_full_scene_pipeline_uses_only_structured_model_plan(monkeypatch):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "sk-valid-test")
    monkeypatch.setattr(server, "get_openai_client", lambda: FakeModelClient(json.dumps({
        "style": "expert",
        "emphasized_finding_ids": [],
        "emphasized_recommendation_ids": [],
    })))
    local = server.run_scene_diagnosis(server.scene_catalog, "default", "model-test-v1")
    enhanced = server.run_diagnosis_pipeline("default", "model-test-v1", lambda _item: None)

    assert enhanced.generation_mode == "model-enhanced"
    assert enhanced.executive_summary == f"专家视图：{local.executive_summary}"
    assert enhanced.scores == local.scores
    assert enhanced.timeline == local.timeline
    assert enhanced.historical_risk_events == local.historical_risk_events
    assert enhanced.evidence_index == local.evidence_index
    assert protected_fingerprint(local) != protected_fingerprint(enhanced)


@pytest.mark.parametrize(
    "failure",
    [
        RuntimeError("offline"),
        "not-json",
        json.dumps({"style": "marketing"}),
        json.dumps({
            "style": "expert",
            "emphasized_finding_ids": ["finding-9999"],
            "emphasized_recommendation_ids": [],
        }),
    ],
)
def test_full_scene_model_failure_logs_and_returns_complete_local_report(
    monkeypatch, caplog, failure
):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "sk-valid-test")
    monkeypatch.setattr(server, "get_openai_client", lambda: FakeModelClient(failure))
    local = server.run_scene_diagnosis(server.scene_catalog, "default", "fallback-test-v1")

    with caplog.at_level(logging.WARNING):
        result = server.run_diagnosis_pipeline(
            "default", "fallback-test-v1", lambda _item: None
        )

    assert result == local
    assert result.generation_mode == "local-harness"
    assert "report enhancement failed" in caplog.text


def test_absent_model_credentials_skip_full_scene_adapter(monkeypatch):
    monkeypatch.setattr(server, "OPENAI_API_KEY", "")
    monkeypatch.setattr(
        server,
        "get_openai_client",
        lambda: (_ for _ in ()).throw(AssertionError("model client must not be created")),
    )

    report = server.run_diagnosis_pipeline("default", "local-only-v1", lambda _item: None)

    assert report.generation_mode == "local-harness"
