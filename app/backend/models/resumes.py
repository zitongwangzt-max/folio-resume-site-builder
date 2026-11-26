from datetime import date, datetime, timezone
from typing import Any, Optional

from core.database import Base
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column


class Resumes(Base):
    __tablename__ = 'resumes'
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, nullable=False, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    source_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    profile_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_style: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    avatar_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
