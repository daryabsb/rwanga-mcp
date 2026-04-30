# Setting up rwanga-mcp

> This file is for Claude (or any AI assistant) to follow when a user says
> "install and set up rwanga-mcp". Read this file completely before starting.

## Prerequisites

- Node.js 18+ installed
- Access to a Rwanga instance (the user should know their Rwanga URL)
- A user account on that Rwanga instance

## Step-by-step setup

### 1. Install and build

```bash
cd <path-to-this-repo>
npm install
npm run build
```

Verify `dist/index.js` exists after build.

### 2. Get the Rwanga URL

Ask the user:

> "What is your Rwanga URL? For example: https://rwanga.zeneon.co.uk"

Store this as `RWANGA_URL`. The API URL will be `{RWANGA_URL}/api/v1`.

### 3. Authenticate and get a token

Ask the user for their credentials — one at a time:

> "What is your Rwanga email address?"

Then:

> "What is your Rwanga password?"

**IMPORTANT:** Handle the password securely. Do not echo it, log it, or store it anywhere. Use it only for the token request, then discard it.

Once you have email and password, request a token:

```bash
curl -s -X POST {RWANGA_URL}/api/v1/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"email": "<email>", "password": "<password>"}'
```

Or with Python:

```python
import requests, json
resp = requests.post(
    f"{rwanga_url}/api/v1/auth/token/",
    json={"email": email, "password": password}
)
if resp.status_code == 200:
    token = resp.json()["token"]
    print(f"Authenticated successfully. Token obtained.")
else:
    print(f"Authentication failed: {resp.json().get('error', 'Unknown error')}")
```

Expected success response:
```json
{"token": "d036af9b2dfab9ea3550b82bb66bc0f2ba919bb0", "user_id": 28, "email": "user@example.com"}
```

If authentication fails:
- Check the email is correct
- Check the password is correct
- Ask the user to try again
- If they don't have an account, tell them to register at `{RWANGA_URL}/accounts/register/`

### 4. Configure Claude Desktop

Find the Claude Desktop config file:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
  - Typical path: `C:\Users\<username>\AppData\Roaming\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

**CRITICAL: Use Python to read and write this file.** Do NOT use PowerShell `Set-Content` or `Out-File` — they add BOM characters that break JSON parsing.

```python
import json, os

# Detect platform and config path
if os.name == 'nt':
    config_path = os.path.join(os.environ['APPDATA'], 'Claude', 'claude_desktop_config.json')
else:
    config_path = os.path.expanduser('~/Library/Application Support/Claude/claude_desktop_config.json')
    if not os.path.exists(config_path):
        config_path = os.path.expanduser('~/.config/Claude/claude_desktop_config.json')

# Read existing config (handle BOM)
try:
    with open(config_path, 'rb') as f:
        raw = f.read()
    if raw.startswith(b'\xef\xbb\xbf'):
        raw = raw[3:]
    config = json.loads(raw) if raw.strip() else {}
except (FileNotFoundError, json.JSONDecodeError):
    config = {}

# Add rwanga MCP server
if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['rwanga'] = {
    'command': 'node',
    'args': ['<ABSOLUTE_PATH_TO_DIST_INDEX_JS>'],  # Replace with actual path
    'env': {
        'RWANGA_API_URL': '<RWANGA_URL>/api/v1',    # Replace with actual URL
        'RWANGA_API_TOKEN': '<TOKEN>'                 # Replace with obtained token
    }
}

# Write clean UTF-8 without BOM
with open(config_path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print(f'Config written to {config_path}')
```

**Replace the placeholders:**
- `<ABSOLUTE_PATH_TO_DIST_INDEX_JS>` — absolute path to `dist/index.js` in this repo
  - Windows: use double backslashes (e.g., `C:\\Users\\darya\\rwanga-mcp\\dist\\index.js`)
  - macOS/Linux: normal path (e.g., `/home/user/rwanga-mcp/dist/index.js`)
- `<RWANGA_URL>` — the URL from step 2
- `<TOKEN>` — the token from step 3

### 5. Tell the user to restart

Say:

> "Setup complete! Please restart Claude Desktop (fully quit and reopen).
> After restart, open a new conversation and try saying 'List my Rwanga projects'
> to verify the connection works."

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Some MCP servers could not be loaded" | Invalid JSON structure in config | Check for double-nested `mcpServers` |
| "Could not load app settings" | BOM character in config file | Rewrite file using Python (see step 4) |
| Tools appear but all calls fail with 401 | Invalid or expired token | Re-run step 3 to get a fresh token |
| Tools appear but all calls fail with 502 | Rwanga server is down | Check the Django server is running |
| Tools appear but return empty data | Token user has no projects | Normal — create a project first |
| No tools appear, no error | `dist/index.js` missing | Run `npm run build` |
| Authentication returns 404 | Token endpoint not deployed | Admin needs to deploy the auth endpoint |

## Summary of the flow

```
User: "Set up rwanga-mcp for me"
  ↓
Claude: npm install && npm run build
  ↓
Claude: "What's your Rwanga URL?"
User: "https://rwanga.zeneon.co.uk"
  ↓
Claude: "What's your email?"
User: "director@film.com"
  ↓
Claude: "What's your password?"
User: "mypassword"
  ↓
Claude: POST /api/v1/auth/token/ → gets token
  ↓
Claude: writes claude_desktop_config.json (using Python, no BOM)
  ↓
Claude: "Restart Claude Desktop. You're all set!"
  ↓
User restarts → Rwanga tools available in every session
```
