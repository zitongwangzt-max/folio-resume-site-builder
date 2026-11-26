from datetime import datetime
from typing import Optional

from models.base import Base
from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(255), primary_key=True, index=True)  # Use platform sub as primary key
    email: Mapped[str] = mapped_column(String(255))
    name: Mapped[Optional[str]] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="user")  # Durable app role; preview JWT role is separate.
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class OIDCState(Base):
    __tablename__ = "oidc_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    state: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    nonce: Mapped[str] = mapped_column(String(255))
    code_verifier: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MobileAuthState(Base):
    """Two short-lived row types in the Native handoff table.

    /native/login creates a pending row for 10 minutes with user_id NULL:
    the user has not authenticated at the IdP yet. Callback consumes it and,
    after authentication, inserts a separate 60-second code row with user_id.
    Exchange requires user_id IS NOT NULL and atomically deletes the code row.
    """

    __tablename__ = "mobile_auth_states"

    # Keys hash the configured backend URL, row purpose and random state/code.
    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    client_state: Mapped[str] = mapped_column(String(128))  # App correlation/CSRF state echoed on redirect.
    challenge: Mapped[str] = mapped_column(String(43))  # App's S256 PKCE challenge, checked at exchange.
    consumer_id: Mapped[str] = mapped_column(String(128))
    nonce: Mapped[Optional[str]] = mapped_column(String(255))  # Pending OIDC login only.
    code_verifier: Mapped[Optional[str]] = mapped_column(String(255))  # Pending OIDC login only.
    user_id: Mapped[Optional[str]] = mapped_column(String(255))  # NULL pending; authenticated subject for code.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)  # Pending: 10m; code: 60s.
