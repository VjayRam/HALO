from __future__ import annotations

import inspect
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from openai import AsyncOpenAI

import engine.agents.agent_context as agent_context_module
import engine.main as engine_main
from engine.agents.agent_config import AgentConfig
from engine.agents.agent_context_items import AgentContextItem
from engine.engine_config import EngineConfig
from engine.main import _drive_sync
from engine.model_config import ModelConfig
from engine.model_provider_config import ModelProviderConfig
from engine.models.messages import AgentMessage
from tests._sdk_events import assistant_message_event
from tests.probes.probe_kit import FakeRunner


async def _noop_compact(
    *,
    client: AsyncOpenAI,
    compaction_model: ModelConfig,
    item: AgentContextItem,
) -> str:
    del client, compaction_model, item
    return ""


def test_public_entrypoints_exist_and_are_async() -> None:
    assert inspect.isasyncgenfunction(engine_main.stream_engine_async)
    assert inspect.iscoroutinefunction(engine_main.run_engine_async)
    assert callable(engine_main.stream_engine)
    assert callable(engine_main.run_engine)


def test_async_signatures_match() -> None:
    for fn in (engine_main.stream_engine_async, engine_main.run_engine_async):
        params = list(inspect.signature(fn).parameters)
        assert params[:3] == ["messages", "engine_config", "trace_path"]


def test_drive_sync_runs_finally_on_early_break() -> None:
    """Regression: early break must trigger the async generator's finally
    block so background tasks / telemetry handles get cleaned up."""
    cleaned_up: list[bool] = []

    async def _producer():
        try:
            for i in range(10):
                yield i
        finally:
            cleaned_up.append(True)

    seen: list[int] = []
    for value in _drive_sync(_producer()):
        seen.append(value)
        if value == 2:
            break

    assert seen == [0, 1, 2]
    assert cleaned_up == [True]


def test_drive_sync_runs_finally_on_consumer_exception() -> None:
    """Regression: an exception raised by the consumer must propagate
    through the sync generator AND trigger the async producer's finally."""
    cleaned_up: list[bool] = []

    async def _producer():
        try:
            for i in range(10):
                yield i
        finally:
            cleaned_up.append(True)

    class Boom(Exception):
        pass

    try:
        for value in _drive_sync(_producer()):
            if value == 1:
                raise Boom
    except Boom:
        pass

    assert cleaned_up == [True]


def test_drive_sync_runs_finally_on_full_consumption() -> None:
    cleaned_up: list[bool] = []

    async def _producer():
        try:
            yield 1
            yield 2
        finally:
            cleaned_up.append(True)

    assert list(_drive_sync(_producer())) == [1, 2]
    assert cleaned_up == [True]


def _assistant_text(text: str):
    return assistant_message_event(item_id="msg-1", text=text)


def _config() -> EngineConfig:
    agent = AgentConfig(
        name="root",
        model=ModelConfig(name="gpt-5.4-mini"),
        maximum_turns=4,
    )
    return EngineConfig(
        root_agent=agent,
        subagent=agent.model_copy(update={"name": "sub"}),
        synthesis_model=ModelConfig(name="gpt-5.4-mini"),
        compaction_model=ModelConfig(name="gpt-5.4-mini"),
        text_message_compaction_keep_last_messages=0,
        tool_call_compaction_keep_last_turns=0,
        maximum_depth=0,
        maximum_parallel_subagents=1,
    )


@pytest.mark.asyncio
async def test_engine_installs_sdk_default_via_boundary(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    fixtures_dir: Path,
) -> None:
    """Engine must route the SDK default-client install through the boundary
    helper ``install_default_sdk_client`` (which pins ``use_for_tracing=False``;
    verified in ``test_openai_sdk_client.py``)."""
    trace_path = tmp_path / "traces.jsonl"
    trace_path.write_bytes((fixtures_dir / "tiny_traces.jsonl").read_bytes())

    install_calls: list[object] = []

    class _StubAsyncOpenAI:
        def __init__(self) -> None:
            self.close = AsyncMock()

    stub_client_instance: _StubAsyncOpenAI | None = None

    def _capture_client(provider_config: ModelProviderConfig) -> _StubAsyncOpenAI:
        del provider_config
        nonlocal stub_client_instance
        stub_client_instance = _StubAsyncOpenAI()
        return stub_client_instance

    def _record_install_default(client: object) -> None:
        install_calls.append(client)

    monkeypatch.setattr(engine_main, "build_async_openai_client", _capture_client)
    monkeypatch.setattr(engine_main, "install_default_sdk_client", _record_install_default)
    monkeypatch.setattr(agent_context_module, "compact", _noop_compact)

    runner = FakeRunner([_assistant_text("Final.\n<final/>")])
    monkeypatch.setattr("agents.Runner.run_streamed", runner.run_streamed)

    await engine_main.run_engine_async(
        [AgentMessage(role="user", content="hi")], _config(), trace_path
    )

    assert len(install_calls) == 1
    assert install_calls[0] is stub_client_instance
