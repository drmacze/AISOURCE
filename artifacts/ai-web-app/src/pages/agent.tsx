/**
 * DLavie OS — Autonomous Agent Command Center
 *
 * 8 specialist agents working 24/7 — NO run button needed.
 * Real-time 3D office visualization + live activity feed.
 * Agents think, act, coordinate, and learn autonomously.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Trash2, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Lightbulb, ChevronDown, ChevronRight, Sparkles,
  Zap, RefreshCw,
  Brain, BookOpen, Terminal,
  Send, Activity, Mail, LayoutGrid, TerminalSquare,
  Shield, BarChart2, Wrench, Star, Radio, Inbox,
  Play, Square, PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENT_DEFS = [
  { id: "orchestrator", name: "Orchestrator", emoji: "🎯", icon: Radio,   color: "emerald", role: "Master coordinator", col: 1, row: 0 },
  { id: "trainer",      name: "Trainer",       emoji: "🧠", icon: Brain,   color: "violet",  role: "AI model training",  col: 0, row: 1 },
  { id: "librarian",    name: "Librarian",     emoji: "📚", icon: BookOpen, color: "sky",    role: "Knowledge base",     col: 2, row: 1 },
  { id: "guardian",     name: "Guardian",      emoji: "🛡️", icon: Shield,  color: "amber",   role: "Tickets & quality",  col: 3, row: 1 },
  { id: "analyst",      name: "Analyst",       emoji: "📊", icon: BarChart2,color: "blue",   role: "Data intelligence",  col: 0, row: 2 },
  { id: "botmaster",    name: "Botmaster",     emoji: "🤖", icon: Bot,     color: "teal",    role: "Bot operations",     col: 1, row: 2 },
  { id: "curator",      name: "Curator",       emoji: "✨", icon: Star,    color: "pink",    role: "Prompt curation",    col: 2, row: 2 },
  { id: "engineer",     name: "Engineer",      emoji: "⚙️", icon: Wrench,  color: "orange",  role: "Infrastructure",     col: 3, row: 2 },
] as const;

type AgentId = typeof AGENT_DEFS[number]["id"];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; glow: string; ring: string }> = {
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", glow: "shadow-emerald-500/30", ring: "ring-emerald-500/40" },
  violet:  { bg: "bg-violet-500/10",  border: "border-violet-500/40",  text: "text-violet-400",  glow: "shadow-violet-500/30",  ring: "ring-violet-500/40"  },
  sky:     { bg: "bg-sky-500/10",     border: "border-sky-500/40",     text: "text-sky-400",     glow: "shadow-sky-500/30",     ring: "ring-sky-500/40"     },
  amber:   { bg: "bg-amber-500/10",   border: "border-amber-500/40",   text: "text-amber-400",   glow: "shadow-amber-500/30",   ring: "ring-amber-500/40"   },
  blue:    { bg: "bg-blue-500/10",    border: "border-blue-500/40",    text: "text-blue-400",    glow: "shadow-blue-500/30",    ring: "ring-blue-500/40"    },
  teal:    { bg: "bg-teal-500/10",    border: "border-teal-500/40",    text: "text-teal-400",    glow: "shadow-teal-500/30",    ring: "ring-teal-500/40"    },
  pink:    { bg: "bg-pink-500/10",    border: "border-pink-500/40",    text: "text-pink-400",    glow: "shadow-pink-500/30",    ring: "ring-pink-500/40"    },
  orange:  { bg: "bg-orange-500/10",  border: "border-orange-500/40",  text: "text-orange-400",  glow: "shadow-orange-500/30",  ring: "ring-orange-500/40"  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentStatus {
  agentId: string;
  displayName: string;
  status: "idle" | "working" | "sleeping" | "error";
  currentTask?: string | null;
  lastSeen: string;
  tickCount: number;
  metadata?: Record<string, unknown> | null;
}

interface WorkerInfo {
  id: string;
  name: string;
  intervalMs: number;
  lastTick: number;
  errorCount: number;
}

interface AgentMail {
  id: number;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  priority: string;
  read: boolean;
  createdAt: string;
}

interface AgentMetric {
  id: number;
  agentId: string;
  metricType: string;
  value: string;
  label?: string;
  createdAt: string;
}

interface AgentSession {
  id: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  events: AgentEvent[];
  summary: string;
  totalSteps: number;
  model: string;
  autonomous: boolean;
  memoriesLoaded: number;
  createdAt: string;
  updatedAt: string;
}

interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "done" | "error" | "info" | "memory";
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  ok?: boolean;
  summary?: string;
  steps?: number;
  message?: string;
  step?: number;
  model?: string;
  ts: number;
}

// ─── Mail particle animation ──────────────────────────────────────────────────

interface MailParticle {
  id: number;
  from: AgentId;
  to: AgentId;
  subject: string;
  createdAt: number;
}

// ─── Agent Desk Card ──────────────────────────────────────────────────────────

function AgentDesk({
  def, status, isSelected, onClick,
}: {
  def: typeof AGENT_DEFS[number];
  status?: AgentStatus;
  isSelected: boolean;
  onClick: () => void;
}) {
  const c = COLOR_MAP[def.color];
  const isWorking = status?.status === "working";
  const isError = status?.status === "error";
  const Icon = def.icon;

  const timeAgo = (iso?: string) => {
    if (!iso) return "never";
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  return (
    <motion.button
      onClick={onClick}
      layout
      initial={{ opacity: 0, scale: 0.85, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileHover={{ scale: 1.04, y: -4 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={cn(
        "relative w-full text-left rounded-2xl border p-3 transition-all duration-300 group",
        "backdrop-blur-sm",
        isSelected
          ? `${c.bg} ${c.border} ring-2 ${c.ring} shadow-lg ${c.glow}`
          : "bg-slate-900/60 border-slate-800/70 hover:border-slate-700",
        isWorking && !isSelected && `${c.border} ${c.bg}`,
      )}
    >
      {/* Working pulse ring */}
      {isWorking && (
        <motion.div
          className={cn("absolute inset-0 rounded-2xl border-2", c.border)}
          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.04, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Top row: icon + status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 transition-all",
          isWorking ? `${c.bg} border ${c.border}` : "bg-slate-800/80 border border-slate-700/50",
        )}>
          {def.emoji}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-xs font-semibold text-slate-200 truncate">{def.name}</p>
          <p className="text-[10px] text-slate-600 truncate">{def.role}</p>
        </div>
        <div className="flex-shrink-0">
          {isError ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
              <XCircle className="w-2.5 h-2.5" />ERR
            </span>
          ) : isWorking ? (
            <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border", c.bg, c.border, c.text)}>
              <Loader2 className="w-2.5 h-2.5 animate-spin" />WORK
            </span>
          ) : (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-slate-800 text-slate-500 border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />IDLE
            </span>
          )}
        </div>
      </div>

      {/* Current task */}
      <div className="min-h-[28px]">
        {status?.currentTask ? (
          <p className={cn("text-[10px] leading-snug truncate", isWorking ? c.text : "text-slate-500")}>
            {status.currentTask}
          </p>
        ) : (
          <p className="text-[10px] text-slate-700">Standby…</p>
        )}
      </div>

      {/* Footer: tick + last seen */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60">
        <span className="text-[9px] text-slate-700 font-mono flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          {status?.tickCount ?? 0} ticks
        </span>
        <span className="text-[9px] text-slate-700 font-mono">
          {timeAgo(status?.lastSeen)}
        </span>
      </div>

      {/* Scan line animation when working */}
      {isWorking && (
        <motion.div
          className={cn("absolute inset-x-0 h-[1px] opacity-40", `bg-gradient-to-r from-transparent via-current to-transparent`, c.text)}
          animate={{ top: ["10%", "90%", "10%"] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
          style={{ position: "absolute" }}
        />
      )}
    </motion.button>
  );
}

// ─── Connection line between two agents ──────────────────────────────────────

function MailFlash({ subject }: { subject: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, y: -10 }}
      className="absolute -top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-1 rounded-full bg-slate-900 border border-emerald-500/30 text-emerald-400 text-[9px] whitespace-nowrap shadow-lg shadow-emerald-500/10 max-w-[120px] truncate"
    >
      📨 {subject}
    </motion.div>
  );
}

// ─── Activity log item ────────────────────────────────────────────────────────

function ActivityItem({ mail, isNew }: { mail: AgentMail; isNew: boolean }) {
  const fromDef = AGENT_DEFS.find(a => a.id === mail.fromAgent);
  const toDef   = AGENT_DEFS.find(a => a.id === mail.toAgent);
  const fromColor = fromDef ? COLOR_MAP[fromDef.color] : null;

  const ago = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  };

  return (
    <motion.div
      initial={isNew ? { opacity: 0, x: -16, backgroundColor: "rgba(16,185,129,0.08)" } : false}
      animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.4 }}
      className="flex gap-2.5 items-start py-2 border-b border-slate-800/40 last:border-0"
    >
      <div className={cn(
        "w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center text-xs mt-0.5",
        fromColor ? `${fromColor.bg} border ${fromColor.border}` : "bg-slate-800 border border-slate-700"
      )}>
        {fromDef?.emoji ?? "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("text-[10px] font-semibold", fromColor?.text ?? "text-slate-400")}>
            {fromDef?.name ?? mail.fromAgent}
          </span>
          <span className="text-[10px] text-slate-600">→</span>
          <span className="text-[10px] text-slate-400">{toDef?.name ?? mail.toAgent}</span>
          {mail.priority === "critical" && (
            <span className="px-1 py-0.5 rounded text-[9px] bg-red-500/10 text-red-400 border border-red-500/20 font-mono">CRIT</span>
          )}
          {mail.priority === "high" && (
            <span className="px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">HIGH</span>
          )}
        </div>
        <p className="text-[10px] text-slate-300 mt-0.5 leading-snug line-clamp-1">{mail.subject}</p>
      </div>
      <span className="flex-shrink-0 text-[9px] text-slate-700 font-mono mt-0.5">{ago(mail.createdAt)}</span>
    </motion.div>
  );
}

// ─── Event card (for Dev Agent sessions) ─────────────────────────────────────

function EventCard({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false);
  if (event.type === "thought") return (
    <div className="flex gap-2 items-start">
      <div className="mt-0.5 w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
        <Lightbulb className="w-2.5 h-2.5 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Thought</span>
        <p className="mt-0.5 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{event.content}</p>
      </div>
    </div>
  );
  if (event.type === "tool_call") return (
    <div className="flex gap-2 items-start">
      <div className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
        <Terminal className="w-2.5 h-2.5 text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Tool</span>
          <code className="text-[10px] bg-emerald-500/10 text-emerald-300 px-1 py-0.5 rounded font-mono">{event.tool}()</code>
        </div>
        {event.args && Object.keys(event.args).length > 0 && (
          <button onClick={() => setOpen(o => !o)} className="mt-1 flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400">
            {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />} args
          </button>
        )}
        {open && event.args && (
          <pre className="mt-1 text-[10px] text-slate-400 bg-slate-900 rounded p-2 overflow-x-auto font-mono border border-slate-800 max-h-32 overflow-y-auto">
            {JSON.stringify(event.args, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
  if (event.type === "tool_result") return (
    <div className="flex gap-2 items-start">
      <div className={cn("mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0", event.ok ? "bg-sky-500/20" : "bg-red-500/20")}>
        {event.ok ? <CheckCircle2 className="w-2.5 h-2.5 text-sky-400" /> : <XCircle className="w-2.5 h-2.5 text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", event.ok ? "text-sky-400" : "text-red-400")}>
            {event.ok ? "Result" : "Error"}
          </span>
          <code className="text-[10px] bg-slate-800 text-slate-500 px-1 py-0.5 rounded font-mono">{event.tool}</code>
        </div>
        <button onClick={() => setOpen(o => !o)} className="mt-0.5 text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-1">
          {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
          {event.ok ? "view data" : "view error"}
        </button>
        {open && (
          <pre className={cn("mt-1 text-[10px] rounded p-2 overflow-x-auto font-mono border max-h-32 overflow-y-auto", event.ok ? "text-slate-300 bg-sky-950/30 border-sky-900/40" : "text-red-300 bg-red-950/30 border-red-900/40")}>
            {typeof event.data === "string" ? event.data : JSON.stringify(event.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
  if (event.type === "memory") return (
    <div className="flex gap-2 items-start">
      <div className="mt-0.5 w-4 h-4 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
        <Brain className="w-2.5 h-2.5 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider">Memory</span>
        <p className="mt-0.5 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap line-clamp-3">{event.content}</p>
      </div>
    </div>
  );
  if (event.type === "done") return (
    <div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-3">
      <div className="flex items-center gap-2 mb-1">
        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-xs font-semibold text-sky-400">Task Complete</span>
        {event.steps && <span className="text-[10px] text-slate-500 ml-auto">{event.steps} steps</span>}
      </div>
      {event.summary && <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{event.summary}</p>}
    </div>
  );
  if (event.type === "error") return (
    <div className="flex gap-2 items-start">
      <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-red-300">{event.message}</p>
    </div>
  );
  return null;
}

// ─── Floating neural particles (background) ───────────────────────────────────

function NeuralParticles() {
  const particles = useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      dur: Math.random() * 8 + 6,
      delay: Math.random() * 4,
    })), []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-emerald-400/20"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
          animate={{
            y: [0, -30, 0],
            opacity: [0, 0.6, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* Grid lines */}
      <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#10b981" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>
  );
}

// ─── Header status bar ────────────────────────────────────────────────────────

function SystemStatus({ agents, workers }: { agents: AgentStatus[]; workers: WorkerInfo[] }) {
  const working = agents.filter(a => a.status === "working").length;
  const errors  = agents.filter(a => a.status === "error").length;
  const total   = AGENT_DEFS.length;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <motion.div
          className="w-2 h-2 rounded-full bg-emerald-400"
          animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <span className="text-[11px] text-emerald-400 font-semibold font-mono">SYSTEM ONLINE</span>
      </div>
      <div className="h-3 w-px bg-slate-700" />
      <span className="text-[11px] text-slate-500 font-mono">
        <span className="text-emerald-400">{working}</span>/{total} active
      </span>
      {errors > 0 && (
        <>
          <div className="h-3 w-px bg-slate-700" />
          <span className="text-[11px] text-red-400 font-mono">{errors} error{errors > 1 ? "s" : ""}</span>
        </>
      )}
      <div className="h-3 w-px bg-slate-700" />
      <span className="text-[11px] text-slate-600 font-mono">24/7 autonomous</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "command" | "activity" | "devagent";

export default function AgentPage() {
  const [tab, setTab] = useState<Tab>("command");
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);

  // Worker data
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [mail, setMail] = useState<AgentMail[]>([]);
  const [metrics, setMetrics] = useState<AgentMetric[]>([]);
  const [prevMailIds, setPrevMailIds] = useState<Set<number>>(new Set());
  const [newMailIds, setNewMailIds] = useState<Set<number>>(new Set());
  const [particles, setParticles] = useState<MailParticle[]>([]);
  const particleIdRef = useRef(0);

  // Dev Agent state
  const [devTask, setDevTask] = useState("");
  const [sessions, setSessions] = useState<Array<{ id: string; task: string; status: string; totalSteps: number; createdAt: string }>>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem("agent_active_session_id"); } catch { return null; }
  });
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dispatchRef = useRef<HTMLTextAreaElement>(null);

  // Nudge (dispatch) state
  const [nudgeAgent, setNudgeAgent] = useState<AgentId | null>(null);
  const [nudgeTask, setNudgeTask] = useState("");
  const [nudging, setNudging] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchWorkerStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/workers/status");
      if (!res.ok) return;
      const data = await res.json() as { workers: WorkerInfo[]; agents: AgentStatus[] };
      setWorkers(data.workers ?? []);
      setAgents(data.agents ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchMail = useCallback(async () => {
    try {
      const res = await fetch("/api/workers/mail/all?limit=80");
      if (!res.ok) return;
      const data = await res.json() as { mail: AgentMail[] };
      const incoming = data.mail ?? [];

      // Detect new mail for highlights + particles
      const incomingIds = new Set(incoming.map(m => m.id));
      const newIds = new Set<number>();
      incoming.forEach(m => {
        if (!prevMailIds.has(m.id)) newIds.add(m.id);
      });

      if (newIds.size > 0) {
        setNewMailIds(newIds);
        // Spawn particles for first 3 new mails
        const newMails = incoming.filter(m => newIds.has(m.id)).slice(0, 3);
        const newParticles: MailParticle[] = newMails
          .filter(m => AGENT_DEFS.some(a => a.id === m.fromAgent) && AGENT_DEFS.some(a => a.id === m.toAgent))
          .map(m => ({
            id: ++particleIdRef.current,
            from: m.fromAgent as AgentId,
            to: m.toAgent as AgentId,
            subject: m.subject,
            createdAt: Date.now(),
          }));
        if (newParticles.length > 0) {
          setParticles(prev => [...prev, ...newParticles]);
          setTimeout(() => setParticles(prev => prev.filter(p => !newParticles.some(np => np.id === p.id))), 3000);
        }
        setTimeout(() => setNewMailIds(new Set()), 3000);
      }

      setPrevMailIds(incomingIds);
      setMail(incoming);
    } catch { /* ignore */ }
  }, [prevMailIds]);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/workers/metrics?limit=50");
      if (!res.ok) return;
      const data = await res.json() as { metrics: AgentMetric[] };
      setMetrics(data.metrics ?? []);
    } catch { /* ignore */ }
  }, []);

  // Dev agent
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/sessions");
      if (res.ok) setSessions(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchActiveSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agent/sessions/${id}`);
      if (res.ok) {
        const data: AgentSession = await res.json();
        setActiveSession(data);
        return data;
      } else if (res.status === 404) {
        setActiveId(null);
        setActiveSession(null);
        localStorage.removeItem("agent_active_session_id");
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  // ── Auto-refresh ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetchWorkerStatus();
    fetchMail();
    fetchMetrics();
    fetchSessions();
    if (activeId) fetchActiveSession(activeId);

    const workerInterval = setInterval(() => { fetchWorkerStatus(); fetchMail(); }, 3000);
    const metricsInterval = setInterval(fetchMetrics, 10000);
    const sessionsInterval = setInterval(fetchSessions, 8000);

    return () => {
      clearInterval(workerInterval);
      clearInterval(metricsInterval);
      clearInterval(sessionsInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll active dev session
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!activeId) return;
    const poll = async () => {
      const data = await fetchActiveSession(activeId);
      await fetchSessions();
      if (data && data.status !== "running") clearInterval(pollRef.current!);
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeId, fetchActiveSession, fetchSessions]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeSession?.events.length]);

  // ── Nudge an agent ────────────────────────────────────────────────────────

  const nudge = useCallback(async (agentId: AgentId, task?: string) => {
    setNudging(true);
    try {
      await fetch(`/api/workers/${agentId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task || undefined }),
      });
      setTimeout(() => { fetchWorkerStatus(); fetchMail(); }, 1000);
    } catch { /* ignore */ }
    setNudging(false);
    setNudgeAgent(null);
    setNudgeTask("");
  }, [fetchWorkerStatus, fetchMail]);

  // ── Dev Agent run ─────────────────────────────────────────────────────────

  const runDevAgent = useCallback(async () => {
    if (!devTask.trim() || isStarting) return;
    setIsStarting(true);
    try {
      const res = await fetch("/api/agent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: devTask.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string };
      setActiveId(data.id);
      localStorage.setItem("agent_active_session_id", data.id);
      setActiveSession(null);
      setDevTask("");
      fetchSessions();
    } catch (e) { console.error(e); }
    setIsStarting(false);
  }, [devTask, isStarting, fetchSessions]);

  const stopDevAgent = useCallback(async () => {
    if (!activeId) return;
    await fetch(`/api/agent/sessions/${activeId}/stop`, { method: "POST" });
    await fetchActiveSession(activeId);
    fetchSessions();
  }, [activeId, fetchActiveSession, fetchSessions]);

  const deleteSession = useCallback(async (id: string) => {
    await fetch(`/api/agent/sessions/${id}`, { method: "DELETE" });
    if (id === activeId) { setActiveId(null); setActiveSession(null); localStorage.removeItem("agent_active_session_id"); }
    fetchSessions();
  }, [activeId, fetchSessions]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const agentMap = useMemo(() => {
    const m: Record<string, AgentStatus> = {};
    agents.forEach(a => { m[a.agentId] = a; });
    return m;
  }, [agents]);

  const selectedStatus = selectedAgent ? agentMap[selectedAgent] : null;
  const selectedDef = selectedAgent ? AGENT_DEFS.find(a => a.id === selectedAgent) : null;
  const selectedMail = useMemo(() =>
    mail.filter(m => m.fromAgent === selectedAgent || m.toAgent === selectedAgent).slice(0, 20),
    [mail, selectedAgent]
  );

  const bossInbox = useMemo(() => mail.filter(m => m.toAgent === "boss").slice(0, 25), [mail]);
  const allActivity = useMemo(() => [...mail].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 60), [mail]);

  const isDevRunning = activeSession?.status === "running";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-slate-950 overflow-hidden">

      {/* ── Background ──────────────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none">
        <NeuralParticles />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/10 via-transparent to-slate-950/80" />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="relative flex-shrink-0 border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Animated logo */}
            <div className="relative w-9 h-9 flex-shrink-0">
              <motion.div
                className="absolute inset-0 rounded-xl bg-emerald-500/20 border border-emerald-500/40"
                animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              />
              <div className="absolute inset-0 rounded-xl flex items-center justify-center">
                <Bot className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-100 font-[Syne]">Agent Command Center</h1>
              <div className="hidden sm:block mt-0.5">
                <SystemStatus agents={agents} workers={workers} />
              </div>
            </div>
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <motion.div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20"
              animate={{ borderColor: ["rgba(16,185,129,0.2)", "rgba(16,185,129,0.5)", "rgba(16,185,129,0.2)"] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Radio className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-mono font-semibold hidden sm:inline">LIVE</span>
            </motion.div>
          </div>
        </div>

        {/* Mobile status */}
        <div className="sm:hidden mt-2">
          <SystemStatus agents={agents} workers={workers} />
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="relative flex-shrink-0 flex border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-sm px-2 overflow-x-auto scrollbar-none">
        {[
          { id: "command" as Tab,  label: "Office",   icon: LayoutGrid, badge: null },
          { id: "activity" as Tab, label: "Activity", icon: Activity,   badge: mail.length > 0 ? String(bossInbox.length) : null },
          { id: "devagent" as Tab, label: "Dev Agent", icon: TerminalSquare, badge: isDevRunning ? "●" : null },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap flex-shrink-0",
              tab === t.id
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.badge && (
              <span className={cn(
                "px-1 py-0.5 rounded text-[9px] font-mono",
                t.badge === "●"
                  ? "text-emerald-400 animate-pulse"
                  : "bg-slate-700 text-slate-400"
              )}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Command Center (Office) ─────────────────────────────────── */}
      {tab === "command" && (
        <div className="relative flex-1 overflow-y-auto">
          <div className="p-3 sm:p-4 space-y-4">

            {/* 3D Office Scene */}
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-emerald-400" /> Live Office
                </h2>
                <button
                  onClick={() => { fetchWorkerStatus(); fetchMail(); }}
                  className="p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-400 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>

              {/* 3D perspective container */}
              <div
                className="relative rounded-2xl overflow-hidden border border-slate-800/60 bg-slate-900/40"
                style={{ perspective: "900px" }}
              >
                <motion.div
                  initial={{ rotateX: 8, opacity: 0 }}
                  animate={{ rotateX: 0, opacity: 1 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  {/* Orchestrator at top (row 0) */}
                  <div className="px-3 pt-4 pb-2">
                    <div className="flex justify-center">
                      <div className="w-full max-w-[200px] sm:max-w-[240px] relative">
                        {/* Particle flash above orchestrator */}
                        <AnimatePresence>
                          {particles.map(p => p.from === "orchestrator" && (
                            <MailFlash key={p.id} subject={p.subject} />
                          ))}
                        </AnimatePresence>
                        <AgentDesk
                          def={AGENT_DEFS[0]}
                          status={agentMap["orchestrator"]}
                          isSelected={selectedAgent === "orchestrator"}
                          onClick={() => setSelectedAgent(a => a === "orchestrator" ? null : "orchestrator")}
                        />
                      </div>
                    </div>
                    {/* Connector line down */}
                    <div className="flex justify-center mt-2">
                      <motion.div
                        className="w-px h-4 bg-gradient-to-b from-emerald-500/40 to-transparent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    </div>
                  </div>

                  {/* Row 1: trainer, librarian, guardian */}
                  <div className="px-3 pb-2">
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {AGENT_DEFS.filter(a => a.row === 1).map(def => (
                        <div key={def.id} className="relative">
                          <AnimatePresence>
                            {particles.map(p => (p.from === def.id || p.to === def.id) && (
                              <MailFlash key={p.id} subject={p.subject} />
                            ))}
                          </AnimatePresence>
                          <AgentDesk
                            def={def}
                            status={agentMap[def.id]}
                            isSelected={selectedAgent === def.id}
                            onClick={() => setSelectedAgent(a => a === def.id ? null : def.id as AgentId)}
                          />
                        </div>
                      ))}
                    </div>
                    {/* Connector line down */}
                    <div className="flex justify-center mt-2">
                      <motion.div
                        className="w-px h-4 bg-gradient-to-b from-slate-700 to-transparent"
                        animate={{ opacity: [0.2, 0.6, 0.2] }}
                        transition={{ duration: 2.5, repeat: Infinity }}
                      />
                    </div>
                  </div>

                  {/* Row 2: analyst, botmaster, curator, engineer */}
                  <div className="px-3 pb-4">
                    <div className="grid grid-cols-4 gap-2 sm:gap-3">
                      {AGENT_DEFS.filter(a => a.row === 2).map(def => (
                        <div key={def.id} className="relative">
                          <AnimatePresence>
                            {particles.map(p => (p.from === def.id || p.to === def.id) && (
                              <MailFlash key={p.id} subject={p.subject} />
                            ))}
                          </AnimatePresence>
                          <AgentDesk
                            def={def}
                            status={agentMap[def.id]}
                            isSelected={selectedAgent === def.id}
                            onClick={() => setSelectedAgent(a => a === def.id ? null : def.id as AgentId)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* Ambient glow overlay */}
                <div className="absolute inset-0 pointer-events-none rounded-2xl bg-gradient-to-t from-slate-950/60 via-transparent to-emerald-950/10" />
              </div>
            </div>

            {/* Selected agent panel */}
            <AnimatePresence>
              {selectedAgent && selectedDef && (
                <motion.div
                  key={selectedAgent}
                  initial={{ opacity: 0, height: 0, y: -10 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -10 }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                  className="overflow-hidden"
                >
                  {(() => {
                    const c = COLOR_MAP[selectedDef.color];
                    return (
                      <div className={cn("rounded-2xl border p-4 space-y-3", c.bg, c.border)}>
                        {/* Header */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="text-2xl">{selectedDef.emoji}</div>
                            <div>
                              <h3 className={cn("text-sm font-bold font-[Syne]", c.text)}>{selectedDef.name}</h3>
                              <p className="text-xs text-slate-500">{selectedDef.role}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Nudge button */}
                            <button
                              onClick={() => setNudgeAgent(nudgeAgent === selectedAgent ? null : selectedAgent)}
                              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all", c.bg, c.border, c.text, "hover:opacity-80")}
                            >
                              <Send className="w-3 h-3" />
                              <span className="hidden sm:inline">Dispatch</span>
                            </button>
                            <button
                              onClick={() => setSelectedAgent(null)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Dispatch input */}
                        <AnimatePresence>
                          {nudgeAgent === selectedAgent && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="flex gap-2 pt-1">
                                <input
                                  ref={dispatchRef as React.RefObject<HTMLInputElement>}
                                  value={nudgeTask}
                                  onChange={e => setNudgeTask(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") nudge(selectedAgent, nudgeTask || undefined); }}
                                  placeholder={`Give a task to ${selectedDef.name}… (or leave blank to trigger now)`}
                                  className="flex-1 bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
                                  autoFocus
                                />
                                <button
                                  onClick={() => nudge(selectedAgent, nudgeTask || undefined)}
                                  disabled={nudging}
                                  className={cn("px-3 py-2 rounded-xl border text-xs font-medium transition-all flex-shrink-0", c.bg, c.border, c.text, "hover:opacity-80 disabled:opacity-50")}
                                >
                                  {nudging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Current task */}
                        {selectedStatus?.currentTask && (
                          <div className="flex items-center gap-2 bg-slate-900/60 rounded-xl px-3 py-2">
                            <Loader2 className={cn("w-3 h-3 animate-spin flex-shrink-0", c.text)} />
                            <p className="text-xs text-slate-300 font-mono">{selectedStatus.currentTask}</p>
                          </div>
                        )}

                        {/* Agent mail */}
                        {selectedMail.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5" /> Recent messages
                            </p>
                            <div className="space-y-0 max-h-40 overflow-y-auto">
                              {selectedMail.map(m => (
                                <ActivityItem key={m.id} mail={m} isNew={newMailIds.has(m.id)} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Metrics strip */}
            {metrics.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest flex items-center gap-1">
                  <BarChart2 className="w-3 h-3" /> Recent metrics
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {metrics.slice(0, 6).map(m => {
                    const def = AGENT_DEFS.find(a => a.id === m.agentId);
                    const c = def ? COLOR_MAP[def.color] : null;
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={cn("rounded-xl border p-2.5", c?.bg ?? "bg-slate-900/60", c?.border ?? "border-slate-800")}
                      >
                        <p className={cn("text-[10px] font-semibold truncate", c?.text ?? "text-slate-400")}>{def?.emoji} {def?.name}</p>
                        <p className="text-[10px] text-slate-500 truncate font-mono mt-0.5">{m.metricType.replace(/_/g, " ")}</p>
                        <p className="text-sm font-bold text-slate-200 mt-1 truncate">{m.label ?? m.value}</p>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Activity ─────────────────────────────────────────────────── */}
      {tab === "activity" && (
        <div className="relative flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between border-b border-slate-800/60">
            <p className="text-xs text-slate-500 font-mono">{allActivity.length} messages</p>
            <div className="flex items-center gap-2">
              <button onClick={() => { fetchMail(); fetchWorkerStatus(); }} className="p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-400">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden min-h-0 divide-x divide-slate-800/60">
            {/* All activity */}
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-3 flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" /> Inter-Agent Communication
              </p>
              {allActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Activity className="w-8 h-8 text-slate-700 mb-3" />
                  <p className="text-xs text-slate-600">No activity yet — agents are starting up</p>
                </div>
              ) : (
                <div className="space-y-0">
                  <AnimatePresence mode="popLayout">
                    {allActivity.map(m => (
                      <ActivityItem key={m.id} mail={m} isNew={newMailIds.has(m.id)} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Boss inbox (desktop sidebar) */}
            <div className="hidden sm:flex w-64 flex-col">
              <div className="px-3 py-2 border-b border-slate-800/60 flex-shrink-0">
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest flex items-center gap-1">
                  <Inbox className="w-2.5 h-2.5" /> Boss Inbox
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-0">
                {bossInbox.length === 0 ? (
                  <p className="text-[10px] text-slate-700 text-center py-8">No messages</p>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {bossInbox.map(m => (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        className={cn(
                          "py-2 border-b border-slate-800/40 last:border-0",
                          m.priority === "critical" && "bg-red-950/20 -mx-3 px-3",
                          m.priority === "high" && "bg-amber-950/10 -mx-3 px-3",
                        )}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] text-emerald-400 font-semibold">
                            {AGENT_DEFS.find(a => a.id === m.fromAgent)?.emoji} {AGENT_DEFS.find(a => a.id === m.fromAgent)?.name ?? m.fromAgent}
                          </span>
                          {m.priority === "critical" && <span className="px-1 py-0.5 rounded text-[8px] bg-red-500/20 text-red-400 border border-red-500/20">CRIT</span>}
                          {m.priority === "high" && <span className="px-1 py-0.5 rounded text-[8px] bg-amber-500/20 text-amber-400 border border-amber-500/20">HIGH</span>}
                        </div>
                        <p className="text-[10px] text-slate-300 leading-snug font-medium line-clamp-1">{m.subject}</p>
                        <p className="text-[10px] text-slate-600 leading-snug line-clamp-2 mt-0.5">{m.body}</p>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Dev Agent ────────────────────────────────────────────────── */}
      {tab === "devagent" && (
        <div className="relative flex-1 flex flex-col overflow-hidden min-h-0">

          {/* Info bar */}
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-slate-800/60 bg-slate-900/40 flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Brain className="w-3 h-3 text-violet-400" />
              <span className="text-[10px] text-violet-400 font-mono font-semibold">Qwen2.5-Coder-32B</span>
            </div>
            <span className="text-[10px] text-slate-600">·</span>
            <span className="text-[10px] text-slate-500 font-mono">34 tools · ReAct loop · persistent memory</span>
            {isDevRunning && (
              <motion.span
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="ml-auto text-[10px] text-emerald-400 font-mono flex items-center gap-1"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                running in background
              </motion.span>
            )}
          </div>

          {/* Session list + events */}
          <div className="flex flex-1 overflow-hidden min-h-0">

            {/* Session sidebar */}
            <div className="hidden md:flex w-52 flex-col border-r border-slate-800/60 bg-slate-900/20 flex-shrink-0">
              <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between">
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Sessions</p>
                <button onClick={fetchSessions} className="p-0.5 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-400">
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {sessions.length === 0 ? (
                  <p className="text-[10px] text-slate-700 px-2 py-6 text-center">No sessions yet</p>
                ) : (
                  sessions.map(s => (
                    <div
                      key={s.id}
                      onClick={() => { setActiveId(s.id); fetchActiveSession(s.id); }}
                      className={cn(
                        "group relative flex flex-col gap-1 px-2.5 py-2 rounded-xl cursor-pointer border transition-all",
                        activeId === s.id
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : "bg-slate-900/40 border-slate-800/60 hover:bg-slate-800/40 hover:border-slate-700"
                      )}
                    >
                      <p className="text-[10px] text-slate-300 line-clamp-2 leading-snug pr-4">{s.task}</p>
                      <div className="flex items-center gap-1">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded-full text-[9px] font-medium border",
                          s.status === "running" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          s.status === "done" ? "bg-sky-500/10 text-sky-400 border-sky-500/20" :
                          "bg-red-500/10 text-red-400 border-red-500/20"
                        )}>
                          {s.status}
                        </span>
                        <span className="text-[9px] text-slate-700 ml-auto">{s.totalSteps}s</span>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                        className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 text-slate-600"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Events area */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
                {!activeSession && !isStarting && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12 px-4">
                    <motion.div
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 3, repeat: Infinity }}
                      className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-emerald-500/10 border border-violet-500/20 flex items-center justify-center mb-4"
                    >
                      <TerminalSquare className="w-6 h-6 text-violet-400" />
                    </motion.div>
                    <h2 className="text-sm font-bold text-slate-300 font-[Syne]">Dev Agent</h2>
                    <p className="mt-2 text-xs text-slate-500 max-w-xs leading-relaxed">
                      Full ReAct agent with 34 tools — can write code, execute scripts, search papers, manage training, and learn from memory.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                      {["Run Python code", "Search HuggingFace", "Start training job", "Build RAG pipeline"].map(h => (
                        <button
                          key={h}
                          onClick={() => setDevTask(h)}
                          className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all"
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isStarting && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    Starting dev agent session…
                  </div>
                )}

                {activeSession && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                        activeSession.status === "running" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        activeSession.status === "done" ? "bg-sky-500/10 text-sky-400 border-sky-500/20" :
                        "bg-red-500/10 text-red-400 border-red-500/20"
                      )}>
                        {activeSession.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {activeSession.status}
                      </span>
                      <span className="text-xs text-slate-500 flex-1 truncate">{activeSession.task}</span>
                    </div>
                    <AnimatePresence mode="popLayout">
                      {activeSession.events.filter(e => e.type !== "done").map((ev, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25 }}
                        >
                          <EventCard event={ev} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {activeSession.events.filter(e => e.type === "done").map((ev, i) => (
                      <EventCard key={`done-${i}`} event={ev} />
                    ))}
                    {activeSession.status === "running" && (
                      <motion.div
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        className="flex items-center gap-2 text-xs text-emerald-400/70 py-2"
                      >
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Agent thinking…
                      </motion.div>
                    )}
                  </>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="flex-shrink-0 border-t border-slate-800/60 bg-slate-900/50 p-3">
                <textarea
                  value={devTask}
                  onChange={e => setDevTask(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runDevAgent(); }}
                  disabled={isDevRunning || isStarting}
                  placeholder="Describe a task for the Dev Agent… (Ctrl+Enter to run)"
                  rows={2}
                  className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 disabled:opacity-50 transition-all leading-relaxed"
                />
                <div className="flex gap-2 mt-2">
                  {isDevRunning ? (
                    <button onClick={stopDevAgent} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium">
                      <Square className="w-3.5 h-3.5" /> Stop
                    </button>
                  ) : (
                    <button onClick={runDevAgent} disabled={!devTask.trim() || isStarting} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium">
                      {isStarting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</> : <><Play className="w-3.5 h-3.5" /> Run Task</>}
                    </button>
                  )}
                  <button
                    onClick={() => { setActiveId(null); setActiveSession(null); localStorage.removeItem("agent_active_session_id"); }}
                    className="px-3 py-2 rounded-xl border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors text-xs"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
