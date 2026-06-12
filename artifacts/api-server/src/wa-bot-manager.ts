/**
 * DLavie OS — WhatsApp Bot Manager (Baileys)
 * Pairing code auth — no QR needed.
 * v1.0: AI chat responses only.
 *
 * LID/JID safety:
 *  - Filters @lid, broadcast, status, newsletter JIDs
 *  - Normalises sender JID before every operation
 *  - Wraps every event handler in try/catch so one bad message never crashes the socket
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
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { generateWithFallback } from "./lib/provider-chain.js";
import pino from "pino";

// ─── Paths ───────────────────────────────────────────────────────────────────

const BASE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const SESSION_DIR = join(BASE, ".dlavie-wa-sessions");
const CONFIG_PATH  = join(BASE, ".dlavie-wa-config.json");

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

// Silent logger so Baileys internals don't spam the console
const logger = pino({ level: "silent" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeviceType = "personal" | "business" | "mac" | "windows";
export type BotStyle   = "formal" | "santai" | "custom";
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
  replyInGroup:   boolean;   // whether to reply in group chats too
  welcomeMessage: string;
  phoneNumber:    string;
  deviceType:     DeviceType;
}

export interface WaBotStatus {
  connected:    boolean;
  phoneNumber?: string;
  botName?:     string;
  deviceType?:  DeviceType;
  pairingCode?: string;
  pairingStep?: PairingStep;
  error?:       string;
  messageCount: number;
  uptime?:      number;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Returns the Baileys browser tuple for the selected device type */
function getBrowser(type: DeviceType): [string, string, string] {
  switch (type) {
    case "business":  return Browsers.appropriate("Chrome");  // WA Business fingerprint
    case "mac":       return Browsers.macOS("Desktop");
    case "windows":   return Browsers.windows();
    case "personal":
    default:          return ["DLavie OS", "Chrome", "131.0.0"];
  }
}

/** Build the AI system prompt from config */
function buildSystemPrompt(cfg: WaBotConfig): string {
  if (cfg.style === "custom" && cfg.customPrompt) return cfg.customPrompt;
  const base = `Kamu adalah ${cfg.botName}, asisten AI milik ${cfg.ownerName}.`;
  if (cfg.style === "formal")
    return `${base} Gunakan bahasa yang formal, sopan, dan profesional. Jawab pertanyaan dengan lengkap dan akurat.`;
  return `${base} Gunakan bahasa santai dan ramah seperti teman ngobrol. Jawab dengan singkat tapi informatif.`;
}

/**
 * Returns true if the JID should be completely ignored.
 * Covers: broadcast lists, status updates, newsletters, and @lid phantom accounts.
 */
function shouldIgnoreJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  if (jid.endsWith("@lid"))          return true;   // LID — linked-device proxy, not a real chat
  if (isJidBroadcast(jid))          return true;
  if (isJidStatusBroadcast(jid))    return true;
  if (isJidNewsletter(jid))         return true;
  return false;
}

/** Extract the plain text from any WhatsApp message type */
function extractText(msg: { message?: Record<string, unknown> | null }): string {
  if (!msg.message) return "";
  const m = msg.message as Record<string, { text?: string; caption?: string } | string | undefined>;
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
  private sock:         WASocket | null = null;
  private config:       WaBotConfig     = loadConfig();
  private status:       WaBotStatus     = { connected: false, pairingStep: "idle", messageCount: 0 };
  private logs:         WaBotLog[]      = [];
  private startTime:    number | null   = null;
  private reconnecting: boolean         = false;

  // ── Public getters ────────────────────────────────────────────────────────

  getConfig()   { return { ...this.config }; }
  getLogs()     { return [...this.logs].reverse().slice(0, 100); }
  getStatus(): WaBotStatus {
    return {
      ...this.status,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : undefined,
    };
  }

  setConfig(partial: Partial<WaBotConfig>) {
    this.config = { ...this.config, ...partial };
    saveConfig(this.config);
  }

  // ── Session management ────────────────────────────────────────────────────

  private clearSession(): void {
    try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    try { mkdirSync(SESSION_DIR, { recursive: true }); }          catch { /* ignore */ }
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async connect(phoneNumber: string): Promise<string> {
    // Tear down any existing socket cleanly
    if (this.sock) {
      try { this.sock.end(new Error("reconnect")); } catch { /* ignore */ }
      this.sock = null;
    }

    const cleaned = phoneNumber.replace(/[^0-9]/g, "");
    this.config.phoneNumber = cleaned;
    saveConfig(this.config);

    this.status = { connected: false, pairingStep: "waiting_code", messageCount: 0, phoneNumber: cleaned };

    // ── Build socket ──────────────────────────────────────────────────────

    const { version }          = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser:                       getBrowser(this.config.deviceType),
      printQRInTerminal:             false,
      syncFullHistory:               false,
      generateHighQualityLinkPreview: false,
      // Provide a getMessage fallback so Baileys doesn't crash on retry
      getMessage: async () => undefined,
    });

    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);

    // ── Request pairing code (only on fresh session) ──────────────────────

    let pairingCode = "";
    if (!state.creds.registered) {
      // Small delay so the socket handshake can settle
      await new Promise((r) => setTimeout(r, 3000));
      try {
        pairingCode = await sock.requestPairingCode(cleaned);
        // Format as "XXXX-XXXX" if not already
        if (pairingCode && !pairingCode.includes("-") && pairingCode.length === 8) {
          pairingCode = `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`;
        }
        this.status.pairingCode  = pairingCode;
        this.status.pairingStep  = "waiting_scan";
        console.log(`[WaBot] Pairing code issued for ${cleaned}`);
      } catch (e) {
        this.status = { connected: false, pairingStep: "error", error: String(e), messageCount: 0 };
        throw e;
      }
    } else {
      // Already registered — just wait for the connection to open
      this.status.pairingStep = "waiting_scan";
    }

    // ── Connection events ─────────────────────────────────────────────────

    sock.ev.on("connection.update", (update) => {
      try {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          this.startTime = Date.now();
          this.status = {
            connected:    true,
            pairingStep:  "connected",
            phoneNumber:  cleaned,
            botName:      this.config.botName,
            deviceType:   this.config.deviceType,
            messageCount: this.status.messageCount,
          };
          console.log(`[WaBot] ✅ Connected — ${cleaned} (${this.config.deviceType})`);
        }

        if (connection === "close") {
          const statusCode   = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const loggedOut    = statusCode === DisconnectReason.loggedOut;
          const shouldRetry  = !loggedOut;

          this.status.connected   = false;
          this.status.pairingStep = loggedOut ? "error" : "idle";
          this.status.error       = loggedOut ? "Logged out — please reconnect" : undefined;

          console.log(`[WaBot] Disconnected (${statusCode}), retry=${shouldRetry}`);

          if (shouldRetry && !this.reconnecting) {
            this.reconnecting = true;
            setTimeout(async () => {
              this.reconnecting = false;
              try { await this.connect(cleaned); } catch { /* ignore */ }
            }, 5000);
          }
        }
      } catch (e) {
        console.error("[WaBot] connection.update error:", e);
      }
    });

    // ── Message handler ───────────────────────────────────────────────────

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        try {
          // ── Guard: skip invalid / unwanted messages ──────────────────

          if (!msg.message)    continue;  // no content
          if (msg.key.fromMe)  continue;  // message sent by the bot itself

          const rawJid = msg.key.remoteJid ?? "";

          // LID + broadcast + status + newsletter — always skip
          if (shouldIgnoreJid(rawJid)) continue;

          const isGroup = isJidGroup(rawJid);

          // Optionally skip group messages
          if (isGroup && !this.config.replyInGroup) continue;

          // Normalise the JID (removes the device suffix, etc.)
          let jid: string;
          try { jid = jidNormalizedUser(rawJid); }
          catch { jid = rawJid; }  // fallback — keep raw if normalisation fails

          // Auto-reply guard
          if (!this.config.autoReply) continue;

          // ── Extract text ──────────────────────────────────────────────

          const text = extractText(msg as Parameters<typeof extractText>[0]);
          if (!text.trim()) continue;

          const senderName = msg.pushName || jid.split("@")[0];

          // ── Typing indicator ──────────────────────────────────────────

          try { await sock.sendPresenceUpdate("composing", jid); } catch { /* ignore */ }

          // ── AI response ───────────────────────────────────────────────

          const systemPrompt = buildSystemPrompt(this.config);
          const { text: reply, provider, modelUsed } = await generateWithFallback(
            text,
            undefined,
            systemPrompt
          );
          const finalReply = reply.trim();

          // ── Send reply ────────────────────────────────────────────────

          await sock.sendMessage(
            jid,
            { text: finalReply },
            // Quote the original message so the user sees context
            { quoted: msg }
          );

          try { await sock.sendPresenceUpdate("paused", jid); } catch { /* ignore */ }

          // ── Record log ────────────────────────────────────────────────

          this.status.messageCount = (this.status.messageCount || 0) + 1;
          this.logs.push({
            ts:      Date.now(),
            from:    jid,
            name:    senderName,
            isGroup,
            message: text,
            reply:   finalReply,
            model:   `${provider}/${modelUsed}`,
          });
          if (this.logs.length > 500) this.logs = this.logs.slice(-500);

        } catch (e) {
          // Never let a single bad message crash the whole listener
          console.error("[WaBot] Error handling message:", e);
        }
      }
    });

    return pairingCode;
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.reconnecting = true; // prevent auto-reconnect
    if (this.sock) {
      try { this.sock.end(new Error("user_disconnect")); } catch { /* ignore */ }
      this.sock = null;
    }
    this.clearSession();
    this.status       = { connected: false, pairingStep: "idle", messageCount: 0 };
    this.startTime    = null;
    this.reconnecting = false;
  }
}

export const waBotManager = new WaBotManager();
