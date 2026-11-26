import hashlib
import json
import logging
import os
from ipaddress import ip_address
from typing import Annotated, Optional
from urllib.parse import urlencode, urlsplit

from core.auth import (
    IDTokenValidationError,
    build_authorization_url,
    build_logout_url,
    generate_code_challenge,
    generate_code_verifier,
    generate_nonce,
    generate_state,
    validate_id_token,
)
from core.config import settings
from core.database import get_db
from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from schemas.auth import (
    NativeConfigRequest,
    NativeLoginRequest,
    NativeExchangeRequest,
    PlatformTokenExchangeRequest,
    TokenExchangeResponse,
    UserResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from core.telemetry import observe_external_http
except Exception:  # noqa: BLE001 - optional across mixed template versions
    async def observe_external_http(operation):
        return await operation


router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
logger = logging.getLogger(__name__)


def _local_patch_enabled() -> bool:
    return os.getenv("LOCAL_PATCH", "").lower() in ("true", "1")


def _local_patch(url: str) -> str:
    """Patch URL for local development."""
    if not _local_patch_enabled():
        return url

    patched_url = url.replace("https://", "http://").replace(":8000", ":3000")
    logger.debug("[get_dynamic_backend_url] patching URL from %s to %s", url, patched_url)
    return patched_url


def _is_loopback(host: str) -> bool:
    hostname = (urlsplit(f"//{host}").hostname or "").rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return True
    try:
        address = ip_address(hostname)
    except ValueError:
        return False
    return address.is_loopback or address.is_unspecified


def _request_host(request: Request, name: str) -> str:
    """Return a header value only when it is a bare host[:port]."""
    value = (request.headers.get(name) or "").strip()
    if not value or any(c in value for c in "/@?#$ {}\t\r\n"):
        if value:
            logger.debug("[get_dynamic_backend_url] skipping unusable %s=%r", name, value)
        return ""
    return value


def get_dynamic_backend_url(request: Request) -> str:
    """Prefer public request hosts; loopback hosts (Vite's changeOrigin) fall back to PYTHON_BACKEND_URL."""
    scheme = request.headers.get("x-forwarded-proto", "https").strip().lower()
    if scheme not in ("http", "https"):
        scheme = "https"
    allow_local = _local_patch_enabled()
    for name in ("mgx-external-domain", "x-forwarded-host", "host"):
        host = _request_host(request, name)
        if host and (allow_local or not _is_loopback(host)):
            url = _local_patch(f"{scheme}://{host}").rstrip("/")
            logger.debug("[get_dynamic_backend_url] resolved %s from %s", url, name)
            return url
    # Keep the request scheme and path prefix: the platform fills placeholder hosts such as
    # http://$$BACKEND_DOMAIN$$, which must not downgrade a registered HTTPS callback.
    configured = settings.backend_url.strip()
    parsed = urlsplit(configured)
    if (
        any(c in configured for c in "$ {}\t\r\n")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or not (allow_local or not _is_loopback(parsed.netloc))
    ):
        logger.error("[get_dynamic_backend_url] PYTHON_BACKEND_URL not usable: %r", configured)
        raise HTTPException(status_code=503, detail="Public backend URL is not configured for authentication.")
    return _local_patch(f"{scheme}://{parsed.netloc}{parsed.path}".rstrip("/"))


def derive_name_from_email(email: str) -> str:
    return email.split("@", 1)[0] if email else ""


@router.get("/login")
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    """Start OIDC login flow with PKCE."""
    from services.auth import AuthService

    state = generate_state()
    nonce = generate_nonce()
    code_verifier = generate_code_verifier()
    code_challenge = generate_code_challenge(code_verifier)

    # Store state, nonce, and code verifier in database
    auth_service = AuthService(db)
    await auth_service.store_oidc_state(state, nonce, code_verifier)

    # Build redirect_uri dynamically from request
    backend_url = get_dynamic_backend_url(request)
    redirect_uri = f"{backend_url}/api/v1/auth/callback"
    logger.info("[login] Starting OIDC flow with redirect_uri=%s", redirect_uri)

    auth_url = build_authorization_url(state, nonce, code_challenge, redirect_uri=redirect_uri)
    return RedirectResponse(
        url=auth_url,
        status_code=status.HTTP_302_FOUND,
        headers={"X-Request-ID": state},
    )


def native_deployment() -> str:
    backend_url = settings.backend_url.rstrip("/")
    parsed = urlsplit(backend_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(status_code=503, detail="Native authentication requires an HTTPS backend")
    return backend_url


def native_redirect_uri(consumer_id: str) -> str:
    try:
        consumers = json.loads(os.getenv("NATIVE_AUTH_CONSUMER_IDS", "[]"))
    except ValueError:
        raise HTTPException(status_code=503, detail="Invalid Native consumer registration")
    if not isinstance(consumers, list) or any(not isinstance(item, str) for item in consumers):
        raise HTTPException(status_code=503, detail="Invalid Native consumer registration")
    if consumer_id not in consumers:
        raise HTTPException(status_code=400, detail="Unregistered Native consumer")
    return "atoms-" + hashlib.sha256(consumer_id.encode()).hexdigest()[:24] + "://auth/callback"


def expo_redirect_uri(consumer_id: str) -> str:
    native_redirect_uri(consumer_id)
    try:
        redirects = json.loads(os.getenv("NATIVE_AUTH_EXPO_REDIRECT_URIS", "{}"))
    except ValueError:
        raise HTTPException(status_code=503, detail="Invalid Expo preview registration")
    uri = redirects.get(consumer_id) if isinstance(redirects, dict) else None
    if not isinstance(uri, str):
        raise HTTPException(status_code=400, detail="Expo preview is not registered for this app")
    try:
        parsed = urlsplit(uri)
        _ = parsed.port
    except ValueError:
        raise HTTPException(status_code=503, detail="Invalid Expo preview registration")
    if (parsed.scheme != "exps" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path != "/--/auth/callback" or parsed.query or parsed.fragment
            or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in uri)):
        raise HTTPException(status_code=503, detail="Invalid Expo preview registration")
    return uri


@router.get("/native/expo/config")
async def expo_config(payload: Annotated[NativeConfigRequest, Query()]):
    return {"baseUrl": native_deployment(), "consumerId": payload.consumer_id,
            "redirectUri": expo_redirect_uri(payload.consumer_id)}


@router.get("/native/config")
async def native_config(payload: Annotated[NativeConfigRequest, Query()]):
    backend_url = native_deployment()
    return {"baseUrl": backend_url, "consumerId": payload.consumer_id,
            "redirectUri": native_redirect_uri(payload.consumer_id)}


@router.get("/native/login")
async def native_login(payload: Annotated[NativeLoginRequest, Query()], db: AsyncSession = Depends(get_db)):
    return await start_native_login(payload, db)


@router.get("/native/expo/login")
async def expo_login(payload: Annotated[NativeLoginRequest, Query()], db: AsyncSession = Depends(get_db)):
    return await start_native_login(payload, db, expo=True)


async def start_native_login(payload: NativeLoginRequest, db: AsyncSession, *, expo: bool = False):
    from services.auth import AuthService

    backend_url = native_deployment()
    (expo_redirect_uri if expo else native_redirect_uri)(payload.consumer_id)
    state = ("expo." if expo else "native.") + generate_state()
    nonce, verifier = generate_nonce(), generate_code_verifier()
    await AuthService(db).store_native_state(state, nonce, verifier, native={
        "client_state": payload.state,
        "challenge": payload.code_challenge,
        "consumer_id": payload.consumer_id,
    })
    return RedirectResponse(build_authorization_url(
        state, nonce, generate_code_challenge(verifier),
        redirect_uri=f"{backend_url}/api/v1/auth/callback",
    ), status_code=302, headers={"Cache-Control": "no-store"})


@router.post("/native/exchange", response_model=TokenExchangeResponse)
async def exchange_native_token(payload: NativeExchangeRequest, db: AsyncSession = Depends(get_db)):
    from services.auth import AuthService

    native_deployment()
    native_redirect_uri(payload.consumer_id)
    service = AuthService(db)
    user = await service.exchange_native_code(payload)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired native code")
    token, _, _ = await service.issue_app_token(user)
    return JSONResponse({"token": token}, headers={"Cache-Control": "no-store"})


@router.get("/callback")
async def callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Handle OIDC callback."""
    backend_url = get_dynamic_backend_url(request)
    native = None
    native_callback = None
    expo = False

    def redirect_with_error(message: str) -> RedirectResponse:
        if native:
            return RedirectResponse(
                url=native_callback + "?" + urlencode({
                    "error": "access_denied" if error == "access_denied" else "authentication_failed",
                    "state": native["client_state"],
                }), status_code=302, headers={"Cache-Control": "no-store"},
            )
        fragment = urlencode({"msg": message})
        return RedirectResponse(
            url=f"{backend_url}/auth/error?{fragment}",
            status_code=status.HTTP_302_FOUND,
        )

    if error and not state:
        return redirect_with_error(f"OIDC error: {error}")

    if not state or (not code and not error):
        return redirect_with_error("Missing code or state parameter")

    # Validate state using database
    from services.auth import AuthService

    auth_service = AuthService(db)
    if state.startswith(("native.", "expo.")):
        # Web-only backends need not provision the mobile state table.
        if not os.getenv("NATIVE_AUTH_CONSUMER_IDS"):
            return redirect_with_error("Native authentication is not enabled")
        backend_url = native_deployment()
        temp_data = await auth_service.get_and_delete_native_state(state)
        expo = state.startswith("expo.")
    else:
        temp_data = await auth_service.get_and_delete_oidc_state(state)
    if not temp_data:
        return redirect_with_error("Invalid or expired state parameter")

    native = temp_data.get("native")
    if native:
        native_callback = (expo_redirect_uri if expo else native_redirect_uri)(native["consumer_id"])
    if error:
        return redirect_with_error(f"OIDC error: {error}")

    nonce = temp_data["nonce"]
    code_verifier = temp_data.get("code_verifier")

    try:
        # Build redirect_uri dynamically from request
        redirect_uri = f"{backend_url}/api/v1/auth/callback"
        logger.info("[callback] Exchanging code for tokens with redirect_uri=%s", redirect_uri)

        # Exchange authorization code for tokens with PKCE
        token_data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": settings.oidc_client_id,
            "client_secret": settings.oidc_client_secret,
        }

        # Add PKCE code verifier if available
        if code_verifier:
            token_data["code_verifier"] = code_verifier

        token_url = f"{settings.oidc_issuer_url}/token"
        import httpx

        try:
            async with httpx.AsyncClient() as client:
                token_response = await observe_external_http(
                    client.post(
                        token_url,
                        data=token_data,
                        headers={"Content-Type": "application/x-www-form-urlencoded", "X-Request-ID": state},
                    )
                )
        except httpx.HTTPError as e:
            logger.error(
                "[callback] Token exchange HTTP error: url=%s, error=%s",
                token_url,
                str(e),
                exc_info=True,
            )
            return redirect_with_error(f"Token exchange failed: {e}")

        if token_response.status_code != 200:
            logger.error(
                "[callback] Token exchange failed: url=%s, status_code=%s, response=%s",
                token_url,
                token_response.status_code,
                token_response.text,
            )
            return redirect_with_error(f"Token exchange failed: {token_response.text}")

        tokens = token_response.json()

        # Validate ID token
        id_token = tokens.get("id_token")
        if not id_token:
            return redirect_with_error("No ID token received")

        id_claims = await validate_id_token(id_token)

        # Validate nonce
        if id_claims.get("nonce") != nonce:
            return redirect_with_error("Invalid nonce")

        # Get or create user
        email = id_claims.get("email", "")
        name = id_claims.get("name") or derive_name_from_email(email)
        user = await auth_service.get_or_create_user(platform_sub=id_claims["sub"], email=email, name=name)

        if native:
            handoff_code = await auth_service.issue_native_code(native, user.id)
            return RedirectResponse(
                url=native_callback + "?" + urlencode({
                    "code": handoff_code, "state": native["client_state"],
                }), status_code=302, headers={"Cache-Control": "no-store"},
            )

        # Issue application JWT token encapsulating user information
        app_token, expires_at, _ = await auth_service.issue_app_token(user=user)

        fragment = urlencode(
            {
                "token": app_token,
                "expires_at": int(expires_at.timestamp()),
                "token_type": "Bearer",
            }
        )

        redirect_url = f"{backend_url}/auth/callback?{fragment}"
        logger.info("[callback] OIDC callback successful, redirecting to %s", redirect_url)
        redirect_response = RedirectResponse(
            url=redirect_url,
            status_code=status.HTTP_302_FOUND,
        )
        return redirect_response

    except IDTokenValidationError as e:
        # Redirect to error page with validation details
        return redirect_with_error(f"Authentication failed: {e.message}")
    except HTTPException as e:
        # Redirect to error page with the original detail message
        return redirect_with_error(str(e.detail))
    except Exception as e:
        logger.exception(f"Unexpected error in OIDC callback: {e}")
        return redirect_with_error(
            "Authentication processing failed. Please try again or contact support if the issue persists."
        )


@router.post("/token/exchange", response_model=TokenExchangeResponse)
async def exchange_platform_token(
    payload: PlatformTokenExchangeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange Platform token for app token. Admin gets admin role, team members get user role."""
    import httpx
    from services.auth import AuthService

    logger.info("[token/exchange] Received platform token exchange request")

    verify_url = f"{settings.oidc_issuer_url}/platform/tokens/verify"
    logger.debug(f"[token/exchange] Verifying token with issuer: {verify_url}")

    try:
        async with httpx.AsyncClient() as client:
            verify_response = await observe_external_http(
                client.post(
                    verify_url,
                    json={"platform_token": payload.platform_token},
                    headers={"Content-Type": "application/json"},
                )
            )
        logger.debug(f"[token/exchange] Issuer response status: {verify_response.status_code}")
    except httpx.HTTPError as exc:
        logger.error(f"[token/exchange] HTTP error verifying platform token: {exc}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to verify platform token") from exc

    try:
        verify_body = verify_response.json()
        logger.debug(f"[token/exchange] Issuer response body: {verify_body}")
    except ValueError:
        logger.error(f"[token/exchange] Failed to parse issuer response as JSON: {verify_response.text}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid response from platform token verification service",
        )

    if not isinstance(verify_body, dict):
        logger.error(f"[token/exchange] Unexpected response type: {type(verify_body)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected response from platform token verification service",
        )

    if verify_response.status_code != status.HTTP_200_OK or not verify_body.get("success"):
        message = verify_body.get("message", "") if isinstance(verify_body, dict) else ""
        logger.warning(
            f"[token/exchange] Token verification failed: status={verify_response.status_code}, message={message}"
        )
        raise HTTPException(
            status_code=verify_response.status_code,
            detail=message or "Platform token verification failed",
        )

    payload_data = verify_body.get("data") or {}
    raw_user_id = payload_data.get("user_id")
    logger.info(f"[token/exchange] Token verified, platform_user_id={raw_user_id}, email={payload_data.get('email')}")

    if not raw_user_id:
        logger.error("[token/exchange] Platform token payload missing user_id")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Platform token payload missing user_id")

    platform_user_id = str(raw_user_id)
    is_admin = platform_user_id == str(settings.admin_user_id)
    role = "admin" if is_admin else "user"

    logger.info(f"[token/exchange] User verified: platform_user_id={platform_user_id}, role={role}")
    auth_service = AuthService(db)

    user_email = payload_data.get("email", "") or (getattr(settings, "admin_user_email", "") if is_admin else "")
    user_name = payload_data.get("name") or payload_data.get("username")
    if not user_name:
        user_name = derive_name_from_email(user_email)

    user = await auth_service.get_or_create_user(
        platform_sub=platform_user_id, email=user_email, name=user_name, update_existing=False,
    )
    # Preview tokens retain the current platform owner role policy.
    logger.debug(
        f"[token/exchange] User object for token issuance: id={user.id}, email={user.email}, role={role}"
    )

    app_token, expires_at, _ = await auth_service.issue_app_token(user=user, role=role)
    logger.info(f"[token/exchange] Token issued successfully for user_id={user.id}, expires_at={expires_at}")

    return TokenExchangeResponse(
        token=app_token,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: UserResponse = Depends(get_current_user)):
    """Get current user info."""
    return current_user


@router.get("/logout")
async def logout():
    """Logout user."""
    logout_url = build_logout_url()
    return {"redirect_url": logout_url}
