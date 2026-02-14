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


class WSMessage(BaseModel):
    """WebSocket message envelope."""
    type: Literal["chat", "typing", "ping", "system"] = "chat"
    channel: str = "main"
    content: str = ""
    msg_type: str = "message"
    parent_id: Optional[int] = None
