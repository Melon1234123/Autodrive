import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import server
from backend.diagnosis_jobs import DiagnosisJobManager


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
    with TestClient(server.app) as test_client:
        yield test_client


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


def test_create_accepts_exactly_the_ten_catalog_scenes(client):
    server.diagnosis_jobs = DiagnosisJobManager(
        run_pipeline=lambda scene_key, data_version, _progress: {
            "scene_name": scene_key,
            "data_version": data_version,
        }
    )
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
