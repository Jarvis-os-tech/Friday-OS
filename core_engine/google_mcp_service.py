"""
Google MCP Service for Friday-OS.
Handles Gmail + Google Calendar + Google Tasks via OAuth2 refresh tokens.
All agents access this through actuator_dispatcher.dispatch_tool().

Token file: ~/.config/friday-os/google_tokens.json
Setup:      python3 scripts/google_auth_setup.py
"""

import os
import json
import time
import asyncio
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from typing import Dict, Any, List, Optional

TOKEN_FILE = Path.home() / ".config" / "friday-os" / "google_tokens.json"

CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
TOKEN_URL     = "https://oauth2.googleapis.com/token"

GMAIL_BASE    = "https://gmail.googleapis.com/gmail/v1/users/me"
CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
TASKS_BASE    = "https://tasks.googleapis.com/tasks/v1"


# ─── Token Management ──────────────────────────────────────────────────────────

def _get_client_creds():
    client_id = os.getenv("GOOGLE_CLIENT_ID") or CLIENT_ID
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET") or CLIENT_SECRET
    if not client_id or not client_secret:
        cs_path = Path.home() / ".config" / "gws" / "client_secret.json"
        if cs_path.exists():
            try:
                with open(cs_path) as f:
                    cs = json.load(f).get("installed", {})
                    client_id = cs.get("client_id", client_id)
                    client_secret = cs.get("client_secret", client_secret)
            except Exception:
                pass
    return client_id, client_secret


def _load_tokens() -> Dict[str, Any]:
    if not TOKEN_FILE.exists():
        raise RuntimeError(
            "Google tokens not found. Run: python3 scripts/google_auth_setup.py"
        )
    with open(TOKEN_FILE) as f:
        return json.load(f)


def _save_tokens(tokens: Dict[str, Any]):
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        json.dump(tokens, f, indent=2)


def _refresh_access_token(refresh_token: str) -> Dict[str, Any]:
    client_id, client_secret = _get_client_creds()
    if not client_id or not client_secret:
        raise RuntimeError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured in .env")

    data = urllib.parse.urlencode({
        "client_id":     client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())



def _get_valid_access_token() -> str:
    tokens = _load_tokens()
    now = time.time()
    # Refresh if expired or within 5 minutes of expiry
    if now >= tokens.get("expires_at", 0) - 300:
        refreshed = _refresh_access_token(tokens["refresh_token"])
        tokens["access_token"] = refreshed["access_token"]
        tokens["expires_at"]   = now + refreshed.get("expires_in", 3600)
        _save_tokens(tokens)
    return tokens["access_token"]


# ─── HTTP Helper ───────────────────────────────────────────────────────────────

def _api_call(method: str, url: str, body: Optional[Dict] = None,
              params: Optional[Dict] = None) -> Dict[str, Any]:
    token = _get_valid_access_token()
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode(errors="replace")
        return {"error": f"HTTP {e.code}: {error_body[:300]}"}
    except Exception as ex:
        return {"error": str(ex)}


# ─── Gmail Tools ──────────────────────────────────────────────────────────────

def gmail_search(query: str, max_results: int = 10) -> Dict[str, Any]:
    """Search Gmail with standard query syntax (e.g. 'from:boss is:unread')."""
    res = _api_call("GET", f"{GMAIL_BASE}/messages",
                    params={"q": query, "maxResults": min(max_results, 50)})
    if "error" in res:
        return {"success": False, "error": res["error"]}

    messages = res.get("messages", [])
    results = []
    for msg in messages[:max_results]:
        detail = _api_call("GET", f"{GMAIL_BASE}/messages/{msg['id']}",
                           params={"format": "metadata",
                                   "metadataHeaders": "From,Subject,Date"})
        if "error" not in detail:
            headers = {h["name"]: h["value"]
                       for h in detail.get("payload", {}).get("headers", [])}
            results.append({
                "id":      msg["id"],
                "subject": headers.get("Subject", "(no subject)"),
                "from":    headers.get("From", ""),
                "date":    headers.get("Date", ""),
                "snippet": detail.get("snippet", ""),
            })
    return {"success": True, "count": len(results), "messages": results}


def gmail_read(message_id: str) -> Dict[str, Any]:
    """Read a full Gmail message by ID."""
    res = _api_call("GET", f"{GMAIL_BASE}/messages/{message_id}",
                    params={"format": "full"})
    if "error" in res:
        return {"success": False, "error": res["error"]}

    headers = {h["name"]: h["value"]
               for h in res.get("payload", {}).get("headers", [])}

    # Extract plain text body
    body = _extract_body(res.get("payload", {}))

    return {
        "success":  True,
        "id":       message_id,
        "subject":  headers.get("Subject", ""),
        "from":     headers.get("From", ""),
        "to":       headers.get("To", ""),
        "date":     headers.get("Date", ""),
        "snippet":  res.get("snippet", ""),
        "body":     body[:4000],  # cap for voice/LLM
    }


def gmail_create_draft(to: str, subject: str, body: str,
                       cc: str = "") -> Dict[str, Any]:
    """Create a Gmail draft (does NOT send — always draft first)."""
    import base64
    lines = [
        f"To: {to}",
        f"Subject: {subject}",
    ]
    if cc:
        lines.append(f"Cc: {cc}")
    lines += ["Content-Type: text/plain; charset=utf-8", "", body]
    raw = base64.urlsafe_b64encode("\r\n".join(lines).encode()).decode()
    res = _api_call("POST", f"{GMAIL_BASE}/drafts",
                    body={"message": {"raw": raw}})
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {"success": True, "draft_id": res.get("id"), "message": "Draft created."}


def gmail_send_draft(draft_id: str) -> Dict[str, Any]:
    """Send an existing draft by ID."""
    res = _api_call("POST", f"{GMAIL_BASE}/drafts/send",
                    body={"id": draft_id})
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {"success": True, "message_id": res.get("id"), "message": "Email sent."}


def gmail_list_labels() -> Dict[str, Any]:
    """List all Gmail labels (INBOX, SENT, custom, etc.)."""
    res = _api_call("GET", f"{GMAIL_BASE}/labels")
    if "error" in res:
        return {"success": False, "error": res["error"]}
    labels = [{"id": l["id"], "name": l["name"]}
              for l in res.get("labels", [])]
    return {"success": True, "labels": labels}


# ─── Calendar Tools ────────────────────────────────────────────────────────────

def calendar_list_events(calendar_id: str = "primary",
                         max_results: int = 10,
                         time_min: Optional[str] = None,
                         time_max: Optional[str] = None,
                         query: Optional[str] = None) -> Dict[str, Any]:
    """List upcoming calendar events."""
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    params: Dict[str, Any] = {
        "maxResults":  min(max_results, 50),
        "orderBy":     "startTime",
        "singleEvents": "true",
        "timeMin":     time_min or now_iso,
    }
    if time_max:
        params["timeMax"] = time_max
    if query:
        params["q"] = query

    res = _api_call("GET", f"{CALENDAR_BASE}/calendars/{urllib.parse.quote(calendar_id)}/events",
                    params=params)
    if "error" in res:
        return {"success": False, "error": res["error"]}

    events = []
    for e in res.get("items", []):
        start = e.get("start", {})
        end   = e.get("end", {})
        events.append({
            "id":       e.get("id"),
            "summary":  e.get("summary", "(no title)"),
            "start":    start.get("dateTime", start.get("date", "")),
            "end":      end.get("dateTime",   end.get("date", "")),
            "location": e.get("location", ""),
            "status":   e.get("status", ""),
            "link":     e.get("htmlLink", ""),
        })
    return {"success": True, "count": len(events), "events": events}


def calendar_get_event(event_id: str,
                       calendar_id: str = "primary") -> Dict[str, Any]:
    """Get a specific calendar event by ID."""
    res = _api_call("GET",
                    f"{CALENDAR_BASE}/calendars/{urllib.parse.quote(calendar_id)}/events/{event_id}")
    if "error" in res:
        return {"success": False, "error": res["error"]}
    start = res.get("start", {})
    end   = res.get("end", {})
    return {
        "success":     True,
        "id":          res.get("id"),
        "summary":     res.get("summary", ""),
        "description": res.get("description", ""),
        "start":       start.get("dateTime", start.get("date", "")),
        "end":         end.get("dateTime",   end.get("date", "")),
        "location":    res.get("location", ""),
        "attendees":   [a.get("email") for a in res.get("attendees", [])],
        "link":        res.get("htmlLink", ""),
    }


def calendar_create_event(summary: str, start_datetime: str,
                          end_datetime: str,
                          description: str = "",
                          location: str = "",
                          attendees: Optional[List[str]] = None,
                          calendar_id: str = "primary") -> Dict[str, Any]:
    """Create a new calendar event. Datetimes in ISO 8601 format."""
    body: Dict[str, Any] = {
        "summary":     summary,
        "description": description,
        "location":    location,
        "start":       {"dateTime": start_datetime, "timeZone": "Asia/Kolkata"},
        "end":         {"dateTime": end_datetime,   "timeZone": "Asia/Kolkata"},
    }
    if attendees:
        body["attendees"] = [{"email": e} for e in attendees]

    res = _api_call("POST",
                    f"{CALENDAR_BASE}/calendars/{urllib.parse.quote(calendar_id)}/events",
                    body=body)
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {
        "success": True,
        "id":      res.get("id"),
        "link":    res.get("htmlLink", ""),
        "message": f"Event '{summary}' created.",
    }


def calendar_list_calendars() -> Dict[str, Any]:
    """List all calendars in the account."""
    res = _api_call("GET", f"{CALENDAR_BASE}/users/me/calendarList")
    if "error" in res:
        return {"success": False, "error": res["error"]}
    cals = [{"id": c["id"], "summary": c.get("summary", ""),
             "primary": c.get("primary", False)}
            for c in res.get("items", [])]
    return {"success": True, "calendars": cals}


# ─── Tasks Tools ─────────────────────────────────────────────────────────────

def tasks_list_lists() -> Dict[str, Any]:
    """List all task lists."""
    res = _api_call("GET", f"{TASKS_BASE}/users/@me/lists")
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {"success": True, "lists": res.get("items", [])}


def tasks_list_tasks(list_id: str = "@default") -> Dict[str, Any]:
    """List tasks in a list."""
    res = _api_call("GET", f"{TASKS_BASE}/lists/{urllib.parse.quote(list_id)}/tasks")
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {"success": True, "tasks": res.get("items", [])}


def tasks_create_task(title: str, list_id: str = "@default") -> Dict[str, Any]:
    """Create a new task."""
    res = _api_call("POST", f"{TASKS_BASE}/lists/{urllib.parse.quote(list_id)}/tasks",
                    body={"title": title})
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {"success": True, "task": res}


def tasks_complete_task(task_id: str, list_id: str = "@default") -> Dict[str, Any]:
    """Mark a task as completed."""
    res = _api_call("PATCH", f"{TASKS_BASE}/lists/{urllib.parse.quote(list_id)}/tasks/{task_id}",
                    body={"status": "completed"})
    if "error" in res:
        return {"success": False, "error": res["error"]}
    return {"success": True, "task": res}


# ─── Internal helpers ──────────────────────────────────────────────────────────

def _extract_body(payload: Dict) -> str:
    import base64
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    for part in payload.get("parts", []):
        result = _extract_body(part)
        if result:
            return result
    return payload.get("snippet", "")


# ─── Async dispatcher entry point ─────────────────────────────────────────────

async def dispatch(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Called by actuator_dispatcher for all google_* tools."""
    loop = asyncio.get_event_loop()
    try:
        # Gmail
        if tool == "gmail_search":
            return await loop.run_in_executor(None, lambda: gmail_search(
                args.get("query", ""),
                int(args.get("max_results", 10))
            ))
        elif tool == "gmail_read":
            return await loop.run_in_executor(None, lambda: gmail_read(
                args["message_id"]
            ))
        elif tool == "gmail_create_draft":
            return await loop.run_in_executor(None, lambda: gmail_create_draft(
                args["to"], args["subject"], args["body"],
                args.get("cc", "")
            ))
        elif tool == "gmail_send_draft":
            return await loop.run_in_executor(None, lambda: gmail_send_draft(
                args["draft_id"]
            ))
        elif tool == "gmail_list_labels":
            return await loop.run_in_executor(None, gmail_list_labels)
        # Calendar
        elif tool == "calendar_list_events":
            return await loop.run_in_executor(None, lambda: calendar_list_events(
                args.get("calendar_id", "primary"),
                int(args.get("max_results", 10)),
                args.get("time_min"),
                args.get("time_max"),
                args.get("query"),
            ))
        elif tool == "calendar_get_event":
            return await loop.run_in_executor(None, lambda: calendar_get_event(
                args["event_id"],
                args.get("calendar_id", "primary")
            ))
        elif tool == "calendar_create_event":
            return await loop.run_in_executor(None, lambda: calendar_create_event(
                args["summary"], args["start_datetime"], args["end_datetime"],
                args.get("description", ""), args.get("location", ""),
                args.get("attendees"), args.get("calendar_id", "primary")
            ))
        elif tool == "calendar_list_calendars":
            return await loop.run_in_executor(None, calendar_list_calendars)
        # Tasks
        elif tool == "tasks_list_lists":
            return await loop.run_in_executor(None, tasks_list_lists)
        elif tool == "tasks_list_tasks":
            return await loop.run_in_executor(None, lambda: tasks_list_tasks(
                args.get("list_id", "@default")
            ))
        elif tool == "tasks_create_task":
            return await loop.run_in_executor(None, lambda: tasks_create_task(
                args["title"],
                args.get("list_id", "@default")
            ))
        elif tool == "tasks_complete_task":
            return await loop.run_in_executor(None, lambda: tasks_complete_task(
                args["task_id"],
                args.get("list_id", "@default")
            ))
        else:
            return {"success": False, "error": f"Unknown Google tool: {tool}"}
    except KeyError as e:
        return {"success": False, "error": f"Missing required argument: {e}"}
    except RuntimeError as e:
        return {"success": False, "error": str(e), "setup_required": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Auth check ───────────────────────────────────────────────────────────────

def is_authenticated() -> bool:
    return TOKEN_FILE.exists()
