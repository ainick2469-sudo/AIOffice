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
    priority: int = 0


class TaskOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    status: str
    assigned_to: Optional[str]
    created_by: Optional[str]
    priority: int
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


class BuildConfigIn(BaseModel):
    build_cmd: Optional[str] = None
    test_cmd: Optional[str] = None
    run_cmd: Optional[str] = None


class ExecuteCodeIn(BaseModel):
    language: Literal["python", "javascript", "bash"]
    code: str = Field(..., min_length=1, max_length=60000)


class WSMessage(BaseModel):
    """WebSocket message envelope."""
    type: Literal["chat", "typing", "ping", "system"] = "chat"
    channel: str = "main"
    content: str = ""
    msg_type: str = "message"
    parent_id: Optional[int] = None
