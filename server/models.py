"""AI Office — Pydantic models."""

from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


class MessageIn(BaseModel):
    channel: str = "main"
    content: str
    msg_type: Literal["message", "task", "decision", "tool_request", "tool_result", "review"] = "message"
    parent_id: Optional[int] = None


class MessageOut(BaseModel):
    id: int
    channel: str
    sender: str
    content: str
    msg_type: str = "message"
    parent_id: Optional[int] = None
    pinned: bool = False
    created_at: str


class AgentOut(BaseModel):
    id: str
    display_name: str
    role: str
    skills: str  # JSON string
    backend: str
    model: str
    permissions: str
    active: bool
    color: str
    emoji: str
    system_prompt: Optional[str] = None


class AgentUpdateIn(BaseModel):
    model_config = {"extra": "forbid"}

    display_name: Optional[str] = None
    role: Optional[str] = None
    backend: Optional[Literal["ollama", "claude", "openai"]] = None
    model: Optional[str] = None
    permissions: Optional[str] = None
    active: Optional[bool] = None
    color: Optional[str] = None
    emoji: Optional[str] = None
    system_prompt: Optional[str] = None


class TaskIn(BaseModel):
    title: str
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    channel: Optional[str] = None
    project_name: Optional[str] = None
    branch: Optional[str] = None
    priority: int = Field(default=2, ge=1, le=3)
    subtasks: list[dict] = Field(default_factory=list)
    linked_files: list[str] = Field(default_factory=list)
    depends_on: list[int] = Field(default_factory=list)
    created_by: Optional[str] = "user"


class TaskUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[Literal["backlog", "in_progress", "review", "blocked", "done"]] = None
    assigned_to: Optional[str] = None
    channel: Optional[str] = None
    project_name: Optional[str] = None
    branch: Optional[str] = None
    priority: Optional[int] = Field(default=None, ge=1, le=3)
    subtasks: Optional[list[dict]] = None
    linked_files: Optional[list[str]] = None
    depends_on: Optional[list[int]] = None


class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    status: str
    assigned_to: Optional[str]
    channel: str = "main"
    project_name: str = "ai-office"
    branch: str = "main"
    created_by: Optional[str]
    priority: int
    subtasks: list[dict] = Field(default_factory=list)
    linked_files: list[str] = Field(default_factory=list)
    depends_on: list[int] = Field(default_factory=list)
    created_at: str
    updated_at: str


class AppBuilderStartIn(BaseModel):
    channel: str = "main"
    app_name: str = "Generated App"
    goal: str = Field(..., min_length=3, max_length=4000)
    stack: Literal["react-fastapi", "react-node", "nextjs", "python-desktop", "custom"] = "react-fastapi"
    target_dir: Optional[str] = None
    include_tests: bool = True


class OllamaPullIn(BaseModel):
    model_config = {"extra": "forbid"}

    models: list[str] = Field(default_factory=list)
    include_recommended: bool = True
    pull_missing_only: bool = True


class ReactionToggleIn(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=16)
    actor_id: str = "user"
    actor_type: Literal["user", "agent"] = "user"


class ProjectCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    template: Optional[Literal["react", "python", "rust"]] = None


class ProjectSwitchIn(BaseModel):
    channel: str = "main"
    name: str


class BranchSwitchIn(BaseModel):
    channel: str = "main"
    branch: str = Field(..., min_length=1, max_length=120)
    create_if_missing: bool = False


class MergePreviewIn(BaseModel):
    source_branch: str = Field(..., min_length=1, max_length=120)
    target_branch: str = Field(..., min_length=1, max_length=120)


class MergeApplyIn(BaseModel):
    source_branch: str = Field(..., min_length=1, max_length=120)
    target_branch: str = Field(..., min_length=1, max_length=120)
    allow_dirty_override: bool = False


class ProjectActiveOut(BaseModel):
    channel: str
    project: str
    path: str
    is_app_root: bool = False
    branch: str = "main"


class BuildConfigIn(BaseModel):
    build_cmd: Optional[str] = None
    test_cmd: Optional[str] = None
    run_cmd: Optional[str] = None


class ExecuteCodeIn(BaseModel):
    language: Literal["python", "javascript", "bash"]
    code: str = Field(..., min_length=1, max_length=60000)


AutonomyMode = Literal["SAFE", "TRUSTED", "ELEVATED"]
PermissionMode = Literal["locked", "ask", "trusted"]


class AutonomyModeIn(BaseModel):
    mode: AutonomyMode


class PermissionPolicyIn(BaseModel):
    channel: str = "main"
    mode: PermissionMode = "ask"
    expires_at: Optional[str] = None
    scopes: list[str] = Field(default_factory=list)
    command_allowlist_profile: str = "safe"


class PermissionPolicyOut(BaseModel):
    channel: str
    mode: PermissionMode
    expires_at: Optional[str] = None
    scopes: list[str] = Field(default_factory=list)
    command_allowlist_profile: str = "safe"


class TrustSessionIn(BaseModel):
    channel: str = "main"
    minutes: int = Field(default=30, ge=1, le=1440)
    scopes: list[str] = Field(default_factory=list)
    command_allowlist_profile: str = "safe"


class ApprovalResponseIn(BaseModel):
    request_id: str = Field(..., min_length=6, max_length=64)
    approved: bool
    decided_by: str = "user"


class ProcessStartIn(BaseModel):
    channel: str = "main"
    command: str = Field(..., min_length=1, max_length=1000)
    name: Optional[str] = None
    project: Optional[str] = None
    agent_id: str = "user"
    approved: bool = False
    task_id: Optional[str] = None


class ProcessStopIn(BaseModel):
    channel: str = "main"
    process_id: str = Field(..., min_length=1, max_length=80)


class ProcessInfoOut(BaseModel):
    id: str
    name: str
    channel: str
    project: Optional[str] = None
    cwd: Optional[str] = None
    command: str
    pid: Optional[int] = None
    status: str
    port: Optional[int] = None
    policy_mode: Optional[str] = None
    permission_mode: Optional[str] = None
    started_at: Optional[int] = None
    ended_at: Optional[int] = None
    exit_code: Optional[int] = None


class ConsoleEventOut(BaseModel):
    id: int
    channel: str
    project_name: Optional[str] = None
    event_type: str
    source: str
    severity: str = "info"
    message: Optional[str] = None
    data: dict = Field(default_factory=dict)
    created_at: str


class CreateSkillIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    channel: str = "main"
    agent_id: str = "user"


class PolicyDecisionOut(BaseModel):
    allowed: bool
    requires_approval: bool = False
    mode: AutonomyMode
    project: str
    tool_type: str
    reason: str
    timeout_seconds: int = 45
    output_limit: int = 12000


class VerificationLoopEventOut(BaseModel):
    project: str
    stage: Literal["build", "test"]
    ok: bool
    exit_code: Optional[int] = None
    attempt: int = 1
    summary: Optional[str] = None


class WSMessage(BaseModel):
    """WebSocket message envelope."""
    type: Literal["chat", "typing", "ping", "system"] = "chat"
    channel: str = "main"
    content: str = ""
    msg_type: str = "message"
    parent_id: Optional[int] = None
