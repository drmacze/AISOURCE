/**
 * DLavie OS — Telegram Bot Manager
 * Full AI auto-reply, .report ticket system, SSE events, no prefix needed.
 */

import { generateWithFallback } from "./lib/provider-chain.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { db } from "@workspace/db";
import { botTicketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const BASE        = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const CONFIG_PATH = join(BASE, ".dlavie-tg-config.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TgBotConfig {
  token:          string;
  botName:        string;
  ownerName:      string;
  ownerId?:       number;
  style:          "formal" | "santai" | "custom";
  customPrompt:   string;
  activeModel:    string;
  autoReply:      boolean;
  replyInGroup:   boolean;
  welcomeMessage: string;
}

export interface TgBotStatus {
  connected:    boolean;
  botUsername?: string;
  botName?:     string;
  error?:       string;
  messageCount: number;
  uptime?:      number;
}

export interface TgBotLog {
  ts:      number;
  from:    string;
  name:    string;
  isGroup: boolean;
  message: string;
  reply:   string;
  model:   string;
}

// ─── Report state machine ─────────────────────────────────────────────────────

type ReportStep = "idle" | "ask_title" | "ask_desc" | "ask_steps" | "done";

interface ReportSession {
  step:   ReportStep;
  title?: string;
  desc?:  string;
  steps?: string;
}

// ─── SSE broker ───────────────────────────────────────────────────────────────

type SSEClient = { send: (event: string, data: unknown) => void };
export const tgSSEClients = new Set<SSEClient>();

function broadcast(event: string, data: unknown) {
  for (const c of tgSSEClients) { try { c.send(event, data); } catch { tgSSEClients.delete(c); } }
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TgBotConfig = {
  token:          "",
  botName:        "DLavie Bot",
  ownerName:      "Owner",
  ownerId:        undefined,
  style:          "santai",
  customPrompt:   "",
  activeModel:    "auto",
  autoReply:      true,
  replyInGroup:   false,
  welcomeMessage: "Halo! Saya DLavie Bot, asisten AI Anda. Ketik apa saja untuk mulai.",
};

function loadConfig(): TgBotConfig {
  try {
    if (existsSync(CONFIG_PATH))
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<TgBotConfig> };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg: TgBotConfig) {
  try { writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

function buildSystemPrompt(cfg: TgBotConfig): string {
  if (cfg.style === "custom" && cfg.customPrompt) return cfg.customPrompt;
  const base = `Kamu adalah ${cfg.botName}, asisten AI milik ${cfg.ownerName}.`;
  if (cfg.style === "formal")
    return `${base} Gunakan bahasa yang formal, sopan, dan profesional. Jawab dengan lengkap dan akurat.`;
  return `${base} Gunakan bahasa santai dan ramah seperti teman ngobrol. Jawab singkat tapi informatif.`;
}

function buildFooter(cfg: TgBotConfig): string {
  return `\n\n_${cfg.botName}_ · _Powered by DLavie OS_`;
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function tgApi(token: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`Telegram API error: ${json.description ?? method}`);
  return json.result;
}

/** Send a structured (Markdown) message — used for .report, .stats, ticket responses */
async function sendMarkdown(token: string, chatId: number | string, text: string, replyTo?: number) {
  return tgApi(token, "sendMessage", {
    chat_id:                  chatId,
    text,
    parse_mode:               "Markdown",
    reply_to_message_id:      replyTo,
    disable_web_page_preview: true,
  });
}

/**
 * Send an AI-generated reply — NO parse_mode so we never get Telegram
 * "can't parse entities" errors from malformed markdown in LLM output.
 * Falls back automatically if the first attempt fails for any reason.
 */
async function sendAIReply(token: string, chatId: number | string, text: string, replyTo?: number) {
  try {
    return await tgApi(token, "sendMessage", {
      chat_id:                  chatId,
      text,
      reply_to_message_id:      replyTo,
      disable_web_page_preview: true,
    });
  } catch (e) {
    // If even plain text fails (rate limit, chat not found, etc.) log and rethrow
    console.error(`[TgBot] sendAIReply failed for chat ${chatId}:`, String(e));
    throw e;
  }
}

/** Backward-compat alias used by ticket / report notify callers */
const sendMessage = sendMarkdown;

// ─── Manager ──────────────────────────────────────────────────────────────────

class TgBotManager {
  private config:       TgBotConfig   = loadConfig();
  private status:       TgBotStatus   = { connected: false, messageCount: 0 };
  private logs:         TgBotLog[]    = [];
  private startTime:    number | null = null;
  private polling:      boolean       = false;
  private offset:       number        = 0;
  private abortCtrl:    AbortController | null = null;
  private reportSessions = new Map<number, ReportSession>();

  getConfig()  { return { ...this.config }; }
  getLogs()    { return [...this.logs].reverse().slice(0, 100); }
  getStatus(): TgBotStatus {
    return {
      ...this.status,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : undefined,
    };
  }

  setConfig(partial: Partial<TgBotConfig>) {
    this.config = { ...this.config, ...partial };
    saveConfig(this.config);
  }

  // ── Connect ────────────────────────────────────────────────────────────────

  async connect(): Promise<{ username: string; firstName: string }> {
    if (!this.config.token) throw new Error("Token Telegram belum diisi di Konfigurasi");

    // Stop any existing poll loop first
    this.polling = false;
    if (this.abortCtrl) { this.abortCtrl.abort(); this.abortCtrl = null; }

    // 1. deleteWebhook — REQUIRED before long-polling.
    //    Also drops any conflicting session left by a previous server instance (fixes 409).
    console.log("[TgBot] Clearing webhook / conflicting sessions…");
    await tgApi(this.config.token, "deleteWebhook", { drop_pending_updates: false })
      .catch((e) => console.warn("[TgBot] deleteWebhook warning:", String(e)));

    // 2. Verify token and get bot info
    const me = await tgApi(this.config.token, "getMe") as { username: string; first_name: string };

    // 3. Advance the offset to skip stale updates accumulated while the bot was offline.
    //    getUpdates with offset=-1 returns the latest update without blocking.
    try {
      const peek = await tgApi(this.config.token, "getUpdates", {
        offset: -1, limit: 1, timeout: 0, allowed_updates: ["message"],
      }) as TgUpdate[];
      if (peek.length > 0) {
        this.offset = peek[peek.length - 1].update_id + 1;
        console.log(`[TgBot] Fast-forwarded offset to ${this.offset} (skipping stale updates)`);
      }
    } catch { /* non-fatal */ }

    this.status = { connected: true, botUsername: me.username, botName: me.first_name, messageCount: this.status.messageCount };
    this.startTime = this.startTime ?? Date.now();
    console.log(`[TgBot] ✅ Connected — @${me.username}`);
    broadcast("tg_status", this.getStatus());

    this.startPolling();
    return { username: me.username, firstName: me.first_name };
  }

  disconnect() {
    this.polling = false;
    if (this.abortCtrl) { this.abortCtrl.abort(); this.abortCtrl = null; }
    this.status    = { connected: false, messageCount: 0 };
    this.startTime = null;
    this.offset    = 0;
    broadcast("tg_status", this.getStatus());
    console.log("[TgBot] Disconnected");
  }

  // ── Long-poll loop ─────────────────────────────────────────────────────────

  private startPolling() {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  private async pollLoop() {
    console.log("[TgBot] Poll loop started (offset=" + this.offset + ")");
    while (this.polling) {
      try {
        this.abortCtrl = new AbortController();
        const res = await fetch(
          `https://api.telegram.org/bot${this.config.token}/getUpdates`,
          {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ offset: this.offset, timeout: 25, allowed_updates: ["message"] }),
            signal:  AbortSignal.any([this.abortCtrl.signal, AbortSignal.timeout(35_000)]),
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 409) {
            // 409 should never appear after deleteWebhook, but handle gracefully just in case.
            // Telegram long-poll connections live at most 25 s, so 30 s is enough.
            console.warn("[TgBot] 409 Conflict — re-calling deleteWebhook to evict stale session…");
            await tgApi(this.config.token, "deleteWebhook", { drop_pending_updates: false })
              .catch(() => {});
            await sleep(5_000);
          } else {
            console.warn(`[TgBot] getUpdates HTTP ${res.status}: ${body.slice(0, 200)}`);
            await sleep(5_000);
          }
          continue;
        }
        const data = await res.json() as { ok: boolean; result: TgUpdate[]; description?: string };
        if (!data.ok) {
          console.warn(`[TgBot] getUpdates not ok: ${data.description ?? "unknown"}`);
          await sleep(5_000); continue;
        }

        for (const upd of data.result) {
          this.offset = upd.update_id + 1;
          if (upd.message) {
            console.log(`[TgBot] 📨 Message from ${upd.message.from?.first_name ?? "?"} (${upd.message.chat.id}): ${(upd.message.text ?? "").slice(0, 80)}`);
            await this.handleMessage(upd.message).catch((e) => {
              console.error(`[TgBot] handleMessage error for update ${upd.update_id}:`, String(e));
            });
          }
        }
      } catch (e) {
        if (!this.polling) break;
        console.warn("[TgBot] pollLoop error:", String(e));
        await sleep(3_000);
      }
    }
    console.log("[TgBot] Polling loop ended");
  }

  // ── Message handler ────────────────────────────────────────────────────────

  private async handleMessage(msg: TgMessage) {
    const chatId  = msg.chat.id;
    const isGroup = msg.chat.type !== "private";
    const text    = msg.text?.trim() ?? "";
    const fromId  = msg.from?.id ?? 0;
    const name    = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "User";

    if (!text) return;
    if (isGroup && !this.config.replyInGroup) return;

    // ── .report command ────────────────────────────────────────────────────

    if (text.toLowerCase() === ".report") {
      this.reportSessions.set(chatId, { step: "ask_title" });
      await sendMessage(this.config.token, chatId,
        "🎫 *Sistem Laporan DLavie OS*\n\nSilakan isi laporan Anda. Ketik /cancel untuk membatalkan.\n\n*Langkah 1/3:* Apa judul masalah atau fitur yang ingin dilaporkan?",
        msg.message_id
      );
      return;
    }

    if (text.toLowerCase() === "/cancel") {
      if (this.reportSessions.has(chatId)) {
        this.reportSessions.delete(chatId);
        await sendMessage(this.config.token, chatId, "❌ Laporan dibatalkan.", msg.message_id);
      }
      return;
    }

    // ── Report state machine ───────────────────────────────────────────────

    const session = this.reportSessions.get(chatId);
    if (session) {
      await this.handleReportFlow(session, chatId, fromId, name, text, msg.message_id);
      return;
    }

    // ── .stats command ─────────────────────────────────────────────────────

    if (text.toLowerCase() === ".stats") {
      const s = this.getStatus();
      const reply = `📊 *DLavie Bot Stats*\n\n• Platform: Telegram\n• Status: ${s.connected ? "🟢 Online" : "🔴 Offline"}\n• Pesan dibalas: ${s.messageCount}\n• Uptime: ${s.uptime ? formatUptime(s.uptime) : "—"}\n\n_Powered by DLavie OS_`;
      await sendMessage(this.config.token, chatId, reply, msg.message_id);
      return;
    }

    // ── AI auto-reply (no prefix needed) ──────────────────────────────────

    if (!this.config.autoReply) return;

    const { text: aiReply, provider, modelUsed } = await generateWithFallback(
      text, undefined, buildSystemPrompt(this.config)
    );

    // Plain text footer (no Markdown) because AI output may contain special chars
    // that break Telegram's legacy Markdown parser
    const footer = `\n\n${this.config.botName} · Powered by DLavie OS`;
    const finalReply = aiReply.trim() + footer;
    await sendAIReply(this.config.token, chatId, finalReply, msg.message_id);

    this.status.messageCount = (this.status.messageCount || 0) + 1;
    const logEntry: TgBotLog = {
      ts: Date.now(), from: String(chatId), name, isGroup,
      message: text, reply: finalReply, model: `${provider}/${modelUsed}`,
    };
    this.logs.push(logEntry);
    if (this.logs.length > 500) this.logs = this.logs.slice(-500);
    broadcast("tg_message", logEntry);
    broadcast("tg_status", this.getStatus());
  }

  // ── Report flow ────────────────────────────────────────────────────────────

  private async handleReportFlow(
    session: ReportSession, chatId: number, fromId: number,
    name: string, text: string, replyTo: number
  ) {
    if (session.step === "ask_title") {
      session.title = text;
      session.step  = "ask_desc";
      this.reportSessions.set(chatId, session);
      await sendMessage(this.config.token, chatId,
        `✅ Judul: *${text}*\n\n*Langkah 2/3:* Jelaskan masalah atau fitur yang diinginkan secara detail.`,
        replyTo
      );
      return;
    }

    if (session.step === "ask_desc") {
      session.desc = text;
      session.step = "ask_steps";
      this.reportSessions.set(chatId, session);
      await sendMessage(this.config.token, chatId,
        `✅ Deskripsi dicatat.\n\n*Langkah 3/3 (opsional):* Langkah-langkah untuk mereproduksi masalah ini? Ketik *skip* jika tidak ada.`,
        replyTo
      );
      return;
    }

    if (session.step === "ask_steps") {
      session.steps = text.toLowerCase() === "skip" ? undefined : text;
      session.step  = "done";
      this.reportSessions.delete(chatId);

      const [ticket] = await db.insert(botTicketsTable).values({
        platform:    "telegram",
        fromJid:     String(fromId),
        fromName:    name,
        title:       session.title!,
        description: session.desc!,
        steps:       session.steps,
        status:      "open",
        priority:    "medium",
      }).returning();

      console.log(`[TgBot] 🎫 Ticket #${ticket.id} created from ${name} (${fromId})`);
      broadcast("new_ticket", ticket);

      await sendMessage(this.config.token, chatId,
        `🎫 *Tiket #${ticket.id} berhasil dibuat!*\n\n📌 *Judul:* ${session.title}\n📝 *Status:* Menunggu ditinjau\n\nAgent DLavie OS akan segera meninjau laporan Anda dan mengirim notifikasi ke sini saat sudah ditangani. Terima kasih!`,
        replyTo
      );

      // Notify owner if configured
      if (this.config.ownerId) {
        await sendMessage(this.config.token, this.config.ownerId,
          `🔔 *Laporan baru masuk!*\n\n🎫 Tiket #${ticket.id}\n👤 Dari: ${name}\n📌 Judul: ${session.title}\n📝 ${session.desc}${session.steps ? `\n🔢 Langkah: ${session.steps}` : ""}`,
        ).catch(() => {});
      }
    }
  }

  // ── Notify ticket resolved ─────────────────────────────────────────────────

  async notifyTicketResolved(ticketId: number, agentNotes?: string) {
    const [ticket] = await db.select().from(botTicketsTable).where(eq(botTicketsTable.id, ticketId));
    if (!ticket) throw new Error(`Tiket #${ticketId} tidak ditemukan`);
    if (ticket.platform !== "telegram") throw new Error("Notifikasi ini hanya untuk Telegram");

    await sendMessage(this.config.token, Number(ticket.fromJid),
      `✅ *Tiket #${ticket.id} selesai ditangani!*\n\n📌 *${ticket.title}*\n${agentNotes ? `\n📋 *Catatan Agent:*\n${agentNotes}\n` : ""}\nTerima kasih telah melaporkan. _Powered by DLavie OS_`
    );

    await db.update(botTicketsTable)
      .set({ status: "resolved", agentNotes: agentNotes ?? null, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(botTicketsTable.id, ticketId));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function formatUptime(sec: number): string {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

// ─── Telegram update types ────────────────────────────────────────────────────

interface TgUpdate  { update_id: number; message?: TgMessage }
interface TgMessage {
  message_id: number;
  from?:      { id: number; first_name?: string; last_name?: string; username?: string };
  chat:       { id: number; type: "private" | "group" | "supergroup" | "channel" };
  text?:      string;
}

export const tgBotManager = new TgBotManager();

// ── Auto-reconnect on server start ────────────────────────────────────────────
// If a token was saved from a previous session, reconnect automatically so
// users don't have to manually click Connect after every server restart.
(async () => {
  const saved = tgBotManager.getConfig().token;
  if (saved) {
    try {
      await tgBotManager.connect();
      console.log("[TgBot] ✅ Auto-reconnected on server start");
    } catch (e) {
      console.warn("[TgBot] Auto-reconnect failed (will retry when user clicks Connect):", String(e));
    }
  }
})();
