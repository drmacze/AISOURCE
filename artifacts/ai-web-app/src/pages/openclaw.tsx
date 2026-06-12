/**
 * DLavie OS — OpenClaw Gateway Page
 * Multi-channel AI agent dashboard with live status, chat, and skills.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bot, Zap, Radio, RefreshCw, Square, Play,
  MessageSquare, CheckCircle2, XCircle, Loader2,
  Terminal, ChevronDown, ChevronUp, Send, Cpu,
  Wifi, WifiOff, Database, Network, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenClawStatus {
  running: boolean;
  pid?: number;
  port: number;
  uptime?: number;
  channels: { telegram: boolean; whatsapp: boolean };
  provider: string;
  version: string;
  error?: string;
  logs: string[];
}

interface ChatMsg {
  role: "user" | "agent";
  content: string;
  ts: number;
  loading?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

const SKILLS = [
  { name: "dlavie_system_status",      desc: "Check CPU, RAM, disk & AI provider status",         icon: Activity },
  { name: "dlavie_list_models",        desc: "List installed Ollama models & AI providers",        icon: Database },
  { name: "dlavie_pull_model",         desc: "Download a new Ollama model",                        icon: Network },
  { name: "dlavie_search_knowledge",   desc: "Semantic / keyword search in knowledge base",        icon: MessageSquare },
  { name: "dlavie_list_training_jobs", desc: "List all training jobs with progress",               icon: Cpu },
  { name: "dlavie_start_training",     desc: "Start a new AI model training job",                  icon: Zap },
  { name: "dlavie_list_datasets",      desc: "List training datasets",                             icon: Database },
  { name: "dlavie_create_dataset",     desc: "Create a new training dataset",                      icon: Database },
  { name: "dlavie_add_training_sample",desc: "Add input/output sample to a dataset",               icon: MessageSquare },
  { name: "dlavie_add_document",       desc: "Add document to RAG knowledge base",                 icon: Database },
  { name: "dlavie_chat",               desc: "Sub-task reasoning via DLavie provider chain",       icon: Bot },
  { name: "dlavie_dashboard_stats",    desc: "Get dashboard statistics",                           icon: Activity },
];

const EXAMPLE_PROMPTS = [
  "Berapa jumlah dataset dan training jobs yang ada sekarang?",
  "Download model llama3.2 ke DLavie OS",
  "Cek status sistem DLavie OS",
  "Buat dataset baru bernama 'DLavie Chat' untuk fine-tuning",
  "Cari dokumen tentang RAG di knowledge base",
  "Tampilkan semua model yang tersedia",
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OpenClawPage() {
  const [status, setStatus]       = useState<OpenClawStatus | null>(null);
  const [logs, setLogs]           = useState<string[]>([]);
  const [chat, setChat]           = useState<ChatMsg[]>([]);
  const [input, setInput]         = useState("");
  const [sending, setSending]     = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showLogs, setShowLogs]   = useState(false);
  const [tab, setTab]             = useState<"chat" | "skills" | "logs">("chat");
  const esRef   = useRef<EventSource | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // ── SSE ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/openclaw/events");
    esRef.current = es;

    es.addEventListener("status", (e) => {
      try { setStatus(JSON.parse(e.data) as OpenClawStatus); } catch { /* */ }
    });
    es.addEventListener("log", (e) => {
      try {
        const { line } = JSON.parse(e.data) as { line: string };
        setLogs((prev) => [...prev.slice(-199), line]);
      } catch { /* */ }
    });

    return () => es.close();
  }, []);

  // Auto-fetch status on mount
  useEffect(() => {
    fetch("/api/openclaw/status")
      .then((r) => r.json())
      .then((d) => setStatus(d as OpenClawStatus))
      .catch(() => {/* ignore */});
  }, []);

  // Scroll logs to bottom
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const doAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setActionLoading(action);
    try {
      await fetch(`/api/openclaw/${action}`, { method: "POST" });
      const r = await fetch("/api/openclaw/status");
      setStatus(await r.json() as OpenClawStatus);
    } catch { /* */ }
    finally { setActionLoading(null); }
  }, []);

  const sendMessage = useCallback(async (msg: string) => {
    if (!msg.trim() || sending) return;
    setInput("");
    setSending(true);

    const userMsg: ChatMsg = { role: "user", content: msg, ts: Date.now() };
    const loadingMsg: ChatMsg = { role: "agent", content: "", ts: Date.now(), loading: true };
    setChat((prev) => [...prev, userMsg, loadingMsg]);

    try {
      const r = await fetch("/api/openclaw/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await r.json() as { content?: string; error?: string; message?: string };
      const reply = data.content || data.message || data.error || "No response";
      setChat((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "agent", content: reply, ts: Date.now() };
        return copy;
      });
    } catch (e) {
      setChat((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "agent", content: `Error: ${String(e)}`, ts: Date.now() };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }, [sending]);

  // ── Render ────────────────────────────────────────────────────────────────────
  const isRunning = status?.running ?? false;

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">OpenClaw Agent</h1>
                <p className="text-xs text-slate-500 font-mono">Multi-channel AI digital worker</p>
              </div>
            </div>
            <p className="text-sm text-slate-400 max-w-xl mt-2">
              AI otonom yang bisa bekerja seperti developer — membuat dataset, training model,
              mengelola knowledge base, dan menjalankan semua operasi DLavie OS.
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isRunning ? (
              <>
                <button
                  onClick={() => doAction("restart")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors text-xs font-medium disabled:opacity-50"
                >
                  {actionLoading === "restart" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Restart
                </button>
                <button
                  onClick={() => doAction("stop")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-colors text-xs font-medium disabled:opacity-50"
                >
                  {actionLoading === "stop" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={() => doAction("start")}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-xs font-semibold disabled:opacity-50"
              >
                {actionLoading === "start" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Start Gateway
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-white/5 flex items-center gap-6">
        {/* Running state */}
        <div className="flex items-center gap-2">
          {isRunning
            ? <><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-xs text-emerald-400 font-mono">Online</span></>
            : <><span className="w-2 h-2 rounded-full bg-slate-600" /><span className="text-xs text-slate-500 font-mono">Offline</span></>
          }
        </div>

        {status && (
          <>
            <div className="text-xs text-slate-600">|</div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Cpu className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-mono">{status.provider}</span>
            </div>

            <div className="text-xs text-slate-600">|</div>
            <div className="flex items-center gap-3">
              <div className={cn("flex items-center gap-1.5 text-xs", status.channels.telegram ? "text-sky-400" : "text-slate-600")}>
                {status.channels.telegram ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                <span>Telegram</span>
              </div>
              <div className={cn("flex items-center gap-1.5 text-xs", status.channels.whatsapp ? "text-emerald-400" : "text-slate-600")}>
                {status.channels.whatsapp ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                <span>WhatsApp</span>
              </div>
            </div>

            {isRunning && status.uptime !== undefined && (
              <>
                <div className="text-xs text-slate-600">|</div>
                <span className="text-xs text-slate-500 font-mono">up {formatUptime(status.uptime)}</span>
              </>
            )}

            {status.error && (
              <>
                <div className="text-xs text-slate-600">|</div>
                <span className="text-xs text-rose-400 truncate max-w-xs">{status.error}</span>
              </>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 font-mono">
          <Radio className="w-3 h-3" />
          port {status?.port ?? 18789}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 px-6 pt-3 flex items-center gap-1 border-b border-white/5">
        {(["chat", "skills", "logs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-xs font-medium rounded-t-lg transition-colors capitalize",
              tab === t
                ? "text-white bg-white/5 border border-b-0 border-white/10"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            {t === "chat" && <MessageSquare className="w-3 h-3 inline mr-1.5" />}
            {t === "skills" && <Zap className="w-3 h-3 inline mr-1.5" />}
            {t === "logs" && <Terminal className="w-3 h-3 inline mr-1.5" />}
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {/* ── Chat Tab ── */}
        {tab === "chat" && (
          <div className="h-full flex flex-col">
            <div ref={chatRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {chat.length === 0 && (
                <div className="pt-4">
                  <div className="text-center mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500/20 to-rose-600/20 border border-orange-500/20 flex items-center justify-center mx-auto mb-3">
                      <Bot className="w-6 h-6 text-orange-400" />
                    </div>
                    <p className="text-sm text-slate-400">Tanya agent untuk melakukan pekerjaan di DLavie OS</p>
                    <p className="text-xs text-slate-600 mt-1 font-mono">
                      {isRunning ? "Gateway online — siap menerima perintah" : "Gateway offline — klik Start untuk mengaktifkan"}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
                    {EXAMPLE_PROMPTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => sendMessage(p)}
                        disabled={!isRunning || sending}
                        className="text-left px-3 py-2.5 rounded-xl border border-white/8 bg-white/3 hover:bg-white/6 text-xs text-slate-400 hover:text-slate-200 transition-all disabled:opacity-40"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chat.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
                >
                  {msg.role === "agent" && (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500/30 to-rose-600/30 border border-orange-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-lg rounded-2xl px-4 py-2.5 text-sm",
                      msg.role === "user"
                        ? "bg-orange-500/15 border border-orange-500/20 text-white rounded-tr-sm"
                        : "bg-white/5 border border-white/8 text-slate-200 rounded-tl-sm"
                    )}
                  >
                    {msg.loading
                      ? <span className="flex gap-1 items-center"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "0ms" }} /><span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "300ms" }} /></span>
                      : <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    }
                  </div>
                  {msg.role === "user" && (
                    <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs text-slate-300">U</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Input */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-white/5">
              <div className="flex items-end gap-3">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(input);
                      }
                    }}
                    placeholder={isRunning ? "Minta agent untuk melakukan sesuatu… (Enter kirim, Shift+Enter baris baru)" : "Gateway offline — klik Start untuk mulai"}
                    disabled={!isRunning || sending}
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-orange-500/40 resize-none disabled:opacity-40"
                  />
                </div>
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!isRunning || sending || !input.trim()}
                  className="flex-shrink-0 w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 hover:bg-orange-500/30 transition-colors disabled:opacity-40"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Skills Tab ── */}
        {tab === "skills" && (
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white mb-1">DLavie OS Skills</h3>
              <p className="text-xs text-slate-500">
                Tools yang tersedia untuk agent — semua operasi DLavie OS bisa dijalankan agent secara otonom.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SKILLS.map((skill) => {
                const Icon = skill.icon;
                return (
                  <div
                    key={skill.name}
                    className="flex items-start gap-3 p-3 rounded-xl border border-white/6 bg-white/2 hover:bg-white/4 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/15 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-orange-300 truncate">{skill.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{skill.desc}</div>
                    </div>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  </div>
                );
              })}
            </div>

            <div className="mt-6 p-4 rounded-xl border border-white/8 bg-white/2">
              <h4 className="text-xs font-semibold text-slate-300 mb-2">OpenAI-Compatible Endpoint</h4>
              <p className="text-xs text-slate-500 mb-3">
                DLavie OS menyediakan endpoint OpenAI-compatible yang bisa dipakai OpenClaw dan tools lain.
              </p>
              <div className="font-mono text-xs text-emerald-400 bg-black/30 rounded-lg p-3 space-y-1">
                <div>POST /api/openai/v1/chat/completions</div>
                <div className="text-slate-600">GET  /api/openai/v1/models</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Logs Tab ── */}
        {tab === "logs" && (
          <div className="h-full flex flex-col px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Gateway Logs</h3>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Clear
              </button>
            </div>
            <div
              ref={logsRef}
              className="flex-1 overflow-y-auto font-mono text-xs bg-black/30 rounded-xl border border-white/5 p-4 space-y-0.5"
            >
              {logs.length === 0 ? (
                <div className="text-slate-700 text-center py-8">No logs yet — start the gateway to see output</div>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "leading-relaxed",
                      line.includes("[err]") || line.includes("error") || line.includes("Error")
                        ? "text-rose-400"
                        : line.includes("warn") || line.includes("WARN")
                        ? "text-amber-400"
                        : line.includes("ready") || line.includes("started") || line.includes("online")
                        ? "text-emerald-400"
                        : "text-slate-400"
                    )}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
