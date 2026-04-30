# rwanga-mcp

MCP server for **Rwanga** (ڕوانگە) — Kurdish cinema preproduction platform.

Connects any Claude instance to a live Rwanga instance. Manage film projects, scenes, characters, locations, and scripts through natural conversation.

## Setup

### Quick (let Claude do it)

Open Claude Code or Claude Desktop and say:

> "Clone https://github.com/daryabsb/rwanga-mcp and set it up for me"

Claude will read `SETUP.md` and walk you through everything — install, build, get your token, configure. You'll need your Rwanga URL and account credentials.

### Manual

```bash
git clone https://github.com/daryabsb/rwanga-mcp.git
cd rwanga-mcp
npm install
npm run build
```

Get your API token from your Rwanga instance (see "Authentication" below), then add to Claude Desktop config:

```json
{
  "mcpServers": {
    "rwanga": {
      "command": "node",
      "args": ["/path/to/rwanga-mcp/dist/index.js"],
      "env": {
        "RWANGA_API_URL": "https://your-rwanga-instance.com/api/v1",
        "RWANGA_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. Done.

## Authentication

When Claude sets this up for you, it will ask for your Rwanga email and password, call the API to get a token, and configure everything automatically. You never need to handle the token yourself.

If you need a token manually:

```bash
curl -X POST https://your-instance.com/api/v1/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
```

The token is a 40-character string. Keep it private — it grants access to your projects.

## What you can do

Once connected, just talk to Claude naturally:

- "List my Rwanga projects"
- "Show me the scenes in Mysterious Guest"
- "Create a new scene: INT. KITCHEN - NIGHT, a tense family dinner"
- "Add characters: Dara (lead), Shilan (supporting), The Guest (lead)"
- "What's the project status?"

## Available Tools

| Tool | What it does |
|------|-------------|
| `list_projects` | List all projects |
| `get_project` | Full project details with scenes, characters, locations |
| `create_project` | Create a new film project |
| `update_project` | Update project fields |
| `list_scenes` | List scenes in a project |
| `create_scene` | Add a scene |
| `bulk_create_scenes` | Add multiple scenes at once |
| `update_scene` | Update a scene |
| `list_characters` | List characters |
| `create_character` | Add a character |
| `bulk_create_characters` | Add multiple characters at once |
| `list_locations` | List locations |
| `create_location` | Add a location |
| `list_scripts` | List scripts |
| `create_script` | Create a script entry |
| `list_tasks` | List progress/development tasks |
| `update_task` | Update a task status |
| `create_gap_blocker` | Report a blocker |

## For developers

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RWANGA_API_URL` | Yes | Rwanga API base URL (e.g., `https://rwanga.zeneon.co.uk/api/v1`) |
| `RWANGA_API_TOKEN` | Yes | Your personal API token |

### Architecture

```
Claude Desktop / Code / Cowork
  ↓ stdio
rwanga-mcp (this package)
  ↓ HTTPS + Token auth
Rwanga DRF API
  ↓
Django ORM → PostgreSQL
```

## License

MIT
