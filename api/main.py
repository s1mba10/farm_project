import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"
DB_PATH = os.getenv("DB_PATH", "/data/farm.db")
QUESTIONS_PATH = os.getenv("QUESTIONS_PATH", "/data/questions.json")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
TG_BOT_USERNAME = os.getenv("TG_BOT_USERNAME", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
TELEGRAM_AUTH_TTL = 86400  # widget data accepted within 24h
SESSION_TTL = 7 * 24 * 3600
SUBSCRIPTION_DAYS = 7

app = FastAPI(title="farm-test api")


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tg_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                paid_until INTEGER NOT NULL DEFAULT 0,
                active_session TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """
        )
        conn.commit()


init_db()


def now() -> int:
    return int(time.time())


def issue_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now(), now() + SESSION_TTL),
        )
        conn.execute("UPDATE users SET active_session = ? WHERE id = ?", (token, user_id))
        conn.commit()
    return token


def get_user_from_session(token: str | None):
    if not token:
        return None, "no_session"
    with db() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.tg_id, u.name, u.paid_until, u.active_session, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
    if not row:
        return None, "no_session"
    if row["expires_at"] < now():
        return None, "expired_session"
    if row["active_session"] != token:
        return None, "kicked"
    return dict(row), None


def require_user(session: str | None = Cookie(default=None)):
    user, err = get_user_from_session(session)
    if err == "no_session":
        raise HTTPException(401, detail={"error": "no_session"})
    if err == "expired_session":
        raise HTTPException(401, detail={"error": "expired_session"})
    if err == "kicked":
        raise HTTPException(403, detail={"error": "kicked"})
    if user["paid_until"] < now():
        raise HTTPException(402, detail={"error": "payment_required", "name": user["name"]})
    return user


@app.get("/api/health")
def health():
    return {"ok": True, "dev_mode": DEV_MODE}


@app.get("/api/config")
def config():
    """Public config for frontend: which login methods are available."""
    return {
        "dev_mode": DEV_MODE,
        "tg_bot_username": TG_BOT_USERNAME,
        "subscription_days": SUBSCRIPTION_DAYS,
    }


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "session",
        token,
        httponly=True,
        max_age=SESSION_TTL,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


def upsert_user(tg_id: str, name: str) -> int:
    with db() as conn:
        row = conn.execute("SELECT id FROM users WHERE tg_id = ?", (tg_id,)).fetchone()
        if row:
            user_id = row["id"]
            conn.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
        else:
            cur = conn.execute(
                "INSERT INTO users (tg_id, name, paid_until, created_at) VALUES (?, ?, 0, ?)",
                (tg_id, name, now()),
            )
            user_id = cur.lastrowid
        conn.commit()
        return user_id


def get_user_summary(user_id: int) -> dict:
    with db() as conn:
        u = conn.execute(
            "SELECT name, paid_until FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    paid = u["paid_until"] > now()
    return {"name": u["name"], "paid_until": u["paid_until"], "paid": paid}


class DevLoginRequest(BaseModel):
    name: str


@app.post("/api/auth/dev-login")
def dev_login(req: DevLoginRequest, response: Response):
    if not DEV_MODE:
        raise HTTPException(404, detail={"error": "not_found"})
    name = req.name.strip()
    if not name or len(name) > 64:
        raise HTTPException(400, detail={"error": "bad_name"})
    tg_id = f"dev:{name.lower()}"
    user_id = upsert_user(tg_id, name)
    token = issue_session(user_id)
    set_session_cookie(response, token)
    return get_user_summary(user_id)


def verify_telegram_auth(data: dict) -> bool:
    """Verify Telegram Login Widget signature.

    https://core.telegram.org/widgets/login#checking-authorization
    """
    if not BOT_TOKEN:
        return False
    payload = {k: v for k, v in data.items() if k != "hash" and v is not None}
    received_hash = data.get("hash")
    if not received_hash:
        return False
    check_string = "\n".join(f"{k}={payload[k]}" for k in sorted(payload))
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        return False
    try:
        auth_date = int(payload.get("auth_date", 0))
    except (TypeError, ValueError):
        return False
    if now() - auth_date > TELEGRAM_AUTH_TTL:
        return False
    return True


class TelegramLoginRequest(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str


@app.post("/api/auth/telegram")
def telegram_login(req: TelegramLoginRequest, response: Response):
    if not BOT_TOKEN:
        raise HTTPException(503, detail={"error": "telegram_not_configured"})
    data = req.model_dump(exclude_none=True)
    if not verify_telegram_auth(data):
        raise HTTPException(401, detail={"error": "bad_signature"})
    tg_id = f"tg:{req.id}"
    name = (req.first_name or req.username or f"user{req.id}").strip()[:64]
    user_id = upsert_user(tg_id, name)
    summary = get_user_summary(user_id)
    if not summary["paid"]:
        raise HTTPException(
            402,
            detail={
                "error": "payment_required",
                "name": summary["name"],
                "tg_bot_username": TG_BOT_USERNAME,
            },
        )
    token = issue_session(user_id)
    set_session_cookie(response, token)
    return summary


class AdminGrantRequest(BaseModel):
    tg_id: int
    days: int = SUBSCRIPTION_DAYS
    name: str | None = None


@app.post("/api/admin/grant")
def admin_grant(req: AdminGrantRequest, x_admin_token: str = Header(default="")):
    if not ADMIN_TOKEN or not hmac.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(403, detail={"error": "forbidden"})
    if req.days <= 0 or req.days > 365:
        raise HTTPException(400, detail={"error": "bad_days"})
    full_tg_id = f"tg:{req.tg_id}"
    name = (req.name or f"user{req.tg_id}").strip()[:64] or f"user{req.tg_id}"
    user_id = upsert_user(full_tg_id, name)
    with db() as conn:
        cur_until = conn.execute(
            "SELECT paid_until FROM users WHERE id = ?", (user_id,)
        ).fetchone()["paid_until"]
        base = max(cur_until, now())
        new_until = base + req.days * 86400
        conn.execute("UPDATE users SET paid_until = ? WHERE id = ?", (new_until, user_id))
        conn.commit()
    return {"tg_id": req.tg_id, "name": name, "paid_until": new_until}


@app.get("/api/auth/me")
def me(session: str | None = Cookie(default=None)):
    user, err = get_user_from_session(session)
    if err == "no_session":
        return JSONResponse({"error": "no_session"}, status_code=401)
    if err == "expired_session":
        return JSONResponse({"error": "expired_session"}, status_code=401)
    if err == "kicked":
        return JSONResponse({"error": "kicked"}, status_code=403)
    paid = user["paid_until"] > now()
    return {
        "name": user["name"],
        "paid_until": user["paid_until"],
        "paid": paid,
    }


@app.post("/api/auth/logout")
def logout(response: Response, session: str | None = Cookie(default=None)):
    if session:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (session,))
            conn.execute("UPDATE users SET active_session = NULL WHERE active_session = ?", (session,))
            conn.commit()
    response.delete_cookie("session")
    return {"ok": True}


@app.post("/api/mock-pay")
def mock_pay(user=Depends(lambda session=Cookie(default=None): _user_or_payment_pending(session))):
    if not DEV_MODE:
        raise HTTPException(404, detail={"error": "not_found"})
    base = max(user["paid_until"], now())
    new_until = base + SUBSCRIPTION_DAYS * 86400
    with db() as conn:
        conn.execute("UPDATE users SET paid_until = ? WHERE id = ?", (new_until, user["id"]))
        conn.commit()
    return {"paid_until": new_until}


def _user_or_payment_pending(session: str | None):
    """Allow access for users who are authenticated but possibly unpaid (used by mock-pay)."""
    user, err = get_user_from_session(session)
    if err == "no_session":
        raise HTTPException(401, detail={"error": "no_session"})
    if err == "expired_session":
        raise HTTPException(401, detail={"error": "expired_session"})
    if err == "kicked":
        raise HTTPException(403, detail={"error": "kicked"})
    return user


@app.get("/api/questions")
def questions(user=Depends(require_user)):
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)
