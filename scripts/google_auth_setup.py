#!/usr/bin/env python3
"""
OAuth2 Setup for Friday-OS Google MCP.
Handles scope relaxation and token exchange automatically.
"""

import os
import sys

# Critical: allow oauthlib to accept Google's expanded granted scopes
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

import json
import webbrowser
import requests
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from google_auth_oauthlib.flow import Flow

CLIENT_SECRET_PATH = Path.home() / ".config" / "gws" / "client_secret.json"
TOKEN_OUTPUT_PATHS = [
    Path.home() / ".config" / "google-mcp" / "tokens.json",
    Path.home() / ".config" / "friday-os" / "google_tokens.json"
]

REDIRECT_URI = "http://localhost:8080/callback"
PORT = 8080

SCOPES = [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/tasks"
]

received_code = None

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global received_code
        parsed_url = urlparse(self.path)
        
        if parsed_url.path == "/callback":
            params = parse_qs(parsed_url.query)
            if "code" in params:
                received_code = params["code"][0]
                self.send_response(200)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                html = """
                <html>
                <body style="font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                    <div style="background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 480px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                        <h1 style="color: #38bdf8; margin-bottom: 12px;">✅ Friday-OS Connected!</h1>
                        <p style="color: #94a3b8; font-size: 16px; line-height: 1.5;">Google Workspace authorization was successful.<br>You can safely close this browser tab.</p>
                    </div>
                </body>
                </html>
                """
                self.wfile.write(html.encode("utf-8"))
            elif "error" in params:
                err = params["error"][0]
                self.send_response(400)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"<h1>Authorization Failed: {err}</h1>".encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

def main():
    if not CLIENT_SECRET_PATH.exists():
        print(f"Error: client_secret.json not found at {CLIENT_SECRET_PATH}")
        sys.exit(1)

    for p in TOKEN_OUTPUT_PATHS:
        p.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Friday-OS Google Account Setup")
    print("=" * 60)
    print(f"Redirect URI: {REDIRECT_URI}")
    print("Requested Scopes:")
    for s in SCOPES:
        print(f"  ✓ {s}")

    flow = Flow.from_client_secrets_file(
        str(CLIENT_SECRET_PATH),
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )

    auth_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true"
    )

    print("\nStarting local callback listener on port 8080...")
    httpd = HTTPServer(("localhost", PORT), OAuthCallbackHandler)
    
    print("\nOpening browser for Google sign-in...")
    print(f"\n{auth_url}\n")
    webbrowser.open(auth_url, new=1, autoraise=True)

    print("Waiting for callback from Google...")
    while received_code is None:
        httpd.handle_request()

    httpd.server_close()
    print("Callback received! Exchanging authorization code for tokens...")

    token_data = {}
    try:
        flow.fetch_token(code=received_code)
        creds = flow.credentials
        token_data = json.loads(creds.to_json())
    except Exception as e:
        print(f"Flow fetch_token note: {e}, using direct token exchange fallback...")
        with open(CLIENT_SECRET_PATH) as f:
            cs = json.load(f).get("installed", {})
        resp = requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": cs["client_id"],
            "client_secret": cs["client_secret"],
            "code": received_code,
            "code_verifier": flow.code_verifier,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI
        })
        token_data = resp.json()

    if "refresh_token" in token_data or "access_token" in token_data:
        token_json_str = json.dumps(token_data, indent=2)
        for p in TOKEN_OUTPUT_PATHS:
            p.write_text(token_json_str, encoding="utf-8")
            print(f"  ✓ Saved to: {p}")

        print("\n" + "=" * 60)
        print("✅ FRIDAY-OS GOOGLE MCP IS FULLY CONFIGURED!")
        print("=" * 60)
        print("Authorized capabilities:")
        print("  📧 Gmail     - Search, Read, Draft, Send")
        print("  📅 Calendar  - List events, Create events, Details")
        print("  ✅ Tasks     - List tasks, Create task, Complete task")
        print("=" * 60)
    else:
        print(f"❌ Failed to obtain tokens: {token_data}")

if __name__ == "__main__":
    main()
