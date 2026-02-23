import asyncio
import time

from server import main


def _run(coro):
    return asyncio.run(coro)


async def _cleanup_ingest(channel: str) -> None:
    main.manager._channels.pop(channel, None)
    await main._detach_ws_ingest_worker_if_idle(channel)
    await main._reset_ws_ingest_state()


def test_ws_ingest_serializes_messages_per_channel(monkeypatch):
    channel = f"ws-queue-serial-{int(time.time())}"
    processed: list[str] = []
    in_flight = {"count": 0, "max": 0}

    async def fake_process(target_channel: str, content: str):
        assert target_channel == channel
        in_flight["count"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["count"])
        await asyncio.sleep(0.02)
        processed.append(content)
        in_flight["count"] -= 1

    async def fake_send_personal(_ws, _message):
        return None

    async def scenario():
        await main._reset_ws_ingest_state()
        monkeypatch.setattr(main, "WS_INGEST_QUEUE_MAX", 4)
        monkeypatch.setattr(main, "process_message", fake_process)
        monkeypatch.setattr(main.manager, "send_personal", fake_send_personal)
        main.manager._channels[channel] = {object()}

        await main._enqueue_ws_message(channel, "first", object())
        await main._enqueue_ws_message(channel, "second", object())
        queue = main._ws_ingest_queues[channel]
        await queue.join()

        assert processed == ["first", "second"]
        assert in_flight["max"] == 1

        await _cleanup_ingest(channel)

    _run(scenario())


def test_ws_ingest_emits_backpressure_signal_when_queue_is_full(monkeypatch):
    channel = f"ws-queue-backpressure-{int(time.time())}"
    processed: list[str] = []
    notices: list[dict] = []
    started = asyncio.Event()
    release = asyncio.Event()

    async def fake_process(target_channel: str, content: str):
        assert target_channel == channel
        if content == "first":
            started.set()
            await release.wait()
        processed.append(content)

    async def fake_send_personal(_ws, message):
        notices.append(dict(message))

    async def scenario():
        await main._reset_ws_ingest_state()
        monkeypatch.setattr(main, "WS_INGEST_QUEUE_MAX", 1)
        monkeypatch.setattr(main, "process_message", fake_process)
        monkeypatch.setattr(main.manager, "send_personal", fake_send_personal)
        main.manager._channels[channel] = {object()}

        await main._enqueue_ws_message(channel, "first", object())
        await started.wait()

        await main._enqueue_ws_message(channel, "second", object())
        enqueue_third = asyncio.create_task(main._enqueue_ws_message(channel, "third", object()))
        await asyncio.sleep(0.05)

        assert notices
        assert notices[-1].get("type") == "ingest_backpressure"
        assert enqueue_third.done() is False

        release.set()
        await enqueue_third
        queue = main._ws_ingest_queues[channel]
        await queue.join()
        assert processed == ["first", "second", "third"]

        await _cleanup_ingest(channel)

    _run(scenario())
