import asyncio

from server import openai_responses


class _DummyResponse:
    def __init__(self, status_code, payload, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)
        self.headers = headers or {}

    def json(self):
        return self._payload


def test_responses_generate_parses_output_text(monkeypatch):
    async def _fake_post(self, url, headers=None, json=None):  # noqa: ARG001
        return _DummyResponse(
            200,
            {
                "id": "resp_1",
                "output_text": "hello from output_text",
                "usage": {"input_tokens": 10, "output_tokens": 3},
            },
        )

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)

    result = asyncio.run(
        openai_responses.responses_generate(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-5.2",
            api_key="sk-test-123",
        )
    )
    assert result["ok"] is True
    assert result["text"] == "hello from output_text"


def test_responses_generate_parses_output_blocks(monkeypatch):
    async def _fake_post(self, url, headers=None, json=None):  # noqa: ARG001
        return _DummyResponse(
            200,
            {
                "id": "resp_2",
                "output": [
                    {"content": [{"type": "output_text", "text": "line one"}]},
                    {"content": [{"type": "text", "text": "line two"}]},
                ],
            },
        )

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)

    result = asyncio.run(
        openai_responses.responses_generate(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-5.2-codex",
            api_key="sk-test-456",
        )
    )
    assert result["ok"] is True
    assert "line one" in result["text"]
    assert "line two" in result["text"]


def test_responses_generate_maps_401_to_key_error(monkeypatch):
    async def _fake_post(self, url, headers=None, json=None):  # noqa: ARG001
        return _DummyResponse(
            401,
            {"error": {"message": "invalid key", "type": "invalid_request_error"}},
        )

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)

    result = asyncio.run(
        openai_responses.responses_generate(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-5.2",
            api_key="sk-invalid",
        )
    )
    assert result["ok"] is False
    assert result["error"] == "OpenAI key missing/invalid."
    assert result["status_code"] == 401


def test_responses_generate_maps_404_to_model_error(monkeypatch):
    async def _fake_post(self, url, headers=None, json=None):  # noqa: ARG001
        return _DummyResponse(
            404,
            {"error": {"message": "model not found", "type": "invalid_request_error"}},
        )

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)

    result = asyncio.run(
        openai_responses.responses_generate(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-5.2-codex",
            api_key="sk-test-789",
        )
    )
    assert result["ok"] is False
    assert result["error"] == "Model not available: gpt-5.2-codex."
    assert result["status_code"] == 404


def test_responses_generate_retries_429_then_succeeds(monkeypatch):
    calls = {"count": 0}

    async def _fake_post(self, url, headers=None, json=None):  # noqa: ARG001
        calls["count"] += 1
        if calls["count"] == 1:
            return _DummyResponse(
                429,
                {"error": {"message": "rate limit", "type": "insufficient_quota", "code": "rate_limit"}},
                headers={"retry-after": "0", "x-request-id": "req_retry"},
            )
        return _DummyResponse(
            200,
            {
                "id": "resp_3",
                "output_text": "ok after retry",
                "usage": {"input_tokens": 8, "output_tokens": 2},
            },
            headers={"x-request-id": "req_ok"},
        )

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)

    result = asyncio.run(
        openai_responses.responses_generate(
            messages=[{"role": "user", "content": "hi"}],
            model="gpt-5.2",
            api_key="sk-test-123",
        )
    )
    assert calls["count"] == 2
    assert result["ok"] is True
    assert result["text"] == "ok after retry"
    assert result["request_id"] == "req_ok"
