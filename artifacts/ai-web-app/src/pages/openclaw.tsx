/**
 * DLavie OS — Multi-Agent Command Center
 * 8 specialist agents working 24/7 on every DLavie feature.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bot, Zap, Radio, RefreshCw, Square, Play, MessageSquare,
  Loader2, Terminal, Send, Cpu, Wifi, WifiOff, Activity,
  Brain, BookOpen, Shield, BarChart3, Settings, Sparkles,
  Wrench, Mail, ChevronRight, Circle, Clock, AlertCircle,
  CheckCircle2, Inbox, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GatewayStatus {
  running: boolean; pid?: number; port: number; uptime?: number;
  channels: { telegram: boolean; whatsapp: boolean };
  provider: string; version: string; error?: string;
  logs: string[]; agents: string[];
}

interface AgentStatus {
  agentId: string; displayName: string;
  status: "idle" | "working" | "sleeping" | "error";
  currentTask?: string; lastSeen: string; tickCount: number;
  metadata?: Record<string, unknown>;
}

interface WorkerDef {
  id: string; displayName: string; vision: string;
  intervalMs: number; lastRun: number; running: boolean;
}

interface Mail {
  id: number; fromAgent: string; toAgent: string;
  subject: string; body: string; priority: string;
  read: boolean; createdAt: string;
}

interface ChatMsg {
  role: "user" | "agent"; content: string; ts: number; loading?: boolean;
}

// ─── Agent Meta ───────────────────────────────────────────────────────────────

const AGENT_META: Record<string, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  orchestrator: { icon: Cpu,        color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/20" },
  trainer:      { icon: Brain,      color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20"   },
  librarian:    { icon: BookOpen,   color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20"   },
  guardian:     { icon: Shield,     color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20"},
  analyst:      { icon: BarChart3,  color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/20" },
  botmaster:    { icon: Bot,        color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20" },
  curator:      { icon: Sparkles,   color: "text-pink-400",    bg: "bg-pink-500/10",    border: "border-pink-500/20"   },
  engineer:     { icon: Wrench,     color: "text-slate-300",   bg: "bg-slate-500/10",   border: "border-slate-500/20"  },
  dlavie:       { icon: Bot,        color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20" },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  high:     "text-orange-400 bg-orange-500/10 border-orange-500/20",
  normal:   "text-slate-400 bg-white/5 border-white/10",
  low:      "text-slate-500 bg-white/3 border-white/8",
};

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function fmtAgo(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OpenClawPage() {
  const [gateway, setGateway]           = useState<GatewayStatus | null>(null);
  const [workers, setWorkers]           = useState<WorkerDef[]>([]);
  const [agents, setAgents]             = useState<AgentStatus[]>([]);
  const [inbox, setInbox]               = useState<Mail[]>([]);
  const [allMail, setAllMail]           = useState<Mail[]>([]);
  const [gwLogs, setGwLogs]             = useState<string[]>([]);
  const [chat, setChat]                 = useState<ChatMsg[]>([]);
  const [input, setInput]               = useState("");
  const [sending, setSending]           = useState(false);
  const [gwAction, setGwAction]         = useState<string | null>(null);
  const [tab, setTab]                   = useState<"agents"|"chat"|"inbox"|"mail"|"logs">("agents");
  const [nudging, setNudging]           = useState<string | null>(null);
  const [selectedMail, setSelectedMail] = useState<Mail | null>(null);
  const esRef    = useRef<EventSource | null>(null);
  const chatRef  = useRef<HTMLDivElement>(null);
  const logsRef  = useRef<HTMLDivElement>(null);

  // ── Fetch gateway status ──────────────────────────────────────────────────
  const refreshGateway = useCallback(async () => {
    try {
      const r = await fetch("/api/openclaw/status");
      const d = await r.json() as GatewayStatus;
      setGateway(d);
      setGwLogs(d.logs ?? []);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch worker + agent statuses ─────────────────────────────────────────
  const refreshWorkers = useCallback(async () => {
    try {
      const r = await fetch("/api/workers/status");
      const d = await r.json() as { workers: WorkerDef[]; agents: AgentStatus[] };
      setWorkers(d.workers ?? []);
      setAgents(d.agents ?? []);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch mail ────────────────────────────────────────────────────────────
  const refreshMail = useCallback(async () => {
    try {
      const [bossRes, allRes] = await Promise.all([
        fetch("/api/workers/mail"),
        fetch("/api/workers/mail/all?limit=50"),
      ]);
      const bossData = await bossRes.json() as { mail: Mail[] };
      const allData  = await allRes.json() as { mail: Mail[] };
      setInbox(bossData.mail ?? []);
      setAllMail(allData.mail ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshGateway();
    refreshWorkers();
    refreshMail();

    const intervals = [
      setInterval(refreshGateway, 10_000),
      setInterval(refreshWorkers, 8_000),
      setInterval(refreshMail, 15_000),
    ];

    // SSE: gateway events
    const gwEs = new EventSource("/api/openclaw/events");
    gwEs.addEventListener("status", (e) => {
      try { setGateway(JSON.parse(e.data) as GatewayStatus); } catch { /* */ }
    });
    gwEs.addEventListener("log", (e) => {
      try {
        const { line } = JSON.parse(e.data) as { line: string };
        setGwLogs((p) => [...p.slice(-199), line]);
      } catch { /* */ }
    });
    esRef.current = gwEs;

    // SSE: worker events
    const wkEs = new EventSource("/api/workers/events");
    wkEs.addEventListener("worker_tick", () => {
      refreshWorkers();
    });

    return () => {
      intervals.forEach(clearInterval);
      gwEs.close();
      wkEs.close();
    };
  }, [refreshGateway, refreshWorkers, refreshMail]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat]);
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [gwLogs]);

  // ── Gateway actions ───────────────────────────────────────────────────────
  const doGwAction = useCallback(async (action: "start"|"stop"|"restart") => {
    setGwAction(action);
    try {
      await fetch(`/api/openclaw/${action}`, { method: "POST" });
      await refreshGateway();
    } catch { /* */ }
    finally { setGwAction(null); }
  }, [refreshGateway]);

  // ── Nudge worker ──────────────────────────────────────────────────────────
  const nudgeWorker = useCallback(async (id: string) => {
    setNudging(id);
    try {
      await fetch(`/api/workers/${id}/nudge`, { method: "POST" });
      setTimeout(refreshWorkers, 2000);
    } catch { /* */ }
    finally { setTimeout(() => setNudging(null), 1000); }
  }, [refreshWorkers]);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (msg: string) => {
    if (!msg.trim() || sending) return;
    setInput("");
    setSending(true);
    const userMsg: ChatMsg = { role: "user", content: msg, ts: Date.now() };
    const loading: ChatMsg = { role: "agent", content: "", ts: Date.now(), loading: true };
    setChat((p) => [...p, userMsg, loading]);
    try {
      const r = await fetch("/api/openclaw/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const d = await r.json() as { content?: string; error?: string; message?: string };
      const reply = d.content || d.message || d.error || "No response";
      setChat((p) => {
        const c = [...p];
        c[c.length - 1] = { role: "agent", content: reply, ts: Date.now() };
        return c;
      });
    } catch (e) {
      setChat((p) => {
        const c = [...p];
        c[c.length - 1] = { role: "agent", content: `Error: ${String(e)}`, ts: Date.now() };
        return c;
      });
    } finally { setSending(false); }
  }, [sending]);

  // ── Mark mail read ────────────────────────────────────────────────────────
  const markRead = useCallback(async (id: number) => {
    try {
      await fetch(`/api/workers/mail/${id}`, { method: "DELETE" });
      setInbox((p) => p.filter((m) => m.id !== id));
      setAllMail((p) => p.map((m) => m.id === id ? { ...m, read: true } : m));
      if (selectedMail?.id === id) setSelectedMail(null);
    } catch { /* */ }
  }, [selectedMail]);

  const isRunning = gateway?.running ?? false;
  const unreadCount = inbox.filter((m) => !m.read).length;

  // ── Agent status map ──────────────────────────────────────────────────────
  const agentMap = Object.fromEntries(agents.map((a) => [a.agentId, a]));

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-orange-500 flex items-center justify-center shadow-lg">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">DLavie Multi-Agent OS</h1>
                <p className="text-xs text-slate-500 font-mono">8 agents • every feature covered • 24/7 autonomous</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {isRunning ? (
              <>
                <button onClick={() => doGwAction("restart")} disabled={!!gwAction}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors text-xs font-medium disabled:opacity-50">
                  {gwAction === "restart" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Restart
                </button>
                <button onClick={() => doGwAction("stop")} disabled={!!gwAction}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-colors text-xs font-medium disabled:opacity-50">
                  {gwAction === "stop" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                  Stop Gateway
                </button>
              </>
            ) : (
              <button onClick={() => doGwAction("start")} disabled={!!gwAction}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-xs font-semibold disabled:opacity-50">
                {gwAction === "start" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Start Gateway
              </button>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="mt-3 flex items-center gap-5 text-xs">
          <div className="flex items-center gap-2">
            {isRunning
              ? <><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-emerald-400 font-mono">Gateway Online</span></>
              : <><span className="w-2 h-2 rounded-full bg-slate-600" /><span className="text-slate-500 font-mono">Gateway Offline</span></>}
          </div>
          {gateway && <>
            <span className="text-slate-700">|</span>
            <span className="text-slate-400 font-mono">{gateway.provider}</span>
            <span className="text-slate-700">|</span>
            <span className={cn("font-mono", gateway.channels.telegram ? "text-sky-400" : "text-slate-600")}>
              {gateway.channels.telegram ? <Wifi className="w-3 h-3 inline mr-1" /> : <WifiOff className="w-3 h-3 inline mr-1" />}Telegram
            </span>
            {isRunning && gateway.uptime !== undefined &&
              <><span className="text-slate-700">|</span><span className="text-slate-500 font-mono">up {fmtUptime(gateway.uptime)}</span></>}
            {gateway.error &&
              <><span className="text-slate-700">|</span><span className="text-rose-400 truncate max-w-xs">{gateway.error}</span></>}
          </>}
          <div className="ml-auto text-slate-600 font-mono flex items-center gap-1">
            <Radio className="w-3 h-3" /> port {gateway?.port ?? 18789}
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-3 flex items-center gap-1 border-b border-white/5">
        {(["agents", "chat", "inbox", "mail", "logs"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-xs font-medium rounded-t-lg transition-colors capitalize flex items-center gap-1.5",
              tab === t ? "text-white bg-white/5 border border-b-0 border-white/10" : "text-slate-500 hover:text-slate-300"
            )}>
            {t === "agents"  && <Activity className="w-3 h-3" />}
            {t === "chat"    && <MessageSquare className="w-3 h-3" />}
            {t === "inbox"   && <Inbox className="w-3 h-3" />}
            {t === "mail"    && <Mail className="w-3 h-3" />}
            {t === "logs"    && <Terminal className="w-3 h-3" />}
            {t}
            {t === "inbox" && unreadCount > 0 &&
              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center font-bold">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>}
          </button>
        ))}
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">

        {/* ── AGENTS TAB ── */}
        {tab === "agents" && (
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              {workers.map((w) => {
                const meta = AGENT_META[w.id] ?? AGENT_META["dlavie"]!;
                const Icon = meta.icon;
                const dbAgent = agentMap[w.id];
                const status = dbAgent?.status ?? (w.running ? "working" : "sleeping");
                const statusColors = {
                  working:  "text-emerald-400 bg-emerald-500/10",
                  idle:     "text-slate-400 bg-white/5",
                  sleeping: "text-slate-500 bg-white/3",
                  error:    "text-red-400 bg-red-500/10",
                };
                return (
                  <motion.div key={w.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className={cn("p-4 rounded-2xl border bg-white/[0.02] hover:bg-white/[0.04] transition-all", meta.border)}>
                    <div className="flex items-start justify-between mb-3">
                      <div className={cn("w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0", meta.bg, meta.border)}>
                        <Icon className={cn("w-4.5 h-4.5", meta.color)} />
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded-full", statusColors[status] ?? statusColors.idle)}>
                          {status}
                        </span>
                        {w.running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                      </div>
                    </div>

                    <div className="mb-2">
                      <div className="text-sm font-semibold text-white mb-0.5">{w.displayName}</div>
                      <div className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{w.vision}</div>
                    </div>

                    {dbAgent?.currentTask && (
                      <div className="text-[10px] text-slate-400 font-mono bg-white/3 rounded-lg px-2 py-1 mb-2 truncate">
                        {dbAgent.currentTask}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3">
                      <div className="text-[10px] text-slate-600 font-mono">
                        {dbAgent ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {fmtAgo(dbAgent.lastSeen)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-500/70">
                            <AlertCircle className="w-2.5 h-2.5" />
                            not started
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => nudgeWorker(w.id)}
                        disabled={nudging === w.id}
                        className={cn(
                          "text-[10px] px-2 py-1 rounded-lg border transition-colors",
                          meta.border, meta.color, meta.bg,
                          "hover:opacity-80 disabled:opacity-40"
                        )}>
                        {nudging === w.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : "▶ Run now"}
                      </button>
                    </div>

                    <div className="mt-2 text-[9px] text-slate-700 font-mono">
                      every {w.intervalMs >= 60_000 ? `${w.intervalMs / 60_000}m` : `${w.intervalMs / 1000}s`}
                      {dbAgent && ` • ${dbAgent.tickCount} ticks`}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {workers.length === 0 && (
              <div className="text-center py-16 text-slate-600">
                <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Workers loading… (starts 15s after server boot)</p>
              </div>
            )}

            {/* Agent communication log */}
            {allMail.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs text-slate-500 font-mono">Recent inter-agent activity</span>
                </div>
                <div className="space-y-1">
                  {allMail.slice(0, 8).map((m) => {
                    const fromMeta = AGENT_META[m.fromAgent];
                    const toMeta = AGENT_META[m.toAgent];
                    return (
                      <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-xs">
                        <span className={cn("font-mono font-medium", fromMeta?.color ?? "text-slate-400")}>{m.fromAgent}</span>
                        <ChevronRight className="w-3 h-3 text-slate-600" />
                        <span className={cn("font-mono font-medium", toMeta?.color ?? "text-slate-400")}>{m.toAgent}</span>
                        <span className="text-slate-500 truncate flex-1">{m.subject}</span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border", PRIORITY_COLORS[m.priority] ?? PRIORITY_COLORS.normal)}>
                          {m.priority}
                        </span>
                        <span className="text-slate-700 text-[10px] font-mono flex-shrink-0">{fmtAgo(m.createdAt)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CHAT TAB ── */}
        {tab === "chat" && (
          <div className="h-full flex flex-col">
            <div ref={chatRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {chat.length === 0 && (
                <div className="pt-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500/20 to-rose-600/20 border border-orange-500/20 flex items-center justify-center mx-auto mb-3">
                    <Bot className="w-6 h-6 text-orange-400" />
                  </div>
                  <p className="text-sm text-slate-400 mb-1">Chat dengan DLavie Agent</p>
                  <p className="text-xs text-slate-600 font-mono">
                    {isRunning ? "Gateway online — siap menerima perintah" : "Start gateway terlebih dahulu"}
                  </p>
                </div>
              )}
              {chat.map((msg, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "agent" && (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500/30 to-rose-600/30 border border-orange-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                  )}
                  <div className={cn("max-w-lg rounded-2xl px-4 py-2.5 text-sm",
                    msg.role === "user"
                      ? "bg-orange-500/15 border border-orange-500/20 text-white rounded-tr-sm"
                      : "bg-white/5 border border-white/8 text-slate-200 rounded-tl-sm")}>
                    {msg.loading
                      ? <span className="flex gap-1 items-center">
                          {[0, 150, 300].map((d) => (
                            <span key={d} className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                          ))}
                        </span>
                      : <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs text-slate-300">U</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
            <div className="flex-shrink-0 px-6 py-4 border-t border-white/5">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <textarea value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                    placeholder={isRunning ? "Minta agent melakukan sesuatu…" : "Gateway offline — klik Start Gateway"}
                    disabled={!isRunning || sending} rows={2}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-orange-500/40 resize-none disabled:opacity-40" />
                </div>
                <button onClick={() => sendMessage(input)}
                  disabled={!isRunning || sending || !input.trim()}
                  className="flex-shrink-0 w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 hover:bg-orange-500/30 transition-colors disabled:opacity-40">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── INBOX TAB (boss inbox) ── */}
        {tab === "inbox" && (
          <div className="h-full flex overflow-hidden">
            <div className="w-80 flex-shrink-0 border-r border-white/5 overflow-y-auto">
              <div className="px-4 py-3 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Boss Inbox</span>
                  <span className="text-xs text-slate-500">{inbox.length} messages</span>
                </div>
              </div>
              {inbox.length === 0
                ? <div className="p-6 text-center text-slate-600 text-xs">No messages yet</div>
                : inbox.map((m) => {
                    const fromMeta = AGENT_META[m.fromAgent];
                    const Icon = fromMeta?.icon ?? Mail;
                    return (
                      <button key={m.id} onClick={() => setSelectedMail(m)}
                        className={cn("w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors",
                          selectedMail?.id === m.id && "bg-white/5",
                          !m.read && "border-l-2 border-l-violet-500")}>
                        <div className="flex items-start gap-2">
                          <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", fromMeta?.bg ?? "bg-white/5")}>
                            <Icon className={cn("w-3 h-3", fromMeta?.color ?? "text-slate-400")} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn("text-xs font-mono", fromMeta?.color ?? "text-slate-400")}>{m.fromAgent}</span>
                              <span className={cn("text-[9px] px-1 py-0.5 rounded border", PRIORITY_COLORS[m.priority] ?? PRIORITY_COLORS.normal)}>
                                {m.priority}
                              </span>
                            </div>
                            <div className={cn("text-xs mt-0.5 truncate", m.read ? "text-slate-500" : "text-white font-medium")}>{m.subject}</div>
                            <div className="text-[10px] text-slate-600 mt-0.5">{fmtAgo(m.createdAt)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {selectedMail ? (
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-white mb-1">{selectedMail.subject}</h3>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={cn("font-mono", AGENT_META[selectedMail.fromAgent]?.color ?? "text-slate-400")}>
                          from: {selectedMail.fromAgent}
                        </span>
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-400">boss</span>
                        <span className="text-slate-600">{fmtAgo(selectedMail.createdAt)}</span>
                      </div>
                    </div>
                    {!selectedMail.read && (
                      <button onClick={() => markRead(selectedMail.id)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Mark read
                      </button>
                    )}
                  </div>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <pre className="bg-white/3 rounded-xl p-4 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed font-sans border border-white/5">
                      {selectedMail.body}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-600 text-sm">
                  Select a message to read
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MAIL TAB (all inter-agent mail) ── */}
        {tab === "mail" && (
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-slate-500" />
              <span className="text-xs text-slate-500 font-mono">Inter-agent mail log ({allMail.length} messages)</span>
            </div>
            <div className="space-y-1.5">
              {allMail.map((m) => {
                const fromMeta = AGENT_META[m.fromAgent];
                const toMeta = AGENT_META[m.toAgent];
                return (
                  <div key={m.id}
                    className={cn("p-3 rounded-xl border transition-all", m.read ? "bg-white/[0.01] border-white/5" : "bg-white/[0.03] border-white/8")}>
                    <div className="flex items-center gap-3 mb-1">
                      <span className={cn("text-xs font-mono font-semibold", fromMeta?.color ?? "text-slate-400")}>{m.fromAgent}</span>
                      <ChevronRight className="w-3 h-3 text-slate-600" />
                      <span className={cn("text-xs font-mono font-semibold", toMeta?.color ?? "text-slate-400")}>{m.toAgent}</span>
                      <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded-full border", PRIORITY_COLORS[m.priority] ?? PRIORITY_COLORS.normal)}>
                        {m.priority}
                      </span>
                      <span className="text-[10px] text-slate-600 font-mono">{fmtAgo(m.createdAt)}</span>
                    </div>
                    <div className={cn("text-xs font-medium mb-0.5", m.read ? "text-slate-400" : "text-white")}>{m.subject}</div>
                    <div className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">{m.body}</div>
                  </div>
                );
              })}
              {allMail.length === 0 && (
                <div className="text-center py-12 text-slate-600">
                  <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No inter-agent mail yet</p>
                  <p className="text-xs mt-1">Agents will start communicating once workers boot</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LOGS TAB ── */}
        {tab === "logs" && (
          <div className="h-full flex flex-col px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-500" /> Gateway Logs
              </h3>
              <button onClick={() => setGwLogs([])} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
            </div>
            <div ref={logsRef}
              className="flex-1 overflow-y-auto font-mono text-xs bg-black/30 rounded-xl border border-white/5 p-4 space-y-0.5">
              {gwLogs.length === 0
                ? <div className="text-slate-700 text-center py-8">No logs — start gateway to see output</div>
                : gwLogs.map((line, i) => (
                    <div key={i} className={cn("leading-relaxed",
                      line.includes("[err]") || line.includes("error") || line.includes("Error") ? "text-rose-400" :
                      line.includes("warn") || line.includes("WARN") ? "text-amber-400" :
                      line.includes("ready") || line.includes("started") || line.includes("online") ? "text-emerald-400" :
                      "text-slate-400")}>{line}</div>
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
