import hashlib
import secrets
import logging
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from core.auth import create_access_token, generate_code_challenge
from core.config import settings
from models.auth import MobileAuthState, OIDCState, User
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_user(
        self, platform_sub: str, email: str, name: Optional[str] = None, *, update_existing: bool = True,
    ) -> User:
        """Get existing user or create new one."""
        start_time = time.time()
        logger.debug(f"[DB_OP] Starting get_or_create_user - platform_sub: {platform_sub}")
        # Try to find existing user
        result = await self.db.execute(select(User).where(User.id == platform_sub))
        user = result.scalar_one_or_none()
        logger.debug(f"[DB_OP] User lookup completed in {time.time() - start_time:.4f}s - found: {user is not None}")
        admin_user_id = str(getattr(settings, "admin_user_id", "") or "")
        is_admin = bool(admin_user_id) and platform_sub == admin_user_id
        last_login = datetime.now(timezone.utc)

        if user is None:
            # Create new user
            user = User(
                id=platform_sub,
                email=email,
                name=name,
                role="admin" if is_admin else "user",
                last_login=last_login,
            )
            self.db.add(user)
            try:
                await self.db.flush()
            except IntegrityError:
                # A concurrent first login may have inserted this subject already.
                await self.db.rollback()
                result = await self.db.execute(select(User).where(User.id == platform_sub))
                user = result.scalar_one_or_none()
                if user is None:
                    raise

        if update_existing:
            user.email = email
            user.name = name
            if is_admin:
                user.role = "admin"
        user.last_login = last_login

        start_time_commit = time.time()
        logger.debug("[DB_OP] Starting user commit/refresh")
        await self.db.commit()
        await self.db.refresh(user)
        logger.debug(f"[DB_OP] User commit/refresh completed in {time.time() - start_time_commit:.4f}s")
        return user

    async def issue_app_token(
        self,
        user: User,
        *,
        role: Optional[str] = None,
    ) -> Tuple[str, datetime, Dict[str, Any]]:
        """Generate application JWT token for the authenticated user."""
        try:
            expires_minutes = int(getattr(settings, "jwt_expire_minutes", 60))
        except (TypeError, ValueError):
            logger.warning("Invalid JWT_EXPIRE_MINUTES value; fallback to 60 minutes")
            expires_minutes = 60
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)

        claims: Dict[str, Any] = {
            "sub": user.id,
            "email": user.email,
            "role": user.role if role is None else role,
        }

        if user.name:
            claims["name"] = user.name
        if user.last_login:
            claims["last_login"] = user.last_login.isoformat()
        token = create_access_token(claims, expires_minutes=expires_minutes)

        return token, expires_at, claims

    async def store_oidc_state(self, state: str, nonce: str, code_verifier: str):
        """Store OIDC state in database."""
        # Clean up expired states first
        await self.db.execute(delete(OIDCState).where(OIDCState.expires_at < datetime.now(timezone.utc)))

        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)  # 10 minute expiry

        oidc_state = OIDCState(state=state, nonce=nonce, code_verifier=code_verifier, expires_at=expires_at)

        self.db.add(oidc_state)
        await self.db.commit()

    async def get_and_delete_oidc_state(self, state: str) -> Optional[dict]:
        """Get and delete OIDC state from database."""
        # Clean up expired states first
        await self.db.execute(delete(OIDCState).where(OIDCState.expires_at < datetime.now(timezone.utc)))

        result = await self.db.execute(select(OIDCState).where(OIDCState.state == state))
        oidc_state = result.scalar_one_or_none()
        if not oidc_state:
            await self.db.commit()
            return None
        state_data = {"nonce": oidc_state.nonce, "code_verifier": oidc_state.code_verifier}
        # The conditional DELETE elects one winner without MySQL-incompatible RETURNING.
        consumed = await self.db.execute(delete(OIDCState).where(
            OIDCState.state == state, OIDCState.expires_at > datetime.now(timezone.utc),
        ).execution_options(synchronize_session=False))
        if consumed.rowcount != 1:
            await self.db.commit()
            return None
        await self.db.commit()
        return state_data

    @staticmethod
    def native_key(value: str, purpose: str) -> str:
        # Trusted deployment URL isolates DEV/PROD even when they share a database.
        scoped = [settings.backend_url.rstrip("/"), purpose, value]
        return hashlib.sha256(json.dumps(scoped, separators=(",", ":")).encode()).hexdigest()

    async def store_native_state(self, state: str, nonce: str, code_verifier: str, native: dict):
        await self.db.execute(delete(MobileAuthState).where(MobileAuthState.expires_at < datetime.now(timezone.utc)))
        self.db.add(MobileAuthState(
            key=self.native_key(state, "state"), nonce=nonce, code_verifier=code_verifier,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10), **native,
        ))
        await self.db.commit()

    async def get_and_delete_native_state(self, state: str) -> Optional[dict]:
        conditions = (
            MobileAuthState.key == self.native_key(state, "state"),
            MobileAuthState.user_id.is_(None),
            MobileAuthState.expires_at > datetime.now(timezone.utc),
        )
        result = await self.db.execute(select(MobileAuthState).where(*conditions))
        pending = result.scalar_one_or_none()
        if pending is None:
            return None
        data = {"nonce": pending.nonce, "code_verifier": pending.code_verifier,
                "native": {field: getattr(pending, field) for field in ("consumer_id", "client_state", "challenge")}}
        consumed = await self.db.execute(delete(MobileAuthState).where(*conditions).execution_options(synchronize_session=False))
        await self.db.commit()
        return data if consumed.rowcount == 1 else None

    async def issue_native_code(self, native: dict, user_id: str) -> str:
        code = secrets.token_urlsafe(32)
        self.db.add(MobileAuthState(
            key=self.native_key(code, "code"), user_id=user_id,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=60), **native,
        ))
        await self.db.commit()
        return code

    async def exchange_native_code(self, payload) -> Optional[User]:
        # Failed PKCE checks must not let a code interceptor invalidate a legitimate login.
        conditions = (
            MobileAuthState.key == self.native_key(payload.code, "code"),
            MobileAuthState.consumer_id == payload.consumer_id,
            MobileAuthState.challenge == generate_code_challenge(payload.code_verifier),
            MobileAuthState.expires_at > datetime.now(timezone.utc),
            MobileAuthState.user_id.is_not(None),
        )
        result = await self.db.execute(select(MobileAuthState.user_id).where(*conditions))
        user_id = result.scalar_one_or_none()
        if user_id is None:
            await self.db.commit()
            return None
        consumed = await self.db.execute(delete(MobileAuthState).where(*conditions).execution_options(synchronize_session=False))
        await self.db.commit()
        if consumed.rowcount != 1:
            return None
        return await self.db.get(User, user_id)
