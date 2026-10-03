#!/usr/bin/env python3
"""Test ScrapeCreators GitHub device auth flow from the CLI.

Usage:
    python3 scripts/test_device_auth.py

Flow:
    1. Starts device code request
    2. Shows user code + opens GitHub auth URL in browser
    3. Polls for token until you complete auth
    4. Fetches your profile and saves the API key privately
"""

import json
import sys
import time
import webbrowser
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = "https://api.scrapecreators.com/v1/github/device"


def _post(url, data=None):
    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    with urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _get(url, token):
    req = Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    with urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def main():
    # Step 1: Start device flow
    print("Starting ScrapeCreators GitHub device auth...\n")
    try:
        code_resp = _post(f"{BASE}/code")
    except (HTTPError, URLError) as e:
        print(f"Failed to start device flow: {e}")
        sys.exit(1)

    device_code = code_resp.get("device_code")
    user_code = code_resp.get("user_code")
    verification_uri = code_resp.get("verification_uri")
    interval = code_resp.get("interval", 5)
    expires_in = code_resp.get("expires_in", 900)

    if not device_code or not user_code:
        print("Device service returned an incomplete authorization response.")
        sys.exit(1)

    print(f"Your code:  {user_code}")
    print(f"Open:       {verification_uri}")
    print(f"Expires in: {expires_in}s\n")

    # Open browser
    if verification_uri:
        webbrowser.open(verification_uri)
        print("Opened browser. Enter the code above, then authorize.\n")

    # Step 2: Poll for token
    print("Waiting for authorization", end="", flush=True)
    deadline = time.time() + expires_in
    access_token = None

    while time.time() < deadline:
        time.sleep(interval)
        print(".", end="", flush=True)
        try:
            token_resp = _post(f"{BASE}/token", {"device_code": device_code})
        except HTTPError as e:
            # Some APIs return 4xx while pending
            if e.code in (400, 403, 428):
                continue
            print(f"\nPoll error: {e}")
            sys.exit(1)
        except URLError:
            continue

        if token_resp.get("access_token"):
            access_token = token_resp["access_token"]
            break

        # Check for explicit error states
        error = token_resp.get("error")
        if error == "authorization_pending" or error == "slow_down":
            if error == "slow_down":
                interval = min(interval + 2, 30)
            continue
        if error in ("expired_token", "access_denied"):
            print(f"\n\nAuth failed: {error}")
            sys.exit(1)

    if not access_token:
        print("\n\nTimed out waiting for authorization.")
        sys.exit(1)

    print("\n\nAuthorized. Fetching protected profile.\n")

    # Step 3: Fetch profile
    print("Fetching profile...")
    try:
        profile = _get(f"{BASE}/profile", access_token)
    except (HTTPError, URLError) as e:
        print("Failed to fetch protected profile; retry the authorization flow.")
        sys.exit(1)


    api_key = profile.get("api_key")
    if api_key:
        from lib import env, setup_wizard
        if setup_wizard.write_api_key(env.CONFIG_FILE, api_key):
            print("API key saved in the private last30days configuration; credentials are not printed.")
        else:
            print("Could not save the API key; use the last30days setup command.")
    else:
        print("Protected profile did not contain an API key.")



if __name__ == "__main__":
    main()
