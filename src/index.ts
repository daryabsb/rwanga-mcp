#!/usr/bin/env node
/**
 * rwanga-mcp — MCP server for Rwanga cinema preproduction platform
 *
 * Connects to a Rwanga instance via its REST API and exposes
 * project data as MCP resources and write operations as MCP tools.
 *
 * Usage (stdio transport — for Claude Desktop / Claude Code / Cowork):
 *   RWANGA_API_URL=https://rwanga.zeneon.co.uk/api/v1 \
 *   RWANGA_API_TOKEN=your-token \
 *   npx rwanga-mcp
 *
 * Environment:
 *   RWANGA_API_URL   — Base URL of the Rwanga DRF API (required)
 *   RWANGA_API_TOKEN — DRF Token for authentication (required)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_URL = (process.env.RWANGA_API_URL || "http://localhost:8020/api/v1").replace(/\/+$/, "");
const API_TOKEN = process.env.RWANGA_API_TOKEN || "";

if (!API_TOKEN) {
  console.error("ERROR: RWANGA_API_TOKEN is required. Generate one with:");
  console.error("  python manage.py drf_create_token <email>");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
interface ApiOptions {
  method?: string;
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string>;
}

async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, params } = opts;

  let url = `${API_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Token ${API_TOKEN}`,
    Accept: "application/json",
  };

  const init: RequestInit = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }

  // Handle 204 No Content
  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "rwanga",
  version: "0.1.0",
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════════════

// --- Project list ---
server.resource(
  "projects",
  "rwanga://projects",
  async (uri) => {
    const data = await api("/projects/projects/");
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// --- Single project (with nested scenes, characters, locations) ---
server.resource(
  "project",
  "rwanga://projects/{id}",
  async (uri, params) => {
    const id = String(params.id);
    const [project, scenes, characters, locations] = await Promise.all([
      api(`/projects/projects/${id}/`),
      api(`/projects/projects/${id}/scenes/`).catch(() => []),
      api(`/projects/projects/${id}/characters/`).catch(() => []),
      api(`/projects/projects/${id}/locations/`).catch(() => []),
    ]);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ project, scenes, characters, locations }, null, 2),
        },
      ],
    };
  }
);

// --- Progress dashboard ---
server.resource(
  "progress",
  "rwanga://progress",
  async (uri) => {
    const data = await api("/progress/tasks/").catch(() => ({ error: "Progress endpoint not available" }));
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Project Management
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_projects",
  "List all projects in the Rwanga instance",
  {},
  async () => {
    const data = await api("/projects/projects/");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_project",
  "Get detailed project info including scenes, characters, and locations",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const [project, scenes, characters, locations] = await Promise.all([
      api(`/projects/projects/${project_id}/`),
      api(`/projects/projects/${project_id}/scenes/`).catch(() => []),
      api(`/projects/projects/${project_id}/characters/`).catch(() => []),
      api(`/projects/projects/${project_id}/locations/`).catch(() => []),
    ]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ project, scenes, characters, locations }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "create_project",
  "Create a new film project",
  {
    title: z.string().describe("Project title (Kurdish)"),
    title_latin: z.string().optional().describe("Latin/English title"),
    project_type: z.enum(["feature", "short", "episode", "music_video", "commercial"]).default("feature"),
    logline: z.string().optional().describe("Brief story summary"),
    director_name: z.string().optional().describe("Director's name"),
  },
  async ({ title, title_latin, project_type, logline, director_name }) => {
    const data = await api("/projects/projects/", {
      method: "POST",
      body: {
        title,
        title_latin: title_latin || "",
        project_type,
        logline: logline || "",
        director_name: director_name || "",
      },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_project",
  "Update an existing project",
  {
    project_id: z.string().describe("UUID of the project"),
    title: z.string().optional(),
    title_latin: z.string().optional(),
    project_type: z.string().optional(),
    logline: z.string().optional(),
    status: z.string().optional(),
  },
  async ({ project_id, ...fields }) => {
    // Filter out undefined values
    const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const data = await api(`/projects/projects/${project_id}/`, { method: "PATCH", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Scene Management
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_scenes",
  "List all scenes in a project",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const data = await api(`/projects/projects/${project_id}/scenes/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_scene",
  "Add a scene to a project",
  {
    project_id: z.string().describe("UUID of the project"),
    scene_number: z.number().describe("Scene number (unique within project)"),
    heading: z.string().describe("Full scene heading (e.g., 'INT. HOUSE - NIGHT')"),
    int_ext: z.enum(["INT", "EXT", "INT/EXT"]).optional().describe("Interior or Exterior"),
    location_name: z.string().optional().describe("Location name"),
    time_of_day: z.string().optional().describe("Time of day (DAY, NIGHT, etc.)"),
    description: z.string().optional().describe("Scene description/action summary"),
    page_count: z.number().optional().describe("Page count (e.g., 2.5)"),
  },
  async ({ project_id, ...fields }) => {
    const data = await api(`/projects/projects/${project_id}/scenes/`, {
      method: "POST",
      body: fields,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "bulk_create_scenes",
  "Create multiple scenes at once",
  {
    project_id: z.string().describe("UUID of the project"),
    scenes: z.array(z.object({
      scene_number: z.number(),
      heading: z.string(),
      int_ext: z.string().optional(),
      location_name: z.string().optional(),
      time_of_day: z.string().optional(),
      description: z.string().optional(),
      page_count: z.number().optional(),
    })).describe("Array of scene objects"),
  },
  async ({ project_id, scenes }) => {
    const results = [];
    const errors = [];
    for (const scene of scenes) {
      try {
        const data = await api(`/projects/projects/${project_id}/scenes/`, {
          method: "POST",
          body: scene,
        });
        results.push(data);
      } catch (e) {
        errors.push({ scene_number: scene.scene_number, error: String(e) });
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ created: results.length, errors, results }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "update_scene",
  "Update an existing scene",
  {
    project_id: z.string().describe("UUID of the project"),
    scene_id: z.string().describe("UUID of the scene"),
    heading: z.string().optional(),
    description: z.string().optional(),
    int_ext: z.string().optional(),
    location_name: z.string().optional(),
    time_of_day: z.string().optional(),
  },
  async ({ project_id, scene_id, ...fields }) => {
    const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const data = await api(`/projects/projects/${project_id}/scenes/${scene_id}/`, {
      method: "PATCH",
      body,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Character Management
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_characters",
  "List all characters in a project",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const data = await api(`/projects/projects/${project_id}/characters/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_character",
  "Add a character to a project",
  {
    project_id: z.string().describe("UUID of the project"),
    name: z.string().describe("Character name (Kurdish)"),
    name_latin: z.string().optional().describe("Character name (Latin)"),
    description: z.string().optional().describe("Character description"),
    character_type: z.enum(["lead", "supporting", "extra"]).default("supporting"),
  },
  async ({ project_id, ...fields }) => {
    const data = await api(`/projects/projects/${project_id}/characters/`, {
      method: "POST",
      body: fields,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "bulk_create_characters",
  "Create multiple characters at once",
  {
    project_id: z.string().describe("UUID of the project"),
    characters: z.array(z.object({
      name: z.string(),
      name_latin: z.string().optional(),
      description: z.string().optional(),
      character_type: z.enum(["lead", "supporting", "extra"]).default("supporting"),
    })).describe("Array of character objects"),
  },
  async ({ project_id, characters }) => {
    const results = [];
    const errors = [];
    for (const char of characters) {
      try {
        const data = await api(`/projects/projects/${project_id}/characters/`, {
          method: "POST",
          body: char,
        });
        results.push(data);
      } catch (e) {
        errors.push({ name: char.name, error: String(e) });
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ created: results.length, errors, results }, null, 2),
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Location Management
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_locations",
  "List all locations in a project",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const data = await api(`/projects/projects/${project_id}/locations/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_location",
  "Add a location to a project",
  {
    project_id: z.string().describe("UUID of the project"),
    name: z.string().describe("Location name (Kurdish)"),
    name_latin: z.string().optional().describe("Location name (Latin)"),
    int_ext: z.enum(["INT", "EXT", "INT/EXT"]).optional(),
    description: z.string().optional(),
    address: z.string().optional(),
  },
  async ({ project_id, ...fields }) => {
    const data = await api(`/projects/projects/${project_id}/locations/`, {
      method: "POST",
      body: fields,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Script Management
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_scripts",
  "List all scripts in a project",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const data = await api(`/scripts/`, { params: { project: project_id } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_script",
  "Create a script entry for a project",
  {
    project_id: z.string().describe("UUID of the project"),
    title: z.string().describe("Script title"),
    content: z.string().optional().describe("Script content (plain text or formatted)"),
    script_format: z.enum(["fountain", "fdx", "plain", "docx"]).default("plain"),
  },
  async ({ project_id, title, content, script_format }) => {
    const data = await api("/scripts/", {
      method: "POST",
      body: { project: project_id, title, content: content || "", script_format },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Progress / Task Management
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_tasks",
  "List progress tasks with optional filters",
  {
    status: z.string().optional().describe("Filter by status: pending, in_progress, completed, blocked"),
    phase: z.string().optional().describe("Filter by phase: P0, P1, P2, etc."),
    app_name: z.string().optional().describe("Filter by app: projects, scripts, shots, etc."),
  },
  async ({ status, phase, app_name }) => {
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (phase) params.phase = phase;
    if (app_name) params.app_name = app_name;
    const data = await api("/progress/tasks/", { params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_task",
  "Update a progress task status",
  {
    task_id: z.string().describe("UUID of the task"),
    status: z.string().describe("New status: pending, in_progress, completed, blocked"),
    note: z.string().optional().describe("Status change note"),
  },
  async ({ task_id, status, note }) => {
    const data = await api(`/progress/tasks/${task_id}/`, {
      method: "PATCH",
      body: { status, note: note || "" },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_gap_blocker",
  "Report a gap or blocker in the project",
  {
    title: z.string().describe("Gap title"),
    description: z.string().describe("What's blocked and why"),
    gap_type: z.string().default("spec_unclear"),
    severity: z.string().default("major"),
    related_app: z.string().optional(),
  },
  async ({ title, description, gap_type, severity, related_app }) => {
    const data = await api("/progress/gaps/", {
      method: "POST",
      body: { title, description, gap_type, severity, related_app: related_app || "" },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Reviews
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_reviews",
  "List bible reviews for a project",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const data = await api(`/reviews/bible/${project_id}/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_review",
  "Create a new bible review (snapshots the current canonical bible as starting point)",
  {
    project_id: z.string().describe("UUID of the project"),
    content: z.any().optional().describe("Optional review content (JSON or text)"),
  },
  async ({ project_id, content }) => {
    const body: Record<string, unknown> = {};
    if (content !== undefined) body.content = content;
    const data = await api(`/reviews/bible/${project_id}/`, { method: "POST", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_bible",
  "Get the canonical bible for a project (single source of truth)",
  {
    project_id: z.string().describe("UUID of the project"),
  },
  async ({ project_id }) => {
    const data = await api(`/projects/projects/${project_id}/bible/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "set_bible",
  "Set or update the canonical bible content for a project",
  {
    project_id: z.string().describe("UUID of the project"),
    content: z.string().describe("Bible content (JSON string or plain text)"),
  },
  async ({ project_id, content }) => {
    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      parsedContent = { text: content };
    }
    const data = await api(`/projects/projects/${project_id}/bible/`, {
      method: "PUT",
      body: { content: parsedContent as Record<string, unknown> },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "finalize_bible",
  "Mark a project's bible as final - no more reviews allowed",
  {
    project_id: z.string().describe("UUID of the project"),
  },
  async ({ project_id }) => {
    const data = await api(`/projects/projects/${project_id}/bible/finalize/`, {
      method: "POST",
      body: {},
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "deliver_review",
  "Deliver a review - applies review content as the new canonical bible",
  {
    project_id: z.string().describe("UUID of the project"),
    review_id: z.string().describe("UUID of the review to deliver"),
  },
  async ({ project_id, review_id }) => {
    const data = await api(`/reviews/bible/${project_id}/${review_id}/`, {
      method: "PATCH",
      body: { status: "delivered" },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_review",
  "Get full review details with decisions and scene evaluations",
  {
    project_id: z.string().describe("UUID of the project"),
    review_id: z.string().describe("UUID of the review"),
  },
  async ({ project_id, review_id }) => {
    const data = await api(`/reviews/bible/${project_id}/${review_id}/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_review",
  "Update a review status/content",
  {
    project_id: z.string().describe("UUID of the project"),
    review_id: z.string().describe("UUID of the review"),
    status: z.string().optional(),
    content: z.any().optional(),
  },
  async ({ project_id, review_id, status, content }) => {
    const body = Object.fromEntries(
      Object.entries({ status, content }).filter(([, v]) => v !== undefined)
    );
    const data = await api(`/reviews/bible/${project_id}/${review_id}/`, { method: "PATCH", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "list_decisions",
  "List review decisions for a review",
  { review_id: z.string().describe("UUID of the review") },
  async ({ review_id }) => {
    const data = await api(`/reviews/decisions/${review_id}/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_decision",
  "Create a proposed decision for a review",
  {
    review_id: z.string().describe("UUID of the review"),
    topic: z.string().describe("Decision topic"),
    decision_text: z.string().describe("Decision details"),
    scene_id: z.string().optional().describe("Optional scene UUID"),
    expression_type: z.enum(["emotional", "behavioral", "artistic", "memory", "broken"]).optional(),
    intensity: z.enum(["low", "medium", "peak", "collapse"]).optional(),
    function_label: z.string().optional(),
    transition_label: z.string().optional(),
    chain_id: z.string().optional(),
    chain_name: z.string().optional(),
    chain_order: z.number().optional(),
  },
  async ({ review_id, topic, decision_text, scene_id, expression_type, intensity, function_label, transition_label, chain_id, chain_name, chain_order }) => {
    const body: Record<string, unknown> = { topic, decision_text };
    if (scene_id) body.scene = scene_id;
    if (expression_type) body.expression_type = expression_type;
    if (intensity) body.intensity = intensity;
    if (function_label !== undefined) body.function_label = function_label;
    if (transition_label !== undefined) body.transition_label = transition_label;
    if (chain_id !== undefined) body.chain_id = chain_id;
    if (chain_name !== undefined) body.chain_name = chain_name;
    if (chain_order !== undefined) body.chain_order = chain_order;
    const data = await api(`/reviews/decisions/${review_id}/`, { method: "POST", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "list_chains",
  "List decision chains for a review",
  { review_id: z.string().describe("UUID of the review") },
  async ({ review_id }) => {
    const decisions = await api<any[]>(`/reviews/decisions/${review_id}/`);
    const grouped = new Map<string, { chain_id: string; chain_name: string; decision_count: number; scenes: number[] }>();
    for (const d of decisions) {
      const cid = String(d.chain_id || "").trim();
      if (!cid) continue;
      if (!grouped.has(cid)) {
        grouped.set(cid, {
          chain_id: cid,
          chain_name: String(d.chain_name || ""),
          decision_count: 0,
          scenes: [],
        });
      }
      const item = grouped.get(cid)!;
      item.decision_count += 1;
      const sceneNum = d.scene && typeof d.scene === "object" ? (d.scene.number ?? d.scene.scene_number) : null;
      if (typeof sceneNum === "number" && !item.scenes.includes(sceneNum)) {
        item.scenes.push(sceneNum);
      }
    }
    const data = Array.from(grouped.values()).sort((a, b) => a.chain_id.localeCompare(b.chain_id));
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "lock_decision",
  "Lock a decision (status=locked) with optional comment",
  {
    review_id: z.string().describe("UUID of the review"),
    decision_id: z.string().describe("UUID of the decision"),
    comment: z.string().optional().describe("Optional acceptance comment"),
  },
  async ({ review_id, decision_id, comment }) => {
    const body: Record<string, unknown> = { status: "locked" };
    if (comment) body.comment = comment;
    const data = await api(`/reviews/decisions/${review_id}/${decision_id}/`, {
      method: "PATCH",
      body,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "reject_decision",
  "Reject a decision (status=rejected) with reason",
  {
    review_id: z.string().describe("UUID of the review"),
    decision_id: z.string().describe("UUID of the decision"),
    reason: z.string().optional().describe("Reason for rejection"),
  },
  async ({ review_id, decision_id, reason }) => {
    const body: Record<string, unknown> = { status: "rejected" };
    if (reason) body.reason = reason;
    const data = await api(`/reviews/decisions/${review_id}/${decision_id}/`, {
      method: "PATCH",
      body,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_scene_evaluation",
  "Create a scene evaluation for a review",
  {
    review_id: z.string().describe("UUID of the review"),
    scene_id: z.string().describe("UUID of the scene"),
    analysis: z.string().describe("Analysis text"),
    tension_score: z.number().min(0).max(10).describe("Tension score from 0-10"),
    notes: z.string().optional(),
    recommendations: z.string().optional(),
  },
  async ({ review_id, scene_id, analysis, tension_score, notes, recommendations }) => {
    const body: Record<string, unknown> = { scene: scene_id, analysis, tension_score };
    if (notes !== undefined) body.notes = notes;
    if (recommendations !== undefined) body.recommendations = recommendations;
    const data = await api(`/reviews/evaluations/${review_id}/`, { method: "POST", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — Community
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "list_sessions",
  "List community sessions for a project",
  { project_id: z.string().describe("UUID of the project") },
  async ({ project_id }) => {
    const data = await api(`/community/sessions/${project_id}/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_session",
  "Create a community review session",
  {
    project_id: z.string().describe("UUID of the project"),
    title: z.string().describe("Session title"),
    session_type: z.enum(["screenplay", "bible", "scene_selection"]).default("screenplay"),
    visibility: z.enum(["invite_only", "public"]).default("invite_only"),
  },
  async ({ project_id, title, session_type, visibility }) => {
    const data = await api(`/community/sessions/${project_id}/`, {
      method: "POST",
      body: { title, session_type, visibility },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_session",
  "Get session details with content, participants, and comments",
  {
    project_id: z.string().describe("UUID of the project"),
    session_id: z.string().describe("UUID of the session"),
  },
  async ({ project_id, session_id }) => {
    const data = await api(`/community/sessions/${project_id}/${session_id}/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_session",
  "Update a community session status",
  {
    project_id: z.string().describe("UUID of the project"),
    session_id: z.string().describe("UUID of the session"),
    status: z.enum(["draft", "open", "closed"]).describe("New session status"),
  },
  async ({ project_id, session_id, status }) => {
    const data = await api(`/community/sessions/${project_id}/${session_id}/`, {
      method: "PATCH",
      body: { status },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "open_session",
  "Open a community session",
  {
    project_id: z.string().describe("UUID of the project"),
    session_id: z.string().describe("UUID of the session"),
  },
  async ({ project_id, session_id }) => {
    const data = await api(`/community/sessions/${project_id}/${session_id}/`, {
      method: "PATCH",
      body: { status: "open" },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "close_session",
  "Close a community session",
  {
    project_id: z.string().describe("UUID of the project"),
    session_id: z.string().describe("UUID of the session"),
  },
  async ({ project_id, session_id }) => {
    const data = await api(`/community/sessions/${project_id}/${session_id}/`, {
      method: "PATCH",
      body: { status: "closed" },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "invite_participant",
  "Invite a user to a community session",
  {
    session_id: z.string().describe("UUID of the session"),
    user_id: z.string().optional().describe("User UUID"),
    email: z.string().optional().describe("User email"),
  },
  async ({ session_id, user_id, email }) => {
    const body: Record<string, unknown> = {};
    if (user_id) body.user_id = user_id;
    if (email) body.email = email;
    const data = await api(`/community/sessions/${session_id}/invite/`, { method: "POST", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "add_session_content",
  "Add frozen content to a community session",
  {
    session_id: z.string().describe("UUID of the session"),
    content_type: z.enum(["scene", "bible"]).describe("Content type"),
    content_data: z.record(z.string(), z.any()).describe("Frozen content JSON"),
    label: z.string().describe("Content label"),
    order: z.number().optional().default(0),
    version: z.number().optional().default(1),
  },
  async ({ session_id, content_type, content_data, label, order, version }) => {
    const data = await api(`/community/sessions/${session_id}/content/`, {
      method: "POST",
      body: { content_type, content_data, label, order, version },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "list_comments",
  "List comments for a community session",
  { session_id: z.string().describe("UUID of the session") },
  async ({ session_id }) => {
    const data = await api(`/community/sessions/${session_id}/comments/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_comment",
  "Create a comment in a community session",
  {
    session_id: z.string().describe("UUID of the session"),
    session_content_id: z.string().describe("UUID of the session content"),
    body: z.string().describe("Comment text"),
    anchor_type: z.enum(["line", "paragraph", "scene", "general"]).default("general"),
    anchor_ref: z.string().optional(),
    parent_id: z.string().optional(),
  },
  async ({ session_id, session_content_id, body, anchor_type, anchor_ref, parent_id }) => {
    const payload: Record<string, unknown> = {
      session_content: session_content_id,
      body,
      anchor_type,
      anchor_ref: anchor_ref || "",
    };
    if (parent_id) payload.parent = parent_id;
    const data = await api(`/community/sessions/${session_id}/comments/`, {
      method: "POST",
      body: payload,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "react_to_comment",
  "React to a community comment",
  {
    session_id: z.string().describe("UUID of the session"),
    comment_id: z.string().describe("UUID of the comment"),
    reaction_type: z.enum(["agree", "disagree", "question"]).describe("Reaction type"),
  },
  async ({ session_id, comment_id, reaction_type }) => {
    const data = await api(`/community/sessions/${session_id}/comments/${comment_id}/react/`, {
      method: "POST",
      body: { reaction_type },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS — Reusable workflow templates
// ═══════════════════════════════════════════════════════════════════════════

server.prompt(
  "seed_project",
  "Seed a project with scenes, characters, and locations from a screenplay",
  {
    project_id: z.string().describe("UUID of the project to seed"),
  },
  async ({ project_id }) => {
    const project = await api(`/projects/projects/${project_id}/`);
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are seeding the Rwanga project "${(project as any).title}" (ID: ${project_id}).

Use the available MCP tools to:
1. Read the screenplay/story bible source materials
2. Create scenes with proper headings (INT/EXT, location, time of day)
3. Create characters (leads, supporting, extras) from the cast
4. Create locations referenced in the screenplay
5. Create a script entry if screenplay text is available

Work methodically — create scenes in order, then characters, then locations.
Report what you created when done.`,
          },
        },
      ],
    };
  }
);

server.prompt(
  "project_status",
  "Get a comprehensive status report for a project",
  {
    project_id: z.string().describe("UUID of the project"),
  },
  async ({ project_id }) => {
    const [project, scenes, characters, locations] = await Promise.all([
      api(`/projects/projects/${project_id}/`),
      api(`/projects/projects/${project_id}/scenes/`).catch(() => []),
      api(`/projects/projects/${project_id}/characters/`).catch(() => []),
      api(`/projects/projects/${project_id}/locations/`).catch(() => []),
    ]);
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Give me a status report for this Rwanga project:

${JSON.stringify({ project, scenes_count: (scenes as any[]).length, characters_count: (characters as any[]).length, locations_count: (locations as any[]).length }, null, 2)}

Include: what's populated, what's missing, what should be done next.`,
          },
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rwanga MCP server running (stdio)");
  console.error(`API: ${API_URL}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
