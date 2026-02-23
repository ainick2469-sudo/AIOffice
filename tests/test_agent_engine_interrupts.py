import asyncio
import time

from server import agent_engine as engine


def _run(coro):
    return asyncio.run(coro)


def test_interrupt_queue_preserves_message_order():
    channel = f"test-interrupt-queue-{int(time.time())}"
    engine._active.pop(channel, None)
    engine._user_interrupt.pop(channel, None)

    try:
        assert engine._queue_user_interrupt(channel, "first") == 1
        assert engine._queue_user_interrupt(channel, "second") == 2
        assert _run(engine._check_interrupt(channel)) is True
        assert engine._pop_user_interrupt(channel) == "first"
        assert engine._pop_user_interrupt(channel) == "second"
        assert engine._pop_user_interrupt(channel) is None
        assert _run(engine._check_interrupt(channel)) is False
    finally:
        engine._active.pop(channel, None)
        engine._user_interrupt.pop(channel, None)


def test_process_autonomous_prompt_waits_for_idle_before_and_after_dispatch(monkeypatch):
    channel = f"test-autonomous-idle-{int(time.time())}"
    engine._active[channel] = True
    engine._user_interrupt.pop(channel, None)
    calls: list[str] = []

    async def fake_process_message(target_channel: str, content: str):
        calls.append(content)
        engine._active[target_channel] = True

        async def _finish_cycle():
            await asyncio.sleep(0.05)
            engine._active.pop(target_channel, None)

        asyncio.create_task(_finish_cycle())

    monkeypatch.setattr(engine, "process_message", fake_process_message)

    async def scenario():
        async def _clear_initial_busy():
            await asyncio.sleep(0.05)
            engine._active.pop(channel, None)

        asyncio.create_task(_clear_initial_busy())
        started = time.monotonic()
        await engine.process_autonomous_prompt(
            channel,
            "[AUTONOMOUS PLAN] make a safe migration plan",
            timeout_seconds=2.0,
        )
        elapsed = time.monotonic() - started
        # Initial wait (~0.05s) + post-dispatch wait (~0.05s) + polling overhead.
        assert elapsed >= 0.09

    try:
        _run(scenario())
        assert calls == ["[AUTONOMOUS PLAN] make a safe migration plan"]
    finally:
        engine._active.pop(channel, None)
        engine._user_interrupt.pop(channel, None)
