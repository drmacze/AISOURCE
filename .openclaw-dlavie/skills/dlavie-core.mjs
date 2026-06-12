
/**
 * DLavie OS Core Skills — available to all agents
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
    name: "dlavie_system_status",
    description: "Check DLavie OS system: CPU, RAM, disk, AI provider status, Ollama health.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [health, resources, providers] = await Promise.all([
        api("/api/health"),
        api("/api/resources"),
        api("/api/providers"),
      ]);
      return { health, resources, providers };
    },
  },
  {
    name: "dlavie_dashboard",
    description: "Get DLavie OS dashboard statistics: conversations, messages, documents, training.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/dashboard/stats"); },
  },
  {
    name: "dlavie_chat",
    description: "Send a message to the DLavie OS AI (Groq → OpenRouter → Ollama fallback chain).",
    inputSchema: {
      type: "object",
      properties: {
        message:      { type: "string", description: "Message to the AI" },
        systemPrompt: { type: "string", description: "Optional system prompt" },
      },
      required: ["message"],
    },
    async execute({ message, systemPrompt }) {
      const convRes = await api("/api/conversations", "POST", { title: "Agent task" });
      const convId = convRes?.id;
      if (!convId) return { error: "Could not create conversation" };
      return api(`/api/conversations/${convId}/messages`, "POST", {
        role: "user", content: message,
        ...(systemPrompt ? { systemPrompt } : {}),
      });
    },
  },
  {
    name: "dlavie_send_mail",
    description: "Send a mail to another DLavie OS agent or to the boss (human operator).",
    inputSchema: {
      type: "object",
      properties: {
        to:       { type: "string", description: "Recipient agent id (trainer/librarian/guardian/analyst/botmaster/curator/engineer/boss)" },
        subject:  { type: "string", description: "Mail subject" },
        body:     { type: "string", description: "Mail body" },
        priority: { type: "string", enum: ["low", "normal", "high", "critical"], description: "Priority level" },
      },
      required: ["to", "subject", "body"],
    },
    async execute({ to, subject, body, priority = "normal" }) {
      return api("/api/workers/mail/send", "POST", { to, subject, body, priority });
    },
  },
  {
    name: "dlavie_get_logs",
    description: "Get recent DLavie OS system logs and agent activity.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [workerStatus, openclawLogs] = await Promise.all([
        api("/api/workers/status"),
        api("/api/openclaw/logs"),
      ]);
      return { workerStatus, openclawLogs };
    },
  },
];
