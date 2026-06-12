/**
 * DLavie OS — WhatsApp Bot Manager (Baileys)
 * Pairing code auth — no QR scan needed.
 * v1.0: AI chat responses only.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { generateWithFallback } from "./lib/provider-chain.js";

const SESSION_DIR = join(
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace",
  ".dlavie-wa-sessions"
);
const CONFIG_PATH = join(
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace",
  ".dlavie-wa-config.json"
);

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

export interface WaBotConfig {
  botName: string;
  ownerName: string;
  ownerNumber: string;
  prefix: string;
  style: "formal" | "santai" | "custom";
  customPrompt: string;
  activeModel: string;
  autoReply: boolean;
  welcomeMessage: string;
  phoneNumber: string;
}

export interface WaBotStatus {
  connected: boolean;
  phoneNumber?: string;
  botName?: string;
  pairingCode?: string;
  pairingStep?: "idle" | "waiting_code" | "waiting_scan" | "connected" | "error";
  error?: string;
  messageCount: number;
  uptime?: number;
}

export interface WaBotLog {
  ts: number;
  from: string;
  name: string;
  message: string;
  reply: string;
  model: string;
}

const DEFAULT_CONFIG: WaBotConfig = {
  botName: "DLavie Bot",
  ownerName: "Owner",
  ownerNumber: "",
  prefix: ".",
  style: "santai",
  customPrompt: "",
  activeModel: "auto",
  autoReply: true,
  welcomeMessage: "Halo! Saya DLavie Bot, asisten AI Anda. Ketik apa saja untuk mulai.",
  phoneNumber: "",
};

function loadConfig(): WaBotConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg: WaBotConfig): void {
  try { writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

function buildSystemPrompt(cfg: WaBotConfig): string {
  if (cfg.style === "custom" && cfg.customPrompt) return cfg.customPrompt;
  const base = `Kamu adalah ${cfg.botName}, asisten AI milik ${cfg.ownerName}.`;
  if (cfg.style === "formal") {
    return `${base} Gunakan bahasa yang formal, sopan, dan profesional. Jawab pertanyaan dengan lengkap dan akurat.`;
  }
  return `${base} Gunakan bahasa santai dan ramah seperti teman ngobrol. Jawab dengan singkat tapi informatif.`;
}

class WaBotManager {
  private sock: WASocket | null = null;
  private config: WaBotConfig = loadConfig();
  private status: WaBotStatus = { connected: false, pairingStep: "idle", messageCount: 0 };
  private logs: WaBotLog[] = [];
  private startTime: number | null = null;
  private reconnecting = false;

  getConfig() { return { ...this.config }; }
  setConfig(cfg: Partial<WaBotConfig>) {
    this.config = { ...this.config, ...cfg };
    saveConfig(this.config);
  }

  getStatus(): WaBotStatus {
    return {
      ...this.status,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : undefined,
    };
  }

  getLogs() { return [...this.logs].reverse().slice(0, 100); }

  clearSession() {
    try {
      const { rmSync } = require("fs");
      rmSync(SESSION_DIR, { recursive: true, force: true });
      mkdirSync(SESSION_DIR, { recursive: true });
    } catch { /* ignore */ }
  }

  async connect(phoneNumber: string): Promise<string> {
    if (this.sock) {
      try { this.sock.end(new Error("reconnect")); } catch { /* ignore */ }
      this.sock = null;
    }

    this.config.phoneNumber = phoneNumber;
    saveConfig(this.config);

    this.status = { connected: false, pairingStep: "waiting_code", messageCount: 0, phoneNumber };

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as never),
      },
      printQRInTerminal: false,
      browser: ["DLavie OS", "Chrome", "1.0.0"],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });

    const sock = this.sock;

    sock.ev.on("creds.update", saveCreds);

    let pairingCode = "";
    if (!state.creds.registered) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const cleaned = phoneNumber.replace(/[^0-9]/g, "");
        pairingCode = await sock.requestPairingCode(cleaned);
        this.status.pairingCode = pairingCode;
        this.status.pairingStep = "waiting_scan";
      } catch (e) {
        this.status = { connected: false, pairingStep: "error", error: String(e), messageCount: 0 };
        throw e;
      }
    } else {
      this.status.pairingStep = "waiting_scan";
    }

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        this.startTime = Date.now();
        this.status = {
          connected: true,
          pairingStep: "connected",
          phoneNumber,
          botName: this.config.botName,
          messageCount: this.status.messageCount,
        };
        console.log(`[WaBot] Connected as ${phoneNumber}`);
      }

      if (connection === "close") {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        this.status.connected = false;
        this.status.pairingStep = shouldReconnect ? "idle" : "error";
        this.status.error = shouldReconnect ? undefined : "Logged out";
        console.log(`[WaBot] Disconnected (code ${code}), reconnect=${shouldReconnect}`);

        if (shouldReconnect && !this.reconnecting) {
          this.reconnecting = true;
          setTimeout(async () => {
            this.reconnecting = false;
            try { await this.connect(phoneNumber); } catch { /* ignore */ }
          }, 5000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        if (!this.config.autoReply) continue;

        const from = msg.key.remoteJid;
        if (!from) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          "";

        if (!text.trim()) continue;

        const senderName = msg.pushName || from.split("@")[0];

        try {
          await sock.sendPresenceUpdate("composing", from);
          const systemPrompt = buildSystemPrompt(this.config);
          const { text: reply, provider, modelUsed } = await generateWithFallback(
            text,
            undefined,
            systemPrompt
          );

          const finalReply = reply.trim();
          await sock.sendMessage(from, { text: finalReply });
          await sock.sendPresenceUpdate("paused", from);

          this.status.messageCount = (this.status.messageCount || 0) + 1;
          this.logs.push({
            ts: Date.now(),
            from: senderName,
            name: senderName,
            message: text,
            reply: finalReply,
            model: `${provider}/${modelUsed}`,
          });
          if (this.logs.length > 200) this.logs = this.logs.slice(-200);
        } catch (e) {
          console.error("[WaBot] Error responding:", e);
        }
      }
    });

    return pairingCode;
  }

  async disconnect() {
    if (this.sock) {
      try { this.sock.end(new Error("user_disconnect")); } catch { /* ignore */ }
      this.sock = null;
    }
    this.clearSession();
    this.status = { connected: false, pairingStep: "idle", messageCount: 0 };
    this.startTime = null;
  }
}

export const waBotManager = new WaBotManager();
