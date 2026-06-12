
/**
 * DLavie OS Bot Management Skills — for botmaster and guardian agents
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
    name: "telegram_status",
    description: "Check Telegram bot connection status.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/tg-bot/status"); },
  },
  {
    name: "telegram_connect",
    description: "Connect/reconnect the Telegram bot.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/tg-bot/connect", "POST", {}); },
  },
  {
    name: "telegram_send_message",
    description: "Send a message to a Telegram user or group.",
    inputSchema: {
      type: "object",
      properties: {
        chatId:  { type: "string", description: "Telegram chat ID" },
        message: { type: "string", description: "Message text" },
      },
      required: ["chatId", "message"],
    },
    async execute({ chatId, message }) {
      return api("/api/tg-bot/send", "POST", { chatId, message });
    },
  },
  {
    name: "whatsapp_status",
    description: "Check WhatsApp bot connection status.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/wa-bot/status"); },
  },
  {
    name: "list_tickets",
    description: "List support tickets from bot users.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in_progress", "resolved", "closed", "all"] },
      },
      required: [],
    },
    async execute({ status = "open" }) {
      const qs = status !== "all" ? `?status=${status}` : "";
      return api(`/api/tickets${qs}`);
    },
  },
  {
    name: "notify_ticket_resolved",
    description: "Send a resolution notification to the user who filed a ticket.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId:   { type: "number" },
        agentNotes: { type: "string" },
      },
      required: ["ticketId"],
    },
    async execute({ ticketId, agentNotes = "Issue resolved." }) {
      return api(`/api/tg-bot/notify-ticket/${ticketId}`, "POST", { agentNotes });
    },
  },
];
