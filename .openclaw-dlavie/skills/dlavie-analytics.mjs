
/**
 * DLavie OS Analytics & Admin Skills — for analyst and engineer agents
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: `${res.status}: ${await res.text()}` };
}

export const tools = [
  {
    name: "analytics_overview",
    description: "Get comprehensive DLavie OS analytics: conversations, messages, training, documents.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/all"); },
  },
  {
    name: "analytics_system_metrics",
    description: "Get system resource metrics: CPU, RAM, disk over time.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/system-metrics"); },
  },
  {
    name: "analytics_models_usage",
    description: "Get AI model usage breakdown.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/models-usage"); },
  },
  {
    name: "analytics_training_jobs",
    description: "Get training job analytics and completion rates.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/analytics/training-jobs"); },
  },
  {
    name: "worker_statuses",
    description: "Get status of all 8 DLavie OS agent workers.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/workers/status"); },
  },
  {
    name: "worker_metrics",
    description: "Get metrics recorded by agent workers.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Filter by agent ID (optional)" },
        limit:   { type: "number" },
      },
      required: [],
    },
    async execute({ agentId, limit = 100 }) {
      const qs = agentId ? `?agent=${agentId}&limit=${limit}` : `?limit=${limit}`;
      return api(`/api/workers/metrics${qs}`);
    },
  },
  {
    name: "nudge_worker",
    description: "Manually trigger a worker agent to run its tick immediately.",
    inputSchema: {
      type: "object",
      properties: {
        workerId: { type: "string", description: "Worker ID (orchestrator/trainer/librarian/guardian/analyst/botmaster/curator/engineer)" },
      },
      required: ["workerId"],
    },
    async execute({ workerId }) {
      return api(`/api/workers/${workerId}/nudge`, "POST");
    },
  },
  {
    name: "read_boss_inbox",
    description: "Read mail sent to the human operator (boss inbox).",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/workers/mail"); },
  },
  {
    name: "generate_brand_asset",
    description: "Generate a brand image asset with DLavie OS branding.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image description/prompt" },
        style:  { type: "string", description: "Style: logo/banner/avatar/illustration" },
      },
      required: ["prompt"],
    },
    async execute({ prompt, style = "logo" }) {
      return api("/api/brand-kit/generate", "POST", { prompt, style });
    },
  },
  {
    name: "web_search",
    description: "Search the web for information.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
      },
      required: ["query"],
    },
    async execute({ query, limit = 5 }) {
      return api(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    },
  },
];
