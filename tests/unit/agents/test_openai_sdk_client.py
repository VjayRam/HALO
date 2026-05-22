from __future__ import annotations

from unittest.mock import MagicMock

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

from engine.agents.openai_sdk_client import (
    build_async_openai_client,
    is_retriable_llm_error,
    omit,
)
from engine.model_provider_config import ModelProviderConfig


def test_build_async_openai_client_returns_async_openai() -> None:
    cfg = ModelProviderConfig(
        base_url="https://example.com/v1",
        api_key="sk-test",
        default_headers={"X-Test": "1"},
    )
    client = build_async_openai_client(cfg)
    assert isinstance(client, AsyncOpenAI)


def test_build_async_openai_client_with_empty_config() -> None:
    """Empty config is allowed — AsyncOpenAI falls back to env vars."""
    client = build_async_openai_client(ModelProviderConfig())
    assert isinstance(client, AsyncOpenAI)


def test_is_retriable_classifies_connection_error() -> None:
    exc = MagicMock(spec=APIConnectionError)
    assert is_retriable_llm_error(exc) is True


def test_is_retriable_classifies_timeout() -> None:
    exc = MagicMock(spec=APITimeoutError)
    assert is_retriable_llm_error(exc) is True


def test_is_retriable_classifies_rate_limit() -> None:
    exc = MagicMock(spec=RateLimitError)
    assert is_retriable_llm_error(exc) is True


def test_is_retriable_classifies_5xx_status_as_retriable() -> None:
    exc = MagicMock(spec=APIStatusError)
    exc.status_code = 503
    assert is_retriable_llm_error(exc) is True


def test_is_retriable_classifies_4xx_status_as_non_retriable() -> None:
    exc = MagicMock(spec=APIStatusError)
    exc.status_code = 400
    assert is_retriable_llm_error(exc) is False


def test_is_retriable_classifies_unrelated_exception_as_non_retriable() -> None:
    assert is_retriable_llm_error(RuntimeError("boom")) is False


def test_omit_is_reexported_openai_sentinel() -> None:
    """``omit`` is the openai SDK's "don't send this param" sentinel.
    Re-exporting it lets compactor.py keep its current behavior without
    importing from openai directly.
    """
    from openai import omit as openai_omit

    assert omit is openai_omit


def test_install_default_sdk_client_pins_use_for_tracing_false(monkeypatch) -> None:
    """The helper must always pin ``use_for_tracing=False`` — HALO owns its own
    tracing pipeline and letting the SDK redirect tracing would duplicate exports.
    """
    from openai import AsyncOpenAI

    from engine.agents import openai_sdk_client

    received: dict[str, object] = {}

    def fake_set_default(client, *, use_for_tracing) -> None:
        received["client"] = client
        received["use_for_tracing"] = use_for_tracing

    monkeypatch.setattr(openai_sdk_client, "set_default_openai_client", fake_set_default)

    client = AsyncOpenAI(api_key="sk-test")
    openai_sdk_client.install_default_sdk_client(client)

    assert received["client"] is client
    assert received["use_for_tracing"] is False
