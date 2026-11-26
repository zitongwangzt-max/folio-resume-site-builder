from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UserResponse(BaseModel):
    id: str  # Now a string UUID (platform sub)
    email: str
    name: Optional[str] = None
    role: str = "user"  # user/admin
    last_login: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PlatformTokenExchangeRequest(BaseModel):
    """Request body for exchanging Platform token for app token."""

    platform_token: str


class TokenExchangeResponse(BaseModel):
    """Response body for issued application token."""

    token: str


class NativeConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consumer_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")


class NativeLoginRequest(NativeConfigRequest):
    state: str = Field(pattern=r"^[A-Za-z0-9_-]{32,128}$")
    code_challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


class NativeExchangeRequest(NativeConfigRequest):
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    code_verifier: str = Field(pattern=r"^[A-Za-z0-9._~-]{43,128}$")
