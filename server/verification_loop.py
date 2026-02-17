"""Post-write verification loop for build/test/fix cycles."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from . import build_runner, database as db, project_manager
from .websocket import manager


async def _record_stage(
    *,
    agent_id: str,
    channel: str,
    project_name: str,
    stage: str,
    result: dict[str, Any],
    format_result: Callable[[str, dict[str, Any]], str],
    send_system_message: Callable[[str, str, str], Awaitable[Any]],
) -> None:
    await db.log_build_result(
        agent_id=agent_id,
        channel=channel,
        project_name=project_name,
        stage=stage,
        success=bool(result.get("ok")),
        exit_code=result.get("exit_code"),
        summary=(result.get("stderr") or result.get("error") or result.get("stdout") or "")[:500],
    )
    await manager.broadcast(channel, {"type": "build_result", "stage": stage, "result": result})
    await send_system_message(channel, format_result(stage, result), "tool_result")
    await db.log_console_event(
        channel=channel,
        event_type="verification_stage",
        source="verification_loop",
        message=f"{stage} {'passed' if result.get('ok') else 'failed'}",
        project_name=project_name,
        data={
            "stage": stage,
            "ok": bool(result.get("ok")),
            "exit_code": result.get("exit_code"),
            "command": result.get("command"),
        },
    )


async def run_post_write_verification(
    *,
    agent: dict[str, Any],
    channel: str,
    max_attempts: int,
    format_result: Callable[[str, dict[str, Any]], str],
    send_system_message: Callable[[str, str, str], Awaitable[Any]],
    generate_fix_response: Callable[[dict[str, Any], str], Awaitable[str | None]],
    send_agent_message: Callable[[dict[str, Any], str, str], Awaitable[Any]],
    reset_agent_failure: Callable[[str, str], None],
    maybe_escalate_to_nova: Callable[[str, str, str, str], Awaitable[bool]],
    enter_war_room: Callable[[str, str, str], Awaitable[Any]],
    exit_war_room: Callable[[str, str, str], Awaitable[Any]],
    war_room_active: Callable[[str], bool],
) -> dict[str, Any]:
    active = await project_manager.get_active_project(channel)
    project_name = active["project"]
    config = build_runner.get_build_config(project_name)
    build_cmd = (config.get("build_cmd") or "").strip()
    test_cmd = (config.get("test_cmd") or "").strip()
    if not build_cmd:
        return {"ok": True, "skipped": True, "reason": "build_not_configured"}

    await db.log_console_event(
        channel=channel,
        event_type="verification_start",
        source="verification_loop",
        message="Starting post-write verification loop.",
        project_name=project_name,
        data={"agent_id": agent["id"], "build_cmd": build_cmd, "test_cmd": test_cmd},
    )

    build_passed = False
    for attempt in range(1, max_attempts + 1):
        build_result = build_runner.run_build(project_name)
        await _record_stage(
            agent_id=agent["id"],
            channel=channel,
            project_name=project_name,
            stage="build",
            result=build_result,
            format_result=format_result,
            send_system_message=send_system_message,
        )
        if build_result.get("ok"):
            reset_agent_failure(channel, agent["id"])
            build_passed = True
            break

        failure_context = (
            f"Build attempt {attempt} failed.\n"
            f"Command: {build_result.get('command', build_cmd)}\n"
            f"Error:\n{(build_result.get('stderr') or build_result.get('error') or '')[:3000]}"
        )
        if attempt >= max_attempts:
            await enter_war_room(
                channel,
                f"Build failing repeatedly in project `{project_name}`",
                "auto-build-failure",
            )
            await maybe_escalate_to_nova(channel, agent["id"], "repeated build failure", failure_context)
            return {"ok": False, "stage": "build", "attempts": attempt}

        await send_system_message(
            channel,
            f"Build failed (attempt {attempt}/{max_attempts}). Asking {agent['display_name']} to fix.",
            "system",
        )
        fix_response = await generate_fix_response(agent, channel)
        if not fix_response:
            await maybe_escalate_to_nova(
                channel,
                agent["id"],
                "empty response during build-fix loop",
                failure_context,
            )
            return {"ok": False, "stage": "build", "attempts": attempt}
        await send_agent_message(agent, channel, fix_response)

    if not test_cmd:
        if build_passed and war_room_active(channel):
            await exit_war_room(channel, "build passing again", agent["display_name"])
        return {"ok": True, "stage": "build"}

    for attempt in range(1, max_attempts + 1):
        test_result = build_runner.run_test(project_name)
        await _record_stage(
            agent_id=agent["id"],
            channel=channel,
            project_name=project_name,
            stage="test",
            result=test_result,
            format_result=format_result,
            send_system_message=send_system_message,
        )
        if test_result.get("ok"):
            reset_agent_failure(channel, agent["id"])
            if war_room_active(channel):
                await exit_war_room(channel, "build and tests passing again", agent["display_name"])
            return {"ok": True, "stage": "test"}

        failure_context = (
            f"Test attempt {attempt} failed.\n"
            f"Command: {test_result.get('command', test_cmd)}\n"
            f"Error:\n{(test_result.get('stderr') or test_result.get('error') or '')[:3000]}"
        )
        if attempt >= max_attempts:
            await enter_war_room(
                channel,
                f"Tests failing repeatedly in project `{project_name}`",
                "auto-test-failure",
            )
            await maybe_escalate_to_nova(channel, agent["id"], "repeated test failure", failure_context)
            return {"ok": False, "stage": "test", "attempts": attempt}

        await send_system_message(
            channel,
            f"Tests failed (attempt {attempt}/{max_attempts}). Asking {agent['display_name']} to fix.",
            "system",
        )
        fix_response = await generate_fix_response(agent, channel)
        if not fix_response:
            await maybe_escalate_to_nova(
                channel,
                agent["id"],
                "empty response during test-fix loop",
                failure_context,
            )
            return {"ok": False, "stage": "test", "attempts": attempt}
        await send_agent_message(agent, channel, fix_response)

    return {"ok": False, "stage": "unknown"}
