/**
 * DLavie OS — Agent Command Center
 * 3D isometric office — 8 autonomous AI agents working 24/7.
 * Real-time SSE updates, animated characters, inter-agent mail particles.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Brain, BookOpen, Shield, BarChart2, Wrench, Star, Radio,
  Mail, Activity, TerminalSquare, Zap, RefreshCw, Send,
  Play, Square, PlusCircle, AlertTriangle, CheckCircle2,
  XCircle, Loader2, Inbox, Sparkles, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Agent definitions with positions ────────────────────────────────────────

const AGENT_DEFS = [
  { id: "orchestrator", name: "Orchestrator", emoji: "🎯", colorHex: "#10b981", deskHex: "#064e3b", role: "Master coordinator"  },
  { id: "trainer",      name: "Trainer",      emoji: "🧠", colorHex: "#8b5cf6", deskHex: "#3b0764", role: "AI model training"   },
  { id: "librarian",    name: "Librarian",    emoji: "📚", colorHex: "#0ea5e9", deskHex: "#0c4a6e", role: "Knowledge base"      },
  { id: "guardian",     name: "Guardian",     emoji: "🛡️", colorHex: "#f59e0b", deskHex: "#78350f", role: "Tickets & quality"   },
  { id: "analyst",      name: "Analyst",      emoji: "📊", colorHex: "#3b82f6", deskHex: "#1e3a8a", role: "Data intelligence"   },
  { id: "botmaster",    name: "Botmaster",    emoji: "🤖", colorHex: "#14b8a6", deskHex: "#134e4a", role: "Bot operations"      },
  { id: "curator",      name: "Curator",      emoji: "✨", colorHex: "#ec4899", deskHex: "#831843", role: "Prompt curation"     },
  { id: "engineer",     name: "Engineer",     emoji: "⚙️", colorHex: "#f97316", deskHex: "#7c2d12", role: "Infrastructure"      },
] as const;

type AgentId = typeof AGENT_DEFS[number]["id"];

// Desk top-face CENTER positions in the SVG (viewBox 0 0 700 420)
// Arranged in isometric perspective: orchestrator top-center, rows below
const DESK_POS: Record<string, [number, number]> = {
  orchestrator: [350, 138],
  trainer:      [174, 220],
  librarian:    [293, 248],
  guardian:     [448, 208],
  analyst:      [142, 308],
  botmaster:    [258, 326],
  curator:      [368, 322],
  engineer:     [488, 292],
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentStatus {
  agentId: string;
  displayName: string;
  status: "working" | "idle" | "error" | "offline";
  currentTask?: string | null;
  lastSeen: string;
  tickCount: number;
}

interface MailItem {
  id: number;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  priority: string;
  createdAt: string;
  read: boolean;
}

interface WorkerInfo {
  id: string;
  displayName: string;
  vision: string;
  intervalMs: number;
  lastRun: number;
  running: boolean;
}

// ─── SVG: Isometric floor tiles ───────────────────────────────────────────────

function OfficeFloor() {
  const HW = 36, HH = 18;
  const OX = 348, OY = 20;
  const tiles: React.ReactNode[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 11; c++) {
      const cx = OX + (c - r) * HW;
      const cy = OY + (c + r) * HH;
      if (cx < -40 || cx > 740 || cy < 0 || cy > 430) continue;
      const alt = (c + r) % 2 === 0;
      const pts = `${cx},${cy - HH} ${cx + HW},${cy} ${cx},${cy + HH} ${cx - HW},${cy}`;
      tiles.push(
        <polygon key={`${c}-${r}`} points={pts}
          fill={alt ? "#0f172a" : "#0a1020"}
          stroke="#06090f" strokeWidth={0.4} />,
      );
    }
  }
  return <g>{tiles}</g>;
}

// ─── SVG: Isometric desk ──────────────────────────────────────────────────────

const DESK_HW = 36, DESK_HH = 13, DESK_D = 11;

function IsoDesk({ cx, cy, colorHex, deskHex, isWorking }: {
  cx: number; cy: number; colorHex: string; deskHex: string; isWorking: boolean;
}) {
  const top   = `${cx},${cy - DESK_HH} ${cx + DESK_HW},${cy} ${cx},${cy + DESK_HH} ${cx - DESK_HW},${cy}`;
  const left  = `${cx - DESK_HW},${cy} ${cx},${cy + DESK_HH} ${cx},${cy + DESK_HH + DESK_D} ${cx - DESK_HW},${cy + DESK_D}`;
  const right = `${cx + DESK_HW},${cy} ${cx},${cy + DESK_HH} ${cx},${cy + DESK_HH + DESK_D} ${cx + DESK_HW},${cy + DESK_D}`;

  return (
    <g>
      {isWorking && (
        <ellipse cx={cx} cy={cy + DESK_HH + DESK_D * 0.5} rx={DESK_HW + 10} ry={DESK_D}
          fill={colorHex} opacity={0.07} />
      )}
      <polygon points={right} fill="#09111d" />
      <polygon points={left}  fill="#0d1929" />
      <polygon points={top}   fill={isWorking ? deskHex : "#1a2738"} stroke="#253447" strokeWidth={0.8} />
      {/* Monitor dot on desk */}
      <circle cx={cx + 14} cy={cy - 6} r={3}
        fill={isWorking ? colorHex : "#1e293b"} opacity={isWorking ? 0.85 : 0.3} />
      {/* Keyboard dots */}
      {[0, 5, 10, -5, -10].map(dx => (
        <rect key={dx} x={cx + dx - 1} y={cy + 4} width={2.5} height={1.5}
          fill="#1e293b" rx={0.5} />
      ))}
    </g>
  );
}

// ─── SVG: Agent character ─────────────────────────────────────────────────────

const CHAR_R = 13;

function AgentCharacter({ cx, cy, def, isWorking, isSelected, task, lastTask }: {
  cx: number; cy: number;
  def: typeof AGENT_DEFS[number];
  isWorking: boolean; isSelected: boolean;
  task?: string | null;
  lastTask?: string;
}) {
  const charY = cy - 38;
  const truncated = task && task.length > 25 ? task.slice(0, 25) + "…" : task;
  const lastTrunc = lastTask && lastTask.length > 22 ? lastTask.slice(0, 22) + "…" : lastTask;

  return (
    <motion.g
      animate={isWorking ? { y: [-1.5, 1.5, -1.5] } : { y: 0 }}
      transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
    >
      {/* Selection ring */}
      {isSelected && (
        <motion.circle cx={cx} cy={charY} r={CHAR_R + 7}
          fill="none" stroke={def.colorHex} strokeWidth={1.5}
          strokeDasharray="3 2"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
          style={{ transformOrigin: `${cx}px ${charY}px` }}
        />
      )}

      {/* Glow pulse when working */}
      {isWorking && (
        <motion.circle cx={cx} cy={charY} r={CHAR_R + 5}
          fill={def.colorHex} opacity={0}
          animate={{ opacity: [0, 0.15, 0], r: [CHAR_R + 3, CHAR_R + 9, CHAR_R + 3] }}
          transition={{ repeat: Infinity, duration: 1.8 }} />
      )}

      {/* Body */}
      <circle cx={cx} cy={charY} r={CHAR_R}
        fill={`${def.colorHex}1a`}
        stroke={def.colorHex}
        strokeWidth={isWorking ? 2 : 1}
        opacity={isWorking ? 1 : 0.55}
      />

      {/* Emoji */}
      <text x={cx} y={charY + 4.5} textAnchor="middle" fontSize={12} dominantBaseline="middle">
        {def.emoji}
      </text>

      {/* Online dot */}
      <motion.circle cx={cx + 10} cy={charY - 10} r={3}
        fill={isWorking ? "#10b981" : "#374151"}
        animate={isWorking ? { opacity: [1, 0.4, 1] } : {}}
        transition={{ repeat: Infinity, duration: 1.5 }}
      />

      {/* Name tag */}
      <rect x={cx - 22} y={charY - 30} width={44} height={14} rx={3}
        fill="#0f172a" stroke={`${def.colorHex}44`} strokeWidth={0.5} />
      <text x={cx} y={charY - 19} textAnchor="middle" fontSize={7.5} fill="#94a3b8"
        fontFamily="monospace">
        {def.name}
      </text>

      {/* Speech bubble — active task (bright) */}
      {isWorking && truncated && (
        <g>
          <rect x={cx - 58} y={charY - 70} width={116} height={24} rx={6}
            fill="#0f172a" stroke={`${def.colorHex}99`} strokeWidth={1} opacity={0.97} />
          <text x={cx} y={charY - 54} textAnchor="middle" fontSize={7.5} fill={def.colorHex}
            fontFamily="monospace" fontWeight="bold">
            {truncated}
          </text>
          <polygon points={`${cx - 4},${cy - 46} ${cx + 4},${cy - 46} ${cx},${cy - 40}`}
            fill="#0f172a" />
        </g>
      )}

      {/* Speech bubble — last task (dim, shown when idle) */}
      {!isWorking && lastTrunc && (
        <g opacity={0.35}>
          <rect x={cx - 54} y={charY - 68} width={108} height={22} rx={5}
            fill="#0a1120" stroke={`${def.colorHex}44`} strokeWidth={0.6} />
          <text x={cx} y={charY - 54} textAnchor="middle" fontSize={7} fill="#64748b"
            fontFamily="monospace">
            {lastTrunc}
          </text>
        </g>
      )}
    </motion.g>
  );
}

// ─── SVG: Mail particle ───────────────────────────────────────────────────────

function MailParticle({ from, to, particleKey }: {
  from: [number, number]; to: [number, number]; particleKey: string;
}) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const mx = (fx + tx) / 2 + (fy < ty ? -30 : 30);
  const my = Math.min(fy, ty) - 40;

  return (
    <motion.g key={particleKey}>
      <motion.circle r={4} fill="#f59e0b"
        initial={{ cx: fx, cy: fy - 38, opacity: 0.9, scale: 1 }}
        animate={{ cx: [fx, mx, tx], cy: [fy - 38, my, ty - 38], opacity: [0.9, 1, 0], scale: [1, 1.3, 0.6] }}
        transition={{ duration: 2.4, ease: "easeInOut", times: [0, 0.5, 1] }}
      />
      <motion.text fontSize={10} textAnchor="middle"
        initial={{ x: fx, y: fy - 38, opacity: 0.9 }}
        animate={{ x: [fx, mx, tx], y: [fy - 38, my, ty - 38], opacity: [0.9, 1, 0] }}
        transition={{ duration: 2.4, ease: "easeInOut", times: [0, 0.5, 1] }}
      >
        ✉
      </motion.text>
    </motion.g>
  );
}

// ─── Main SVG: Isometric Office Scene ────────────────────────────────────────

function OfficeScene({
  statuses, mail, selectedAgent, onSelect,
}: {
  statuses: AgentStatus[];
  mail: MailItem[];
  selectedAgent: AgentId | null;
  onSelect: (id: AgentId) => void;
}) {
  const statusMap = Object.fromEntries(statuses.map(s => [s.agentId, s]));

  // Default task descriptions shown before first real task arrives
  const AGENT_FALLBACK_TASKS: Record<string, string> = {
    orchestrator: "coordinating agents & delivering mail",
    trainer:      "scanning training queue",
    librarian:    "auditing knowledge base",
    guardian:     "processing support tickets",
    analyst:      "aggregating system metrics",
    botmaster:    "monitoring WhatsApp bots",
    curator:      "curating conversation quality",
    engineer:     "checking infrastructure health",
  };

  // Track last known task per agent (shown dimly when idle)
  const [lastTaskMap, setLastTaskMap] = useState<Record<string, string>>(AGENT_FALLBACK_TASKS);
  useEffect(() => {
    setLastTaskMap(prev => {
      const next = { ...prev };
      statuses.forEach(s => { if (s.currentTask) next[s.agentId] = s.currentTask; });
      return next;
    });
  }, [statuses]);

  // Show particles for mails sent in the last 8 seconds
  const recentMail = mail
    .filter(m => Date.now() - new Date(m.createdAt).getTime() < 8_000)
    .slice(0, 4);

  // Sort agents so front ones (larger cy) are drawn on top
  const sortedDefs = [...AGENT_DEFS].sort((a, b) => {
    const [, ay] = DESK_POS[a.id];
    const [, by] = DESK_POS[b.id];
    return ay - by;
  });

  return (
    <svg viewBox="0 0 700 420" className="w-full h-full" style={{ fontFamily: "monospace" }}>
      <defs>
        <radialGradient id="bgGrad" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#0a1628" />
          <stop offset="100%" stopColor="#040810" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width={700} height={420} fill="url(#bgGrad)" />

      {/* Floor */}
      <OfficeFloor />

      {/* Faint connection lines (orchestrator → all) */}
      <g opacity={0.08}>
        {AGENT_DEFS.slice(1).map(def => {
          const [ox, oy] = DESK_POS.orchestrator;
          const [ax, ay] = DESK_POS[def.id];
          return (
            <line key={def.id} x1={ox} y1={oy - 25} x2={ax} y2={ay - 25}
              stroke="#10b981" strokeWidth={0.8} strokeDasharray="4 5" />
          );
        })}
      </g>

      {/* Mail particles */}
      {recentMail.map(m => {
        const from = DESK_POS[m.fromAgent];
        const to   = DESK_POS[m.toAgent];
        if (!from || !to) return null;
        return (
          <MailParticle key={`${m.id}`}
            particleKey={`${m.id}`} from={from} to={to} />
        );
      })}

      {/* Agent stations — back to front order */}
      {sortedDefs.map(def => {
        const [cx, cy] = DESK_POS[def.id];
        const status    = statusMap[def.id];
        const isWorking = status?.status === "working";
        const isSelected = selectedAgent === def.id;

        return (
          <g key={def.id} onClick={() => onSelect(def.id as AgentId)} style={{ cursor: "pointer" }}>
            <IsoDesk cx={cx} cy={cy}
              colorHex={def.colorHex} deskHex={def.deskHex}
              isWorking={isWorking} />

            {isSelected && (
              <motion.ellipse cx={cx} cy={cy + DESK_HH + DESK_D * 0.4}
                rx={DESK_HW + 14} ry={DESK_D + 2}
                fill="none" stroke={def.colorHex} strokeWidth={1.5}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 1 }} />
            )}

            <AgentCharacter cx={cx} cy={cy} def={def}
              isWorking={isWorking} isSelected={isSelected}
              task={status?.currentTask}
              lastTask={lastTaskMap[def.id]} />
          </g>
        );
      })}

      {/* Legend */}
      <g opacity={0.5}>
        <motion.circle cx={12} cy={12} r={3.5} fill="#10b981"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} />
        <text x={20} y={16} fontSize={8} fill="#10b981">LIVE</text>
        <circle cx={60} cy={12} r={3.5} fill="#374151" />
        <text x={68} y={16} fontSize={8} fill="#6b7280">IDLE</text>
      </g>
    </svg>
  );
}

// ─── Agent detail panel ───────────────────────────────────────────────────────

function AgentDetailPanel({
  agentId, statuses, mail, workers, onNudge, onClose,
}: {
  agentId: AgentId | null;
  statuses: AgentStatus[];
  mail: MailItem[];
  workers: WorkerInfo[];
  onNudge: (id: string) => void;
  onClose: () => void;
}) {
  if (!agentId) return null;
  const def = AGENT_DEFS.find(d => d.id === agentId);
  if (!def) return null;

  const status = statuses.find(s => s.agentId === agentId);
  const worker = workers.find(w => w.id === agentId);
  const agentMail = mail.filter(m => m.fromAgent === agentId || m.toAgent === agentId).slice(0, 8);
  const isWorking = status?.status === "working";

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      className="bg-slate-900/95 border border-slate-700/60 rounded-xl p-4 h-full overflow-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="text-2xl">{def.emoji}</div>
          <div>
            <div className="font-bold text-white text-sm">{def.name}</div>
            <div className="text-xs text-slate-400">{def.role}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-xs px-2 py-1 rounded border border-slate-700 hover:border-slate-500 transition-colors">
          ✕
        </button>
      </div>

      {/* Status */}
      <div className="mb-4 p-3 bg-slate-800/60 rounded-lg border border-slate-700/40">
        <div className="flex items-center gap-2 mb-2">
          <motion.div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: isWorking ? def.colorHex : "#374151" }}
            animate={isWorking ? { opacity: [1, 0.3, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
          <span className="text-xs font-mono" style={{ color: isWorking ? def.colorHex : "#6b7280" }}>
            {isWorking ? "WORKING" : (status?.status ?? "OFFLINE").toUpperCase()}
          </span>
          <span className="text-xs text-slate-500 ml-auto">
            {status?.tickCount ?? 0} ticks
          </span>
        </div>
        {status?.currentTask && (
          <div className="text-xs text-slate-300 font-mono mt-1 line-clamp-2">
            {status.currentTask}
          </div>
        )}
        {worker && (
          <div className="text-xs text-slate-500 mt-2">
            Every {worker.intervalMs / 1000}s
            {worker.lastRun > 0 && ` · Last: ${Math.round((Date.now() - worker.lastRun) / 1000)}s ago`}
          </div>
        )}
      </div>

      {/* Vision */}
      <div className="mb-4 p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
        <div className="text-xs text-slate-500 mb-1">VISION</div>
        <div className="text-xs text-slate-300 italic leading-relaxed">{worker?.vision}</div>
      </div>

      {/* Nudge button */}
      <button
        onClick={() => onNudge(agentId)}
        className="w-full mb-4 py-2 rounded-lg border text-xs font-mono transition-all"
        style={{
          backgroundColor: `${def.colorHex}15`,
          borderColor: `${def.colorHex}44`,
          color: def.colorHex,
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${def.colorHex}25`)}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = `${def.colorHex}15`)}
      >
        <Zap className="inline w-3 h-3 mr-1" />
        NUDGE AGENT
      </button>

      {/* Recent mail */}
      <div className="text-xs text-slate-500 mb-2 font-mono">RECENT MAIL</div>
      <div className="space-y-2">
        {agentMail.length === 0 ? (
          <div className="text-xs text-slate-600 text-center py-3">No recent mail</div>
        ) : (
          agentMail.map(m => (
            <div key={m.id} className="p-2 bg-slate-800/50 rounded-lg border border-slate-700/30">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs text-slate-500">{m.fromAgent}</span>
                <ChevronRight className="w-3 h-3 text-slate-600" />
                <span className="text-xs text-slate-400">{m.toAgent}</span>
                <span className={cn("ml-auto text-xs px-1 rounded", {
                  "text-red-400 bg-red-900/30": m.priority === "critical",
                  "text-amber-400 bg-amber-900/30": m.priority === "high",
                  "text-blue-400 bg-blue-900/30": m.priority === "normal",
                  "text-slate-400 bg-slate-800": m.priority === "low",
                })}>
                  {m.priority}
                </span>
              </div>
              <div className="text-xs text-slate-300 font-mono truncate">{m.subject}</div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({ mail, statuses }: { mail: MailItem[]; statuses: AgentStatus[] }) {
  const defMap = Object.fromEntries(AGENT_DEFS.map(d => [d.id, d]));

  return (
    <div className="space-y-2">
      {mail.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm font-mono">
          No inter-agent mail yet — agents are initializing…
        </div>
      )}
      {mail.map(m => {
        const fromDef = defMap[m.fromAgent];
        const toDef   = defMap[m.toAgent];
        const age = Date.now() - new Date(m.createdAt).getTime();
        const ageStr = age < 60_000
          ? `${Math.round(age / 1000)}s ago`
          : age < 3600_000
          ? `${Math.round(age / 60_000)}m ago`
          : `${Math.round(age / 3600_000)}h ago`;

        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/40 hover:border-slate-600/60 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              {fromDef && (
                <span className="text-base">{fromDef.emoji}</span>
              )}
              <span className="text-xs text-slate-400 font-mono">{m.fromAgent}</span>
              <ChevronRight className="w-3 h-3 text-slate-600" />
              {toDef && (
                <span className="text-base">{toDef.emoji}</span>
              )}
              <span className="text-xs text-slate-400 font-mono">{m.toAgent}</span>
              <span className={cn("ml-auto text-xs px-1.5 py-0.5 rounded font-mono", {
                "text-red-400 bg-red-900/30 border border-red-800/50": m.priority === "critical",
                "text-amber-400 bg-amber-900/30 border border-amber-800/50": m.priority === "high",
                "text-blue-400 bg-blue-900/30 border border-blue-800/50": m.priority === "normal",
                "text-slate-400 bg-slate-800/50": m.priority === "low",
              })}>
                {m.priority}
              </span>
              <span className="text-xs text-slate-600">{ageStr}</span>
            </div>
            <div className="text-sm text-white font-mono">{m.subject}</div>
            <div className="text-xs text-slate-400 mt-1 line-clamp-2">{m.body}</div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Dev Agent Tab (Qwen ReAct Sessions) ─────────────────────────────────────

interface DevSession {
  id: string; title: string; status: string; createdAt: string;
  steps: Array<{ thought: string; action: string; observation: string; error?: boolean }>;
  result?: string; error?: string;
}

function DevAgentTab() {
  const [sessions, setSessions] = useState<DevSession[]>([]);
  const [selected, setSelected] = useState<DevSession | null>(null);
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);
  const [polling, setPolling] = useState<ReturnType<typeof setInterval> | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/sessions");
      if (r.ok) { const d = await r.json(); setSessions(d.sessions ?? []); }
    } catch {}
  }, []);

  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 3000);
    return () => clearInterval(t);
  }, [loadSessions]);

  const pollSession = useCallback((id: string) => {
    if (polling) clearInterval(polling);
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/agent/sessions/${id}`);
        if (r.ok) {
          const d = await r.json();
          setSelected(d.session);
          if (d.session.status === "done" || d.session.status === "error") {
            clearInterval(t);
            setPolling(null);
            loadSessions();
          }
        }
      } catch {}
    }, 1000);
    setPolling(t);
  }, [polling, loadSessions]);

  useEffect(() => () => { if (polling) clearInterval(polling); }, [polling]);

  const createSession = async () => {
    if (!goal.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/agent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), maxSteps: 12 }),
      });
      if (r.ok) {
        const d = await r.json();
        setGoal("");
        setSelected(d.session);
        pollSession(d.session.id);
        loadSessions();
      }
    } catch {}
    setCreating(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {/* Sessions list */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={goal}
            onChange={e => setGoal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !creating && createSession()}
            placeholder="What should the Dev Agent do?"
            className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
          />
          <button
            onClick={createSession}
            disabled={creating || !goal.trim()}
            className="px-3 py-2 bg-emerald-600/20 border border-emerald-600/40 rounded-lg text-emerald-400 text-sm hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        <div className="space-y-2 overflow-auto max-h-[60vh]">
          {sessions.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              No dev sessions yet
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id}
              onClick={() => { setSelected(s); if (s.status === "running") pollSession(s.id); }}
              className={cn("p-3 rounded-xl border cursor-pointer transition-all", {
                "border-emerald-500/50 bg-emerald-500/5": selected?.id === s.id,
                "border-slate-700/40 bg-slate-900/40 hover:border-slate-600": selected?.id !== s.id,
              })}
            >
              <div className="flex items-center gap-2 mb-1">
                {s.status === "running"  && <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />}
                {s.status === "done"     && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                {s.status === "error"    && <XCircle className="w-3 h-3 text-red-400" />}
                <span className="text-xs text-slate-300 font-mono truncate">{s.title}</span>
              </div>
              <div className="text-xs text-slate-500">{s.steps?.length ?? 0} steps</div>
            </div>
          ))}
        </div>
      </div>

      {/* Session detail */}
      <div className="lg:col-span-2 overflow-auto">
        {!selected && (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Select a session or create a new one
          </div>
        )}
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <div className="text-sm font-bold text-white font-mono">{selected.title}</div>
                <div className="text-xs text-slate-500">
                  {selected.status} · {selected.steps?.length ?? 0} steps
                </div>
              </div>
            </div>
            {selected.steps?.map((step, i) => (
              <div key={i} className={cn("p-3 rounded-xl border text-xs space-y-1.5",
                step.error ? "border-red-800/40 bg-red-900/10" : "border-slate-700/40 bg-slate-900/40"
              )}>
                <div className="text-emerald-400 font-mono">
                  💭 <span className="text-slate-300">{step.thought}</span>
                </div>
                <div className="text-blue-400 font-mono">
                  🔧 <span className="text-slate-300">{step.action}</span>
                </div>
                {step.observation && (
                  <div className="text-amber-400 font-mono">
                    👁 <span className="text-slate-400">{step.observation}</span>
                  </div>
                )}
              </div>
            ))}
            {selected.result && (
              <div className="p-3 rounded-xl border border-emerald-700/40 bg-emerald-900/10 text-xs text-emerald-300">
                ✅ {selected.result}
              </div>
            )}
            {selected.error && (
              <div className="p-3 rounded-xl border border-red-700/40 bg-red-900/10 text-xs text-red-300">
                ❌ {selected.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentCommandCenter() {
  const [tab, setTab] = useState<"office" | "activity" | "dev">("office");
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [mail, setMail] = useState<MailItem[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [nudging, setNudging] = useState<string | null>(null);
  const [mailUnread, setMailUnread] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const lastMailIdRef = useRef<number>(0);

  // ─── Data fetchers ──────────────────────────────────────────────────────────

  const fetchStatuses = useCallback(async () => {
    try {
      const r = await fetch("/api/workers/status");
      if (r.ok) { const d = await r.json(); setStatuses(d.agents ?? []); }
    } catch {}
  }, []);

  const fetchMail = useCallback(async () => {
    try {
      const r = await fetch("/api/workers/mail/all?limit=80");
      if (r.ok) {
        const d = await r.json();
        const items: MailItem[] = d.mail ?? [];
        setMail(items);
        if (items.length > 0 && items[0]) {
          const latest = items[0].id;
          if (latest > lastMailIdRef.current) {
            setMailUnread(prev => prev + (latest - lastMailIdRef.current));
            lastMailIdRef.current = latest;
          }
        }
      }
    } catch {}
  }, []);

  const fetchWorkers = useCallback(async () => {
    try {
      const r = await fetch("/api/workers/status");
      if (r.ok) {
        const d = await r.json();
        setWorkers(d.workers ?? []);
      }
    } catch {}
  }, []);

  // ─── SSE connection ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetchStatuses();
    fetchMail();
    fetchWorkers();

    const es = new EventSource("/api/workers/events");
    esRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.addEventListener("worker_tick", () => {
      // Refresh data on every agent tick
      fetchStatuses();
      fetchMail();
    });

    // Polling fallback (catches anything SSE misses)
    const pollTimer = setInterval(() => {
      fetchStatuses();
      fetchMail();
    }, 5000);

    return () => {
      es.close();
      clearInterval(pollTimer);
    };
  }, [fetchStatuses, fetchMail, fetchWorkers]);

  // Clear unread badge when switching to activity tab
  useEffect(() => {
    if (tab === "activity") setMailUnread(0);
  }, [tab]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const nudgeAgent = async (id: string) => {
    setNudging(id);
    try {
      await fetch(`/api/workers/${id}/nudge`, { method: "POST" });
      setTimeout(fetchStatuses, 800);
    } catch {}
    setTimeout(() => setNudging(null), 2000);
  };

  // ─── Computed stats ──────────────────────────────────────────────────────────

  // Count agents that are actively working OR have ticked at least once (recently active)
  const workingCount = statuses.filter(s => s.status === "working" || (s.tickCount ?? 0) > 0).length;
  const totalCount   = AGENT_DEFS.length;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* ── Header ── */}
      <div className="flex-none border-b border-slate-800/60 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-xl">🏢</div>
            <div>
              <div className="font-bold text-white tracking-wide" style={{ fontFamily: "Syne, sans-serif" }}>
                Agent Command Center
              </div>
              <div className="text-xs text-slate-400 font-mono">DLavie OS · 8 Autonomous Agents</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* SSE status */}
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <motion.div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: sseConnected ? "#10b981" : "#f59e0b" }}
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              />
              <span className={sseConnected ? "text-emerald-400" : "text-amber-400"}>
                {sseConnected ? "SSE LIVE" : "POLLING"}
              </span>
            </div>

            {/* Working count */}
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1 text-xs font-mono">
              <motion.div className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ repeat: Infinity, duration: 1 }} />
              <span className="text-emerald-400">{workingCount}/{totalCount} ONLINE</span>
            </div>

            <button
              onClick={() => { fetchStatuses(); fetchMail(); }}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex-none border-b border-slate-800/60 px-4">
        <div className="max-w-7xl mx-auto flex gap-1">
          {[
            { key: "office",   label: "🏢 Office",   icon: null },
            { key: "activity", label: "📨 Activity", badge: mailUnread },
            { key: "dev",      label: "🤖 Dev Agent", icon: null },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={cn(
                "relative px-4 py-2.5 text-sm font-mono border-b-2 transition-colors",
                tab === t.key
                  ? "border-emerald-500 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-300",
              )}
            >
              {t.label}
              {(t.badge ?? 0) > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-emerald-500 text-black text-xs rounded-full flex items-center justify-center font-bold">
                  {(t.badge ?? 0) > 9 ? "9+" : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-4 h-full">

          {/* ── OFFICE TAB ── */}
          {tab === "office" && (
            <div className="flex gap-4 h-full" style={{ minHeight: "calc(100vh - 140px)" }}>
              {/* Main SVG office */}
              <div className={cn(
                "flex-1 rounded-2xl border border-slate-800/60 bg-slate-950/80 overflow-hidden transition-all",
                selectedAgent ? "flex-[2]" : "flex-1",
              )}>
                <OfficeScene
                  statuses={statuses}
                  mail={mail}
                  selectedAgent={selectedAgent}
                  onSelect={id => setSelectedAgent(id === selectedAgent ? null : id)}
                />
              </div>

              {/* Agent detail panel */}
              <AnimatePresence>
                {selectedAgent && (
                  <div className="w-72 flex-none">
                    <AgentDetailPanel
                      agentId={selectedAgent}
                      statuses={statuses}
                      mail={mail}
                      workers={workers}
                      onNudge={nudgeAgent}
                      onClose={() => setSelectedAgent(null)}
                    />
                  </div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ── ACTIVITY TAB ── */}
          {tab === "activity" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Mail feed */}
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-mono text-slate-300 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-emerald-400" />
                    Inter-agent Mail
                    <span className="text-slate-500 text-xs">({mail.length} total)</span>
                  </div>
                </div>
                <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-auto pr-1">
                  <ActivityFeed mail={mail} statuses={statuses} />
                </div>
              </div>

              {/* Agent roster status */}
              <div>
                <div className="text-sm font-mono text-slate-300 flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Agent Roster
                </div>
                <div className="space-y-2">
                  {AGENT_DEFS.map(def => {
                    const status = statuses.find(s => s.agentId === def.id);
                    const worker = workers.find(w => w.id === def.id);
                    const isWorking = status?.status === "working";

                    return (
                      <div key={def.id}
                        className="p-3 rounded-xl border border-slate-800/60 bg-slate-900/40 hover:border-slate-700 cursor-pointer transition-colors"
                        onClick={() => { setSelectedAgent(def.id as AgentId); setTab("office"); }}
                      >
                        <div className="flex items-center gap-2">
                          <span>{def.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white font-mono">{def.name}</div>
                            <div className="text-xs text-slate-500 truncate">
                              {status?.currentTask ?? def.role}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <motion.div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: isWorking ? def.colorHex : "#374151" }}
                              animate={isWorking ? { opacity: [1, 0.3, 1] } : {}}
                              transition={{ repeat: Infinity, duration: 1.5 }}
                            />
                            <button
                              onClick={e => { e.stopPropagation(); nudgeAgent(def.id); }}
                              className="p-1 text-slate-600 hover:text-slate-300 transition-colors"
                              title="Nudge agent"
                            >
                              {nudging === def.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Zap className="w-3 h-3" />
                              }
                            </button>
                          </div>
                        </div>
                        {worker && (
                          <div className="text-xs text-slate-600 mt-1 font-mono">
                            {status?.tickCount ?? 0} ticks · every {worker.intervalMs / 1000}s
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── DEV AGENT TAB ── */}
          {tab === "dev" && <DevAgentTab />}
        </div>
      </div>
    </div>
  );
}
