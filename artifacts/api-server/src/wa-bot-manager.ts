/**
 * DLavie OS — WhatsApp Bot Manager (Baileys)
 * Pairing code auth — no QR needed.
 *
 * Features:
 *  - AI replies with "Powered by DLavie OS" footer
 *  - Auto-generated AI thumbnail (FLUX via HuggingFace) set as profile pic
 *  - LID/JID safety (filters @lid, broadcast, status, newsletter)
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  isJidBroadcast,
  isJidGroup,
  isJidStatusBroadcast,
  isJidNewsletter,
  jidNormalizedUser,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { join } from "path";
import {
  mkdirSync, existsSync, readFileSync, writeFileSync,
  rmSync,
} from "fs";
import { generateWithFallback } from "./lib/provider-chain.js";
import { db } from "@workspace/db";
import { botTicketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";

// ─── SSE broker ───────────────────────────────────────────────────────────────

type SSEClient = { send: (event: string, data: unknown) => void };
export const waSSEClients = new Set<SSEClient>();

function broadcast(event: string, data: unknown) {
  for (const c of waSSEClients) { try { c.send(event, data); } catch { waSSEClients.delete(c); } }
}

// ─── Report state machine ─────────────────────────────────────────────────────

type ReportStep = "idle" | "ask_title" | "ask_desc" | "ask_steps";
interface ReportSession { step: ReportStep; title?: string; desc?: string }

// ─── Paths ────────────────────────────────────────────────────────────────────

const BASE        = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const SESSION_DIR  = join(BASE, ".dlavie-wa-sessions");
const CONFIG_PATH  = join(BASE, ".dlavie-wa-config.json");
const THUMB_PATH   = join(BASE, ".dlavie-wa-thumb.jpg");

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

const logger = pino({ level: "silent" });

// ─── Thumbnail image generation (Pollinations → HF router → SVG fallback) ────

const THUMB_PROMPT = [
  "Professional AI software company logo, circular emblem design,",
  "deep slate blue background, subtle hexagonal grid pattern,",
  "bold clean typography 'DLavie OS' centered in white,",
  "small tagline 'AI ENGINE' below in light gray,",
  "electric green (#00ff88) thin accent ring border,",
  "minimalist corporate tech aesthetic, flat vector style,",
  "no gradients except background, elegant clean professional,",
  "high quality 512x512",
].join(" ");

/** Generate thumbnail JPEG — tries Pollinations → HF router → SVG fallback */
async function generateThumbnailImage(seed: number): Promise<Buffer> {
  // ── 1. Pollinations.ai (free, no auth, works from Replit) ──────────────────
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(THUMB_PROMPT)}?width=512&height=512&seed=${seed}&nologo=true&model=flux`;
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) {
        return Buffer.from(await res.arrayBuffer());
      }
      const msg = await res.text().catch(() => res.statusText);
      console.warn(`[WaBot] Pollinations attempt ${attempt}: ${res.status} ${msg.slice(0, 80)}`);
      if (res.status === 402 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 15_000));
      } else break;
    } catch (e) {
      console.warn(`[WaBot] Pollinations error: ${String(e).slice(0, 80)}`);
    }
  }

  // ── 2. HuggingFace router (requires token with inference credits) ──────────
  const token = process.env.HF_TOKEN || "";
  if (token.startsWith("hf_")) {
    try {
      // router.huggingface.co works from Replit; api-inference.huggingface.co is blocked
      const res = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Wait-For-Model": "true" },
          body: JSON.stringify({ inputs: THUMB_PROMPT, parameters: { seed, num_inference_steps: 4, width: 512, height: 512 } }),
          signal: AbortSignal.timeout(90_000),
        }
      );
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const msg = await res.text().catch(() => res.statusText);
      console.warn(`[WaBot] HF router error: ${res.status} ${msg.slice(0, 80)}`);
    } catch (e) {
      console.warn(`[WaBot] HF router error: ${String(e).slice(0, 80)}`);
    }
  }

  // ── 3. Local SVG fallback (always works, no dependencies) ─────────────────
  console.warn("[WaBot] Using local SVG fallback for thumbnail");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="200" fill="none" stroke="#22c55e" stroke-width="3" opacity="0.6"/>
  <circle cx="256" cy="256" r="145" fill="#020617" opacity="0.8"/>
  <polygon points="256,96 406,181 406,331 256,416 106,331 106,181" fill="none" stroke="#22c55e" stroke-width="1" opacity="0.2"/>
  <text x="256" y="240" text-anchor="middle" dominant-baseline="middle"
        font-family="sans-serif" font-weight="700" font-size="64" fill="#ffffff">DL</text>
  <text x="256" y="295" text-anchor="middle" dominant-baseline="middle"
        font-family="sans-serif" font-weight="600" font-size="18" fill="#22c55e" letter-spacing="6">OS</text>
  <text x="256" y="340" text-anchor="middle" dominant-baseline="middle"
        font-family="sans-serif" font-size="12" fill="#94a3b8" letter-spacing="3">AI ENGINE</text>
</svg>`;
  return Buffer.from(svg, "utf8");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeviceType  = "personal" | "business" | "mac" | "windows";
export type BotStyle    = "formal" | "santai" | "custom";
export type PairingStep = "idle" | "waiting_code" | "waiting_scan" | "connected" | "error";

export interface WaBotConfig {
  botName:        string;
  ownerName:      string;
  ownerNumber:    string;
  prefix:         string;
  style:          BotStyle;
  customPrompt:   string;
  activeModel:    string;
  autoReply:      boolean;
  replyInGroup:   boolean;
  welcomeMessage: string;
  phoneNumber:    string;
  deviceType:     DeviceType;
  thumbnailSeed:  number;        // unique seed per "user" — changes on regenerate
}

export interface WaBotStatus {
  connected:     boolean;
  phoneNumber?:  string;
  botName?:      string;
  deviceType?:   DeviceType;
  pairingCode?:  string;
  pairingStep?:  PairingStep;
  error?:        string;
  messageCount:  number;
  uptime?:       number;
  hasThumb:      boolean;
}

export interface WaBotLog {
  ts:      number;
  from:    string;
  name:    string;
  isGroup: boolean;
  message: string;
  reply:   string;
  model:   string;
}

// ─── Defaults & helpers ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: WaBotConfig = {
  botName:        "DLavie Bot",
  ownerName:      "Owner",
  ownerNumber:    "",
  prefix:         ".",
  style:          "santai",
  customPrompt:   "",
  activeModel:    "auto",
  autoReply:      true,
  replyInGroup:   false,
  welcomeMessage: "Halo! Saya DLavie Bot, asisten AI Anda. Ketik apa saja untuk mulai.",
  phoneNumber:    "",
  deviceType:     "personal",
  thumbnailSeed:  Math.floor(Math.random() * 999999),
};

function loadConfig(): WaBotConfig {
  try {
    if (existsSync(CONFIG_PATH))
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg: WaBotConfig): void {
  try { writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

function getBrowser(type: DeviceType): [string, string, string] {
  switch (type) {
    case "business": return Browsers.appropriate("Chrome");
    case "mac":      return Browsers.macOS("Desktop");
    case "windows":  return Browsers.windows();
    default:         return Browsers.ubuntu("Chrome");
  }
}

function buildSystemPrompt(cfg: WaBotConfig): string {
  if (cfg.style === "custom" && cfg.customPrompt) return cfg.customPrompt;
  const base = `Kamu adalah ${cfg.botName}, asisten AI milik ${cfg.ownerName}.`;
  if (cfg.style === "formal")
    return `${base} Gunakan bahasa yang formal, sopan, dan profesional. Jawab dengan lengkap dan akurat.`;
  return `${base} Gunakan bahasa santai dan ramah seperti teman ngobrol. Jawab singkat tapi informatif.`;
}

/**
 * Footer appended to every bot reply.
 * Uses WhatsApp italic + bold formatting.
 */
function buildFooter(cfg: WaBotConfig): string {
  return `\n\n_${cfg.botName}_ · _Powered by *DLavie OS*_`;
}

function formatUptime(sec: number): string {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function shouldIgnoreJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  if (jid.endsWith("@lid"))     return true;
  if (isJidBroadcast(jid))     return true;
  if (isJidStatusBroadcast(jid)) return true;
  if (isJidNewsletter(jid))    return true;
  return false;
}

function extractText(msg: { message?: Record<string, unknown> | null }): string {
  if (!msg.message) return "";
  const m = msg.message as Record<string, { text?: string; caption?: string; selectedDisplayText?: string; title?: string } | string | undefined>;
  return (
    (typeof m["conversation"] === "string" ? m["conversation"] : "") ||
    (m["extendedTextMessage"] as { text?: string } | undefined)?.text ||
    (m["imageMessage"] as { caption?: string } | undefined)?.caption ||
    (m["videoMessage"] as { caption?: string } | undefined)?.caption ||
    (m["documentMessage"] as { caption?: string } | undefined)?.caption ||
    (m["buttonsResponseMessage"] as { selectedDisplayText?: string } | undefined)?.selectedDisplayText ||
    (m["listResponseMessage"] as { title?: string } | undefined)?.title ||
    ""
  );
}

// ─── Manager ──────────────────────────────────────────────────────────────────

class WaBotManager {
  private sock:             WASocket | null = null;
  private config:           WaBotConfig     = loadConfig();
  private status:           WaBotStatus     = { connected: false, pairingStep: "idle", messageCount: 0, hasThumb: existsSync(THUMB_PATH) };
  private logs:             WaBotLog[]      = [];
  private startTime:        number | null   = null;
  private reconnecting:     boolean         = false;
  private wasEverConnected: boolean         = false;
  private reportSessions    = new Map<string, ReportSession>();

  // ── Public getters ────────────────────────────────────────────────────────

  getConfig()   { return { ...this.config }; }
  getLogs()     { return [...this.logs].reverse().slice(0, 100); }
  getStatus(): WaBotStatus {
    return {
      ...this.status,
      hasThumb: existsSync(THUMB_PATH),
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : undefined,
    };
  }

  setConfig(partial: Partial<WaBotConfig>) {
    this.config = { ...this.config, ...partial };
    saveConfig(this.config);
  }

  // ── Thumbnail ─────────────────────────────────────────────────────────────

  getThumbnailBase64(): string | null {
    try {
      if (!existsSync(THUMB_PATH)) return null;
      const buf = readFileSync(THUMB_PATH);
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch { return null; }
  }

  async generateThumbnail(newSeed?: boolean): Promise<string> {
    if (newSeed) {
      this.config.thumbnailSeed = Math.floor(Math.random() * 999999);
      saveConfig(this.config);
    }
    console.log(`[WaBot] Generating thumbnail (seed=${this.config.thumbnailSeed})…`);
    const buf = await generateThumbnailImage(this.config.thumbnailSeed);
    writeFileSync(THUMB_PATH, buf);
    console.log(`[WaBot] Thumbnail saved (${buf.length} bytes)`);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }

  async applyProfilePic(): Promise<void> {
    if (!this.sock || !this.status.connected) throw new Error("Bot belum terhubung");
    if (!existsSync(THUMB_PATH)) throw new Error("Thumbnail belum di-generate");
    const buf = readFileSync(THUMB_PATH);
    const jid = (this.sock.user?.id ?? "").replace(/:.*@/, "@");
    await this.sock.updateProfilePicture(jid, buf);
    console.log(`[WaBot] Profile picture updated for ${jid}`);
  }

  // ── Session management ────────────────────────────────────────────────────

  private clearSession(): void {
    try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    try { mkdirSync(SESSION_DIR, { recursive: true }); }          catch { /* ignore */ }
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async connect(phoneNumber: string): Promise<string> {
    // Tear down any existing socket
    if (this.sock) {
      try { this.sock.end(new Error("reconnect")); } catch { /* ignore */ }
      this.sock = null;
    }
    this.reconnecting     = false;
    this.wasEverConnected = false;

    const cleaned = phoneNumber.replace(/[^0-9]/g, "");
    this.config.phoneNumber = cleaned;
    saveConfig(this.config);

    this.status = { connected: false, pairingStep: "waiting_code", messageCount: 0, phoneNumber: cleaned, hasThumb: existsSync(THUMB_PATH) };

    // Always wipe stale session so WhatsApp doesn't see a half-registered device
    this.clearSession();

    const { version }          = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser:                        getBrowser(this.config.deviceType),
      printQRInTerminal:              false,
      syncFullHistory:                false,
      generateHighQualityLinkPreview: false,
      getMessage:                     async () => undefined,
    });

    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);

    // ── Pairing code — requested inside connection.update once WS is ready ──

    let pairingCode = "";

    if (!state.creds.registered) {
      // Wait for the socket to signal it's ready for pairing (or timeout after 30s)
      pairingCode = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout menunggu koneksi WhatsApp (30s)")), 30_000);

        let pairingRequested = false;

        const handler = async (update: { connection?: string; lastDisconnect?: unknown }) => {
          if (pairingRequested) return;
          try {
            if (update.connection === "connecting") {
              // WS handshake started — wait briefly for the channel to stabilise
              pairingRequested = true;
              clearTimeout(timer);
              sock.ev.off("connection.update", handler as never);
              await new Promise((r) => setTimeout(r, 1500));
              try {
                let code = await sock.requestPairingCode(cleaned);
                if (code && !code.includes("-") && code.length === 8)
                  code = `${code.slice(0, 4)}-${code.slice(4)}`;
                console.log(`[WaBot] Pairing code issued: ${code}`);
                this.status.pairingCode = code;
                this.status.pairingStep = "waiting_scan";
                broadcast("wa_status", this.getStatus());
                resolve(code);
              } catch (e) {
                this.status = { connected: false, pairingStep: "error", error: String(e), messageCount: 0, hasThumb: existsSync(THUMB_PATH) };
                reject(e);
              }
            } else if (update.connection === "close") {
              clearTimeout(timer);
              sock.ev.off("connection.update", handler as never);
              const err = new Error("Connection Closed — coba lagi");
              this.status = { connected: false, pairingStep: "error", error: String(err), messageCount: 0, hasThumb: existsSync(THUMB_PATH) };
              reject(err);
            }
          } catch (e) { reject(e as Error); }
        };

        sock.ev.on("connection.update", handler as never);
      });
    } else {
      this.status.pairingStep = "waiting_scan";
    }

    // ── Persistent connection events (after pairing code is issued) ───────────

    sock.ev.on("connection.update", (update) => {
      try {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          this.startTime = Date.now();
          this.wasEverConnected = true;
          this.status = {
            connected:    true,
            pairingStep:  "connected",
            phoneNumber:  cleaned,
            botName:      this.config.botName,
            deviceType:   this.config.deviceType,
            messageCount: this.status.messageCount,
            hasThumb:     existsSync(THUMB_PATH),
          };
          console.log(`[WaBot] ✅ Connected — ${cleaned} (${this.config.deviceType})`);
          broadcast("wa_status", this.getStatus());

          // Auto-apply profile pic if we have one, else generate first
          setTimeout(async () => {
            try {
              if (!existsSync(THUMB_PATH)) {
                console.log("[WaBot] No thumbnail found — generating one…");
                await this.generateThumbnail(false);
              }
              await this.applyProfilePic();
            } catch (e) {
              console.warn("[WaBot] Could not apply profile pic:", e);
            }
          }, 4000);
        }

        if (connection === "close") {
          const code      = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;

          this.status.connected = false;
          console.log(`[WaBot] Disconnected (code=${code}, wasConnected=${this.wasEverConnected})`);

          if (loggedOut) {
            // Explicit logout — stop everything, let user reconnect manually
            this.status.pairingStep = "error";
            this.status.error       = "Logged out — silakan hubungkan ulang";
          } else if (this.wasEverConnected && !this.reconnecting) {
            // Was fully connected before — safe to auto-reconnect without disturbing user
            this.status.pairingStep = "idle";
            this.reconnecting = true;
            setTimeout(async () => {
              this.reconnecting = false;
              try { await this.connect(cleaned); } catch { /* ignore */ }
            }, 5000);
          } else {
            // Never reached "open" — still in pairing phase; keep the pairing code
            // visible and let the user retry manually (don't auto-reconnect and
            // regenerate the code under their feet)
            this.status.pairingStep = "error";
            this.status.error       = "Koneksi terputus — tekan Hubungkan lagi";
          }
        }
      } catch (e) { console.error("[WaBot] connection.update error:", e); }
    });

    // ── Message handler ───────────────────────────────────────────────────

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        try {
          if (!msg.message)   continue;
          if (msg.key.fromMe) continue;

          const rawJid = msg.key.remoteJid ?? "";
          if (shouldIgnoreJid(rawJid)) continue;

          const isGroup = isJidGroup(rawJid);
          if (isGroup && !this.config.replyInGroup) continue;

          let jid: string;
          try { jid = jidNormalizedUser(rawJid); } catch { jid = rawJid; }

          const text = extractText(msg as Parameters<typeof extractText>[0]);
          if (!text.trim()) continue;

          const senderName = msg.pushName || jid.split("@")[0];

          // ── .report command ──────────────────────────────────────────────
          if (text.toLowerCase() === ".report") {
            this.reportSessions.set(jid, { step: "ask_title" });
            await sock.sendMessage(jid, {
              text: "🎫 *Sistem Laporan DLavie OS*\n\nSilakan isi laporan Anda.\n\n*Langkah 1/3:* Apa judul masalah atau fitur yang ingin dilaporkan?",
            }, { quoted: msg });
            continue;
          }

          if (text.toLowerCase() === "/cancel") {
            if (this.reportSessions.has(jid)) {
              this.reportSessions.delete(jid);
              await sock.sendMessage(jid, { text: "❌ Laporan dibatalkan." }, { quoted: msg });
            }
            continue;
          }

          // ── .stats command ───────────────────────────────────────────────
          if (text.toLowerCase() === ".stats") {
            const s = this.getStatus();
            await sock.sendMessage(jid, {
              text: `📊 *DLavie Bot Stats*\n\n• Platform: WhatsApp\n• Status: ${s.connected ? "🟢 Online" : "🔴 Offline"}\n• Pesan dibalas: ${s.messageCount}\n• Uptime: ${s.uptime !== undefined ? formatUptime(s.uptime) : "—"}\n\n_Powered by DLavie OS_`,
            }, { quoted: msg });
            continue;
          }

          // ── Report state machine ─────────────────────────────────────────
          const session = this.reportSessions.get(jid);
          if (session) {
            await this.handleReportFlow(sock, session, jid, senderName, text, msg);
            continue;
          }

          if (!this.config.autoReply) continue;

          try { await sock.sendPresenceUpdate("composing", jid); } catch { /* ignore */ }

          const { text: reply, provider, modelUsed } = await generateWithFallback(
            text, undefined, buildSystemPrompt(this.config)
          );

          const finalReply = reply.trim() + buildFooter(this.config);
          await sock.sendMessage(jid, { text: finalReply }, { quoted: msg });
          try { await sock.sendPresenceUpdate("paused", jid); } catch { /* ignore */ }

          this.status.messageCount = (this.status.messageCount || 0) + 1;
          const logEntry: WaBotLog = {
            ts: Date.now(), from: jid, name: senderName, isGroup,
            message: text, reply: finalReply,
            model: `${provider}/${modelUsed}`,
          };
          this.logs.push(logEntry);
          if (this.logs.length > 500) this.logs = this.logs.slice(-500);
          broadcast("wa_message", logEntry);
          broadcast("wa_status", this.getStatus());

        } catch (e) {
          console.error("[WaBot] Message error:", e);
        }
      }
    });

    return pairingCode;
  }

  // ── Report flow ────────────────────────────────────────────────────────────

  private async handleReportFlow(
    sock: WASocket, session: ReportSession, jid: string,
    name: string, text: string, quotedMsg: unknown
  ) {
    const quoted = quotedMsg as Parameters<typeof sock.sendMessage>[2] & { quoted: unknown };

    if (session.step === "ask_title") {
      session.title = text;
      session.step  = "ask_desc";
      this.reportSessions.set(jid, session);
      await sock.sendMessage(jid, {
        text: `✅ Judul: *${text}*\n\n*Langkah 2/3:* Jelaskan masalah atau fitur yang diinginkan secara detail.`,
      }, { quoted: quoted.quoted });
      return;
    }

    if (session.step === "ask_desc") {
      session.desc = text;
      session.step = "ask_steps";
      this.reportSessions.set(jid, session);
      await sock.sendMessage(jid, {
        text: `✅ Deskripsi dicatat.\n\n*Langkah 3/3 (opsional):* Langkah-langkah untuk mereproduksi masalah? Ketik *skip* jika tidak ada.`,
      }, { quoted: quoted.quoted });
      return;
    }

    if (session.step === "ask_steps") {
      const steps = text.toLowerCase() === "skip" ? undefined : text;
      this.reportSessions.delete(jid);

      const [ticket] = await db.insert(botTicketsTable).values({
        platform:    "whatsapp",
        fromJid:     jid,
        fromName:    name,
        title:       session.title!,
        description: session.desc!,
        steps,
        status:      "open",
        priority:    "medium",
      }).returning();

      console.log(`[WaBot] 🎫 Ticket #${ticket.id} created from ${name} (${jid})`);
      broadcast("new_ticket", ticket);

      await sock.sendMessage(jid, {
        text: `🎫 *Tiket #${ticket.id} berhasil dibuat!*\n\n📌 *Judul:* ${session.title}\n📝 *Status:* Menunggu ditinjau\n\nAgent DLavie OS akan segera meninjau laporan Anda dan mengirim notifikasi ke sini saat sudah ditangani. Terima kasih! 🙏`,
      }, { quoted: quoted.quoted });
    }
  }

  // ── Notify ticket resolved ─────────────────────────────────────────────────

  async notifyTicketResolved(ticketId: number, agentNotes?: string): Promise<void> {
    if (!this.sock || !this.status.connected) throw new Error("Bot belum terhubung");

    const [ticket] = await db.select().from(botTicketsTable).where(eq(botTicketsTable.id, ticketId));
    if (!ticket) throw new Error(`Tiket #${ticketId} tidak ditemukan`);
    if (ticket.platform !== "whatsapp") throw new Error("Notifikasi ini hanya untuk WhatsApp");

    await this.sock.sendMessage(ticket.fromJid, {
      text: `✅ *Tiket #${ticket.id} selesai ditangani!*\n\n📌 *${ticket.title}*\n${agentNotes ? `\n📋 *Catatan Agent:*\n${agentNotes}\n` : ""}\nTerima kasih telah melaporkan. _Powered by DLavie OS_`,
    });

    await db.update(botTicketsTable)
      .set({ status: "resolved", agentNotes: agentNotes ?? null, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(botTicketsTable.id, ticketId));
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.reconnecting     = true;
    this.wasEverConnected = false;
    if (this.sock) {
      try { this.sock.end(new Error("user_disconnect")); } catch { /* ignore */ }
      this.sock = null;
    }
    this.clearSession();
    this.status       = { connected: false, pairingStep: "idle", messageCount: 0, hasThumb: existsSync(THUMB_PATH) };
    this.startTime    = null;
    this.reconnecting = false;
  }
}

export const waBotManager = new WaBotManager();
