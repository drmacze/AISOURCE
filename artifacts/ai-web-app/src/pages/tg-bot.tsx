/**
 * DLavie OS — Telegram Bot Page
 * AI auto-reply, .report ticket system, SSE real-time.
 */

import { useState, useEffect, useRef } from "react";
import {
  Send, Bot, Loader2, CheckCircle2, XCircle, LogOut,
  MessageSquare, Clock, Sliders, AlertCircle, Zap,
  PlugZap, Settings2, Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface TgStatus {
  connected:    boolean;
  botUsername?: string;
  botName?:     string;
  error?:       string;
  messageCount: number;
  uptime?:      number;
}

interface TgConfig {
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

interface TgLog {
  ts:      number;
  from:    string;
  name:    string;
  isGroup: boolean;
  message: string;
  reply:   string;
  model:   string;
}

const DEFAULT_CONFIG: TgConfig = {
  token: "", botName: "DLavie Bot", ownerName: "Owner",
  style: "santai", customPrompt: "", activeModel: "auto",
  autoReply: true, replyInGroup: false,
  welcomeMessage: "Halo! Saya DLavie Bot, asisten AI Anda.",
};

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function timeAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

export default function TgBotPage() {
  const [status, setStatus]   = useState<TgStatus | null>(null);
  const [config, setConfig]   = useState<TgConfig>(DEFAULT_CONFIG);
  const [logs, setLogs]       = useState<TgLog[]>([]);
  const [tab, setTab]         = useState<"connect" | "config" | "logs">("connect");
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // SSE — real-time events
  useEffect(() => {
    const es = new EventSource("/api/tg-bot/events");
    esRef.current = es;
    es.addEventListener("tg_status", (e) => {
      setStatus(JSON.parse(e.data) as TgStatus);
    });
    es.addEventListener("tg_message", (e) => {
      setLogs((prev) => [JSON.parse(e.data) as TgLog, ...prev].slice(0, 100));
    });
    es.onerror = () => {
      // SSE auto-reconnects — no action needed
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    loadConfig();
    loadStatus();
  }, []);

  useEffect(() => {
    if (tab === "logs") loadLogs();
  }, [tab]);

  async function loadStatus() {
    try {
      const r = await fetch("/api/tg-bot/status");
      setStatus(await r.json() as TgStatus);
    } catch { /* ignore */ }
  }

  async function loadConfig() {
    try {
      const r = await fetch("/api/tg-bot/config");
      const d = await r.json() as TgConfig;
      setConfig(d);
    } catch { /* ignore */ }
  }

  async function loadLogs() {
    try {
      const r = await fetch("/api/tg-bot/logs");
      const d = await r.json() as { logs: TgLog[] };
      setLogs(d.logs);
    } catch { /* ignore */ }
  }

  async function handleConnect() {
    if (!tokenInput.trim()) { setError("Masukkan Bot Token dari @BotFather"); return; }
    setError(null);
    setConnecting(true);
    try {
      // Save token first
      await fetch("/api/tg-bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, token: tokenInput.trim() }),
      });
      const r = await fetch("/api/tg-bot/connect", { method: "POST" });
      const d = await r.json() as { ok?: boolean; username?: string; error?: string };
      if (!r.ok || d.error) { setError(d.error || "Gagal connect"); return; }
    } catch (e) { setError(String(e)); }
    finally { setConnecting(false); }
  }

  async function handleDisconnect() {
    if (!confirm("Putuskan koneksi Telegram bot?")) return;
    await fetch("/api/tg-bot/disconnect", { method: "POST" });
    loadStatus();
  }

  async function saveConfig() {
    setSaving(true);
    try {
      await fetch("/api/tg-bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setDirty(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  function upd<K extends keyof TgConfig>(k: K, v: TgConfig[K]) {
    setConfig((c) => ({ ...c, [k]: v }));
    setDirty(true);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Header */}
      <div className="flex-none border-b border-slate-800/60 bg-slate-900/40 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Send className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Telegram Bot</h1>
              <p className="text-xs text-slate-400">AI assistant via Bot API — auto-reply</p>
            </div>
          </div>
          {status?.connected ? (
            <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              @{status.botUsername} · {status.messageCount} pesan
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-800 px-2.5 py-1 rounded-full border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              Offline
            </div>
          )}
        </div>
        <div className="flex gap-1 mt-4">
          {(["connect", "config", "logs"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                tab === t
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/25"
                  : "text-slate-400 hover:text-slate-300 hover:bg-slate-800"
              )}>
              {t === "connect" ? "Koneksi" : t === "config" ? "Konfigurasi" : "Log Pesan"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-xs hover:text-red-300">✕</button>
          </div>
        )}

        <AnimatePresence mode="wait">

          {/* ── CONNECT TAB ── */}
          {tab === "connect" && (
            <motion.div key="connect" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {status?.connected && (
                <div className="rounded-xl border border-green-500/25 bg-green-500/5 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{status.botName || config.botName}</p>
                        <p className="text-xs text-slate-400">@{status.botUsername}</p>
                      </div>
                    </div>
                    <button onClick={handleDisconnect}
                      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg transition-colors">
                      <LogOut className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-white">{status.messageCount}</p>
                      <p className="text-xs text-slate-400">Pesan dibalas</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-white">{status.uptime ? formatUptime(status.uptime) : "—"}</p>
                      <p className="text-xs text-slate-400">Uptime</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-green-400">ON</p>
                      <p className="text-xs text-slate-400">Auto Reply</p>
                    </div>
                  </div>
                </div>
              )}

              {!status?.connected && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
                  <div className="flex items-center gap-2">
                    <PlugZap className="w-4 h-4 text-blue-400" />
                    <h2 className="text-sm font-semibold text-white">Hubungkan Telegram Bot</h2>
                  </div>

                  {/* How to get token */}
                  <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-blue-400" /> Cara mendapatkan Bot Token:
                    </p>
                    <ol className="space-y-1 text-xs text-slate-400 list-none">
                      <li>1. Buka Telegram, cari <span className="text-blue-400 font-mono">@BotFather</span></li>
                      <li>2. Kirim <span className="font-mono text-white">/newbot</span> → ikuti instruksi</li>
                      <li>3. Copy token yang diberikan (format: <span className="font-mono text-slate-300">123456:ABC-...</span>)</li>
                      <li>4. Paste di bawah → klik Connect</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Settings2 className="w-3 h-3" /> Bot Token dari @BotFather
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder="123456789:ABCDefgh..."
                        type="password"
                        className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                        onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                      />
                      <button onClick={handleConnect} disabled={connecting || !tokenInput.trim()}
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                        {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Connect
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Feature cards */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" /> Fitur DLavie Telegram Bot
                </p>
                <ul className="space-y-1 text-xs text-slate-400 list-disc list-inside">
                  <li>Auto-reply AI tanpa prefix — langsung jawab semua pesan</li>
                  <li>Ketik <span className="font-mono text-slate-300">.report</span> untuk membuat laporan/tiket</li>
                  <li>Ketik <span className="font-mono text-slate-300">.stats</span> untuk statistik bot</li>
                  <li>Notifikasi otomatis ke pelapor saat tiket selesai ditangani</li>
                  <li>Footer <em>"Powered by DLavie OS"</em> di setiap balasan</li>
                </ul>
              </div>
            </motion.div>
          )}

          {/* ── CONFIG TAB ── */}
          {tab === "config" && (
            <motion.div key="config" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-blue-400" />
                    <h2 className="text-sm font-semibold text-white">Konfigurasi Bot</h2>
                  </div>
                  {dirty && (
                    <button onClick={saveConfig} disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Simpan
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Nama Bot</label>
                    <input value={config.botName} onChange={(e) => upd("botName", e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Nama Pemilik</label>
                    <input value={config.ownerName} onChange={(e) => upd("ownerName", e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Owner Telegram ID (untuk notifikasi tiket)</label>
                    <input value={config.ownerId ?? ""} onChange={(e) => upd("ownerId", Number(e.target.value) || undefined)}
                      placeholder="123456789"
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Gaya Bahasa</label>
                    <select value={config.style} onChange={(e) => upd("style", e.target.value as TgConfig["style"])}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors">
                      <option value="santai">Santai & Ramah</option>
                      <option value="formal">Formal & Profesional</option>
                      <option value="custom">Custom Prompt</option>
                    </select>
                  </div>
                </div>

                {config.style === "custom" && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Custom System Prompt</label>
                    <textarea value={config.customPrompt} onChange={(e) => upd("customPrompt", e.target.value)} rows={3}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors resize-none" />
                  </div>
                )}

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <button onClick={() => upd("autoReply", !config.autoReply)}
                      className={cn("w-9 h-5 rounded-full transition-colors", config.autoReply ? "bg-blue-500" : "bg-slate-700")}>
                      <span className={cn("block w-3 h-3 bg-white rounded-full mx-1 transition-transform", config.autoReply ? "translate-x-4" : "translate-x-0")} />
                    </button>
                    <span className="text-xs text-slate-300">Auto Reply</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <button onClick={() => upd("replyInGroup", !config.replyInGroup)}
                      className={cn("w-9 h-5 rounded-full transition-colors", config.replyInGroup ? "bg-blue-500" : "bg-slate-700")}>
                      <span className={cn("block w-3 h-3 bg-white rounded-full mx-1 transition-transform", config.replyInGroup ? "translate-x-4" : "translate-x-0")} />
                    </button>
                    <span className="text-xs text-slate-300">Reply di Grup</span>
                  </label>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── LOGS TAB ── */}
          {tab === "logs" && (
            <motion.div key="logs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{logs.length} pesan terbaru (real-time via SSE)</p>
                <button onClick={loadLogs} className="text-xs text-slate-400 hover:text-slate-300 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Refresh
                </button>
              </div>

              {logs.length === 0 && (
                <div className="text-center text-slate-500 text-sm py-12">
                  <Bot className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p>Belum ada pesan masuk.</p>
                  <p className="text-xs mt-1">Log muncul real-time saat ada yang chat ke bot.</p>
                </div>
              )}

              {logs.map((log, i) => (
                <div key={i} className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-blue-400">{log.name[0]?.toUpperCase()}</span>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-white">{log.name}</span>
                        {log.isGroup && <span className="ml-1.5 text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">Grup</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <Clock className="w-3 h-3" />
                      {timeAgo(log.ts)}
                      <span className="text-slate-600 font-mono">{log.model}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="bg-slate-800/50 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-slate-500 mb-0.5">Pesan</p>
                      <p className="text-xs text-slate-300 break-words">{log.message}</p>
                    </div>
                    <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-blue-400 mb-0.5">Balasan Bot</p>
                      <p className="text-xs text-slate-300 break-words whitespace-pre-wrap">{log.reply}</p>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
