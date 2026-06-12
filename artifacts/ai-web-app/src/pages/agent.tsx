/**
 * DLavie OS — Agent Command Center v3
 * 12 autonomous AI agents · modern isometric office · live collaboration threads
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Brain, BookOpen, Shield, BarChart2, Wrench, Star, Radio,
  Mail, Activity, TerminalSquare, Zap, RefreshCw, Send,
  Play, Square, PlusCircle, AlertTriangle, CheckCircle2,
  XCircle, Loader2, Inbox, Sparkles, ChevronRight,
  RotateCcw, ShieldAlert, ShieldCheck, Cpu, MessageSquare,
  Users, FlaskConical, Rocket, Eye, Building2, Coffee,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Agent Definitions — 12 agents ───────────────────────────────────────────

const AGENT_DEFS = [
  { id: "orchestrator", name: "Orchestrator", emoji: "🎯", colorHex: "#10b981", deskHex: "#064e3b", role: "Master coordinator",     zone: "command"   },
  { id: "trainer",      name: "Trainer",      emoji: "🧠", colorHex: "#8b5cf6", deskHex: "#3b0764", role: "AI model training",     zone: "research"  },
  { id: "librarian",    name: "Librarian",    emoji: "📚", colorHex: "#0ea5e9", deskHex: "#0c4a6e", role: "Knowledge base",        zone: "creative"  },
  { id: "guardian",     name: "Guardian",     emoji: "🛡️", colorHex: "#f59e0b", deskHex: "#78350f", role: "Tickets & quality",     zone: "ops"       },
  { id: "analyst",      name: "Analyst",      emoji: "📊", colorHex: "#3b82f6", deskHex: "#1e3a8a", role: "Data intelligence",     zone: "ops"       },
  { id: "botmaster",    name: "Botmaster",    emoji: "🤖", colorHex: "#14b8a6", deskHex: "#134e4a", role: "Bot operations",        zone: "comms"     },
  { id: "curator",      name: "Curator",      emoji: "✨", colorHex: "#ec4899", deskHex: "#831843", role: "Prompt curation",       zone: "creative"  },
  { id: "engineer",     name: "Engineer",     emoji: "⚙️", colorHex: "#f97316", deskHex: "#7c2d12", role: "Infrastructure",        zone: "infra"     },
  { id: "mandor",       name: "Mandor",       emoji: "👑", colorHex: "#eab308", deskHex: "#713f12", role: "AI Prompt Supervisor",  zone: "executive" },
  { id: "researcher",   name: "Researcher",   emoji: "🔬", colorHex: "#a855f7", deskHex: "#581c87", role: "AI/ML Intelligence",    zone: "research"  },
  { id: "deployer",     name: "Deployer",     emoji: "🚀", colorHex: "#06b6d4", deskHex: "#0e4966", role: "Deployment & Ops",      zone: "infra"     },
  { id: "reviewer",     name: "CodeReviewer", emoji: "👁️", colorHex: "#84cc16", deskHex: "#365314", role: "Code Quality",          zone: "research"  },
] as const;

type AgentId = typeof AGENT_DEFS[number]["id"];

// Desk top-face center positions — viewBox 0 0 920 540
const DESK_POS: Record<string, [number, number]> = {
  orchestrator: [460, 148],
  mandor:       [728, 102],
  researcher:   [148, 194],
  trainer:      [232, 252],
  reviewer:     [308, 192],
  guardian:     [368, 268],
  analyst:      [466, 250],
  librarian:    [194, 348],
  curator:      [288, 388],
  engineer:     [564, 192],
  deployer:     [628, 292],
  botmaster:    [444, 408],
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

interface CollabMessage {
  agentId: string;
  content: string;
  ts: number;
}

interface CollabThread {
  id: string;
  topic: string;
  initiator: string;
  participants: string[];
  messageCount: number;
  messages: CollabMessage[];
  startedAt: number;
  concludedAt: number | null;
  conclusion: string | null;
  active: boolean;
}

interface CircuitStatus {
  open: boolean;
  consecutiveFails: number;
  opensAt: number | null;
  recoversIn: number | null;
  threshold: number;
  cooldownMs: number;
  thoughtCacheSize: number;
  mailDedupSize: number;
}

interface MailParticle {
  id: number;
  fromId: string;
  toId: string;
  ts: number;
}

// ─── Isometric Office SVG ─────────────────────────────────────────────────────

// Zone glow definitions
const ZONE_GLOWS = [
  { cx: 232, cy: 218, rx: 148, ry: 78,  fill: "#a855f7" }, // Research Lab
  { cx: 460, cy: 155, rx: 90,  ry: 48,  fill: "#10b981" }, // Command Center
  { cx: 728, cy: 112, rx: 72,  ry: 42,  fill: "#eab308" }, // Executive Suite
  { cx: 416, cy: 264, rx: 112, ry: 56,  fill: "#3b82f6" }, // Operations Hub
  { cx: 240, cy: 370, rx: 122, ry: 68,  fill: "#ec4899" }, // Creative Studio
  { cx: 596, cy: 242, rx: 98,  ry: 68,  fill: "#f97316" }, // Infrastructure Bay
  { cx: 444, cy: 408, rx: 60,  ry: 36,  fill: "#14b8a6" }, // Communications
];

const ZONE_LABELS = [
  { x: 82,  y: 136, label: "Research Lab",      color: "#c084fc" },
  { x: 405, y: 96,  label: "Command Center",     color: "#34d399" },
  { x: 658, y: 58,  label: "Executive Suite",    color: "#fde047" },
  { x: 300, y: 220, label: "Ops Hub",            color: "#60a5fa" },
  { x: 100, y: 298, label: "Creative Studio",    color: "#f472b6" },
  { x: 500, y: 140, label: "Infra Bay",          color: "#fb923c" },
  { x: 378, y: 362, label: "Comms",              color: "#2dd4bf" },
];

// Isometric desk
function IsoDesk({ cx, cy, deskColor, active, collaborating }:
  { cx: number; cy: number; deskColor: string; active: boolean; collaborating?: boolean }) {
  const w = 46; const h = 46; const th = 10;
  const hw = w / 2; const hh = h / 2;
  const topF = active ? deskColor : `${deskColor}99`;
  const leftF = "#00000055"; const rightF = "#00000033";
  const top   = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  const left  = `${cx - hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh + th} ${cx - hw},${cy + th}`;
  const right = `${cx + hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh + th} ${cx + hw},${cy + th}`;
  return (
    <>
      {collaborating && (
        <ellipse cx={cx} cy={cy + 4} rx={hw + 8} ry={hh + 4}
          fill="none" stroke="#a78bfa" strokeWidth={1.5} opacity={0.6}>
          <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="r" values="0;2;0" dur="1.5s" repeatCount="indefinite"/>
        </ellipse>
      )}
      <polygon points={top}   fill={topF}   />
      <polygon points={left}  fill={leftF}  />
      <polygon points={right} fill={rightF} />
      {/* Monitor */}
      <rect x={cx - 8} y={cy - hh - 12} width={16} height={10} rx={1} fill="#0f172a" />
      <rect x={cx - 7} y={cy - hh - 11} width={14} height={8}  rx={0.5} fill={active ? "#1e3a5f" : "#111827"} />
      {active && <rect x={cx - 6} y={cy - hh - 10} width={4} height={1} fill={deskColor} opacity={0.8}/>}
      {active && <rect x={cx - 6} y={cy - hh - 8} width={7} height={1} fill={deskColor} opacity={0.5}/>}
    </>
  );
}

// Agent character
function AgentChar({ cx, cy, def, status, collaborating }:
  { cx: number; cy: number; def: typeof AGENT_DEFS[number]; status?: AgentStatus; collaborating?: boolean }) {
  const isWorking = status?.status === "working";
  const isError   = status?.status === "error";
  const isOffline = !status;
  const color = def.colorHex;

  return (
    <motion.g
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: isOffline ? 0.35 : 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Glow ring when working */}
      {isWorking && (
        <ellipse cx={cx} cy={cy + 2} rx={14} ry={7} fill={color} opacity={0.18}>
          <animate attributeName="opacity" values="0.18;0.38;0.18" dur="2s" repeatCount="indefinite"/>
        </ellipse>
      )}
      {/* Collaboration ring */}
      {collaborating && (
        <ellipse cx={cx} cy={cy + 2} rx={16} ry={8} fill="none" stroke="#a78bfa" strokeWidth={1.2} opacity={0.7}>
          <animate attributeName="opacity" values="0.7;1;0.7" dur="1s" repeatCount="indefinite"/>
        </ellipse>
      )}
      {/* Body */}
      <ellipse cx={cx} cy={cy + 4} rx={9} ry={5} fill={`${color}55`}/>
      <circle cx={cx} cy={cy - 2} r={8} fill={color} />
      <circle cx={cx} cy={cy - 2} r={6.5} fill={`${color}cc`} />
      {/* Emoji face */}
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize={8} style={{ userSelect: "none" }}>
        {def.emoji}
      </text>
      {/* Status dot */}
      <circle
        cx={cx + 7} cy={cy - 8} r={2.5}
        fill={isError ? "#ef4444" : isOffline ? "#475569" : isWorking ? "#22c55e" : "#eab308"}
      >
        {isWorking && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>}
      </circle>
    </motion.g>
  );
}

// Mail particle flying between two desks
function MailParticleAnim({ from, to }: { from: [number, number]; to: [number, number] }) {
  const id = useRef(`mp_${Math.random().toString(36).slice(2)}`).current;
  const mx = (from[0] + to[0]) / 2;
  const my = Math.min(from[1], to[1]) - 38;
  const path = `M${from[0]},${from[1]} Q${mx},${my} ${to[0]},${to[1]}`;
  return (
    <g>
      <path id={id} d={path} fill="none" stroke="none" />
      <circle r={3} fill="#a78bfa" opacity={0.85}>
        <animateMotion dur="1.1s" fill="freeze" path={path} />
        <animate attributeName="opacity" values="0;0.85;0" dur="1.1s" fill="freeze"/>
      </circle>
    </g>
  );
}

// Conference table (shown when active collab threads exist)
function ConferenceTable({ cx, cy, participants, agentStatuses }:
  { cx: number; cy: number; participants: string[]; agentStatuses: AgentStatus[] }) {
  return (
    <g>
      {/* Table top (large isometric oval) */}
      <ellipse cx={cx} cy={cy} rx={52} ry={28} fill="#1e293b" stroke="#334155" strokeWidth={1.5}/>
      <ellipse cx={cx} cy={cy - 4} rx={52} ry={28} fill="#1e3a5f" stroke="#3b82f6" strokeWidth={1} opacity={0.8}/>
      <ellipse cx={cx} cy={cy - 4} rx={40} ry={20} fill="#0f172a" stroke="#1d4ed8" strokeWidth={0.8}/>
      {/* Glow */}
      <ellipse cx={cx} cy={cy - 4} rx={56} ry={32} fill="none" stroke="#6366f1" strokeWidth={2} opacity={0.4}>
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite"/>
      </ellipse>
      {/* Meeting label */}
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize={7} fill="#818cf8" style={{ userSelect: "none" }}>
        MEETING
      </text>
      {/* Seats */}
      {[-36, 0, 36].map((dx, i) => (
        <ellipse key={i} cx={cx + dx} cy={cy + 22} rx={8} ry={4} fill="#1e293b" stroke="#334155" strokeWidth={0.8}/>
      ))}
      {[-36, 0, 36].map((dx, i) => (
        <ellipse key={i + 3} cx={cx + dx} cy={cy - 28} rx={8} ry={4} fill="#1e293b" stroke="#334155" strokeWidth={0.8}/>
      ))}
    </g>
  );
}

// Office scene — main SVG
function OfficeScene({
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  particles,
  activeThreads,
}: {
  agentStatuses: AgentStatus[];
  selectedAgent: string | null;
  onSelectAgent: (id: string) => void;
  particles: MailParticle[];
  activeThreads: CollabThread[];
}) {
  const statusMap = new Map(agentStatuses.map(a => [a.agentId, a]));

  // Agents currently in active collaboration
  const collaboratingAgents = new Set<string>();
  activeThreads.filter(t => t.active).forEach(t => t.participants.forEach(p => collaboratingAgents.add(p)));

  // Has any active meeting
  const hasMeeting = activeThreads.some(t => t.active);

  return (
    <svg
      viewBox="0 0 920 540"
      className="w-full h-full select-none"
      style={{ background: "linear-gradient(135deg, #050c18 0%, #0a1628 50%, #050c18 100%)" }}
    >
      <defs>
        <radialGradient id="roomGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#1e3a5f" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#050c18" stopOpacity="0"/>
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Room ambient glow */}
      <ellipse cx={460} cy={280} rx={380} ry={220} fill="url(#roomGlow)"/>

      {/* Floor tiles — base grid */}
      {Array.from({ length: 7 }, (_, row) =>
        Array.from({ length: 14 }, (_, col) => {
          const cx = 460 + (col - 7) * 60 - row * 30;
          const cy = 260 + row * 24 + (col - 7) * 12;
          const shade = (row + col) % 2 === 0 ? "#0d1b2e" : "#0a1628";
          return (
            <g key={`${row}-${col}`}>
              <polygon
                points={`${cx},${cy - 12} ${cx + 30},${cy} ${cx},${cy + 12} ${cx - 30},${cy}`}
                fill={shade} stroke="#0f1e33" strokeWidth={0.5}
              />
            </g>
          );
        })
      )}

      {/* Zone glow overlays */}
      {ZONE_GLOWS.map((z, i) => (
        <ellipse key={i} cx={z.cx} cy={z.cy} rx={z.rx} ry={z.ry}
          fill={z.fill} opacity={0.045}/>
      ))}

      {/* Zone labels */}
      {ZONE_LABELS.map((z, i) => (
        <g key={i}>
          <rect x={z.x - 2} y={z.y - 10} width={z.label.length * 5.5 + 4} height={13}
            rx={3} fill="#050c18" opacity={0.7}/>
          <text x={z.x} y={z.y} fontSize={7.5} fill={z.color} opacity={0.65}
            fontFamily="monospace" style={{ userSelect: "none" }}>
            {z.label}
          </text>
        </g>
      ))}

      {/* Decorative elements: plants */}
      {[[82, 462], [100, 398], [800, 158], [840, 440]].map(([px, py], i) => (
        <g key={i}>
          <ellipse cx={px} cy={py + 6} rx={8} ry={4} fill="#14532d"/>
          <circle  cx={px} cy={py}     r={7} fill="#166534"/>
          <circle  cx={px - 4} cy={py - 3} r={4} fill="#15803d"/>
          <circle  cx={px + 4} cy={py - 3} r={4} fill="#15803d"/>
        </g>
      ))}

      {/* Conference table (visible when meeting active) */}
      <AnimatePresence>
        {hasMeeting && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ConferenceTable
              cx={460} cy={290}
              participants={activeThreads.find(t => t.active)?.participants ?? []}
              agentStatuses={agentStatuses}
            />
          </motion.g>
        )}
      </AnimatePresence>

      {/* Mail particles */}
      {particles.map(p => {
        const fromPos = DESK_POS[p.fromId];
        const toPos   = DESK_POS[p.toId];
        if (!fromPos || !toPos) return null;
        return <MailParticleAnim key={p.id} from={fromPos} to={toPos}/>;
      })}

      {/* Desks + agents */}
      {AGENT_DEFS.map(def => {
        const pos = DESK_POS[def.id];
        if (!pos) return null;
        const [cx, cy] = pos;
        const status   = statusMap.get(def.id);
        const isActive = status?.status === "working";
        const isCollab = collaboratingAgents.has(def.id);
        const isSelected = selectedAgent === def.id;

        return (
          <g
            key={def.id}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectAgent(def.id)}
          >
            {/* Selection ring */}
            {isSelected && (
              <ellipse cx={cx} cy={cy + 4} rx={32} ry={18} fill="none"
                stroke={def.colorHex} strokeWidth={1.5} opacity={0.8}/>
            )}
            <IsoDesk
              cx={cx} cy={cy}
              deskColor={def.deskHex}
              active={isActive}
              collaborating={isCollab}
            />
            <AgentChar
              cx={cx} cy={cy - 26}
              def={def}
              status={status}
              collaborating={isCollab}
            />
            {/* Name label */}
            <g>
              <rect x={cx - 20} y={cy - 50} width={40} height={11} rx={3} fill="#050c18" opacity={0.85}/>
              <text x={cx} y={cy - 41} textAnchor="middle" fontSize={6.5}
                fill={isActive ? def.colorHex : "#64748b"} fontFamily="monospace"
                style={{ userSelect: "none" }}>
                {def.name}
              </text>
            </g>
          </g>
        );
      })}

      {/* Collab beams between meeting participants */}
      {hasMeeting && activeThreads
        .filter(t => t.active)
        .flatMap(t => {
          const beams: React.ReactNode[] = [];
          for (let i = 0; i < t.participants.length - 1; i++) {
            const a = DESK_POS[t.participants[i]!];
            const b = DESK_POS[t.participants[i + 1]!];
            if (!a || !b) continue;
            beams.push(
              <line key={`beam_${i}`}
                x1={a[0]} y1={a[1] - 20}
                x2={b[0]} y2={b[1] - 20}
                stroke="#6366f1" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.5}>
                <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2s" repeatCount="indefinite"/>
              </line>
            );
          }
          return beams;
        })
      }

      {/* Break corner (upper right) */}
      <g>
        <rect x={808} y={108} width={88} height={52} rx={4} fill="#0a1628" stroke="#1e293b" strokeWidth={1}/>
        <text x={852} y={122} textAnchor="middle" fontSize={7} fill="#475569" style={{ userSelect: "none" }}>BREAK ROOM</text>
        {/* Coffee machine */}
        <rect x={822} y={126} width={14} height={16} rx={2} fill="#1e293b"/>
        <rect x={824} y={128} width={10} height={6} rx={1} fill="#0f172a"/>
        <circle cx={829} cy={138} r={3} fill="#7c3aed" opacity={0.7}/>
        {/* Sofas */}
        <rect x={846} y={126} width={40} height={12} rx={3} fill="#1e3a5f" stroke="#1e40af" strokeWidth={0.5}/>
        <rect x={846} y={130} width={10} height={8} rx={2} fill="#1e3a5f" stroke="#1e40af" strokeWidth={0.5}/>
        <rect x={876} y={130} width={10} height={8} rx={2} fill="#1e3a5f" stroke="#1e40af" strokeWidth={0.5}/>
      </g>

      {/* Legend */}
      <g>
        {[["🟢","Working"],["🟡","Idle"],["🔴","Error"]].map(([dot, label], i) => (
          <g key={i}>
            <text x={14} y={530 - i * 14} fontSize={8} fill="#64748b" style={{ userSelect: "none" }}>
              {dot} {label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// ─── Agent Detail Panel ───────────────────────────────────────────────────────

function AgentDetailPanel({
  agentId,
  agentStatuses,
  recentMail,
  onNudge,
}: {
  agentId: string | null;
  agentStatuses: AgentStatus[];
  recentMail: MailItem[];
  onNudge: (id: string) => void;
}) {
  const def  = AGENT_DEFS.find(a => a.id === agentId);
  const stat = agentStatuses.find(a => a.agentId === agentId);
  const mail = recentMail.filter(m => m.fromAgent === agentId || m.toAgent === agentId).slice(0, 6);

  if (!def) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 p-6">
        <Building2 className="w-10 h-10 opacity-40"/>
        <p className="text-sm">Click an agent in the office</p>
        <p className="text-xs opacity-60">to view their live status</p>
      </div>
    );
  }

  const statusColor = stat?.status === "working" ? "text-emerald-400"
    : stat?.status === "error"   ? "text-red-400"
    : stat?.status === "idle"    ? "text-yellow-400"
    : "text-slate-500";
  const statusBg = stat?.status === "working" ? "bg-emerald-500/10 border-emerald-500/30"
    : stat?.status === "error"   ? "bg-red-500/10 border-red-500/30"
    : stat?.status === "idle"    ? "bg-yellow-500/10 border-yellow-500/30"
    : "bg-slate-800/50 border-slate-700/30";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-800/60" style={{ borderLeftColor: def.colorHex, borderLeftWidth: 3 }}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{def.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-100 text-sm leading-tight">{def.name}</div>
            <div className="text-xs text-slate-400">{def.role}</div>
          </div>
          <button
            onClick={() => onNudge(def.id)}
            className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
          >
            Nudge ▶
          </button>
        </div>
      </div>

      {/* Status */}
      {stat && (
        <div className={cn("mx-3 mt-3 p-2.5 rounded border text-xs", statusBg)}>
          <div className={cn("font-semibold uppercase tracking-wide mb-1", statusColor)}>
            {stat.status}
          </div>
          <div className="text-slate-300 leading-relaxed">
            {stat.currentTask || "Waiting for next cycle…"}
          </div>
          <div className="text-slate-500 mt-1">
            {stat.tickCount} ticks · {stat.lastSeen ? new Date(stat.lastSeen).toLocaleTimeString() : ""}
          </div>
        </div>
      )}

      {/* Mail */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-3 min-h-0">
        <div className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Recent Mail</div>
        {mail.length === 0
          ? <div className="text-xs text-slate-600">No mail yet</div>
          : mail.map(m => (
            <div key={m.id} className={cn("text-xs p-2 mb-1.5 rounded-md border",
              m.fromAgent === agentId
                ? "bg-slate-800/50 border-slate-700/40"
                : "bg-slate-800/30 border-slate-700/20"
            )}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-slate-400">
                  {m.fromAgent === agentId ? `→ ${m.toAgent}` : `← ${m.fromAgent}`}
                </span>
                <span className={cn("ml-auto text-[10px]",
                  m.priority === "critical" ? "text-red-400" :
                  m.priority === "high"     ? "text-orange-400" :
                  m.priority === "low"      ? "text-slate-500" : "text-slate-400"
                )}>{m.priority}</span>
              </div>
              <div className="text-slate-200 leading-snug">{m.subject}</div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── Circuit Breaker Card ─────────────────────────────────────────────────────

function CircuitBreakerCard({
  circuit, onReset, loading,
}: {
  circuit: CircuitStatus | null; onReset: () => void; loading: boolean;
}) {
  if (!circuit) return null;
  const isOpen = circuit.open;
  return (
    <div className={cn("rounded-lg border p-3 transition-colors",
      isOpen ? "bg-amber-950/40 border-amber-500/40" : "bg-slate-900/60 border-slate-700/40"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isOpen ? <ShieldAlert className="w-4 h-4 text-amber-400"/> : <ShieldCheck className="w-4 h-4 text-emerald-400"/>}
          <span className="text-xs font-semibold text-slate-200">Circuit Breaker</span>
        </div>
        <div className={cn("w-2 h-2 rounded-full", isOpen ? "bg-amber-400" : "bg-emerald-500")}>
          {isOpen && <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping"/>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400 mb-2">
        <span>Status</span>       <span className={isOpen ? "text-amber-300" : "text-emerald-300"}>{isOpen ? "OPEN (paused)" : "CLOSED (ok)"}</span>
        <span>Fails</span>        <span className="text-slate-200">{circuit.consecutiveFails} / {circuit.threshold}</span>
        {isOpen && <><span>Recovers in</span><span className="text-amber-300">{circuit.recoversIn}s</span></>}
        <span>Thought cache</span><span className="text-slate-200">{circuit.thoughtCacheSize}</span>
        <span>Mail dedup</span>   <span className="text-slate-200">{circuit.mailDedupSize}</span>
      </div>
      {isOpen && (
        <button
          onClick={onReset}
          disabled={loading}
          className="w-full text-xs py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline"/> : "↩ Reset Circuit"}
        </button>
      )}
    </div>
  );
}

// ─── Collaboration Thread Panel ───────────────────────────────────────────────

function CollabThreadPanel({ threads }: { threads: CollabThread[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active    = threads.filter(t => t.active);
  const concluded = threads.filter(t => !t.active);
  const selectedThread = threads.find(t => t.id === selected);
  const defMap = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a]));

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Thread list */}
      <div className="w-56 flex-shrink-0 overflow-y-auto flex flex-col gap-1.5">
        {active.length > 0 && (
          <div className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold px-1 mb-0.5">
            Active ({active.length})
          </div>
        )}
        {active.map(t => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id === selected ? null : t.id)}
            className={cn(
              "text-left p-2.5 rounded-lg border transition-all text-xs",
              selected === t.id
                ? "bg-violet-900/40 border-violet-500/50 text-slate-100"
                : "bg-slate-900/60 border-slate-700/40 text-slate-300 hover:border-slate-600/60"
            )}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping opacity-70"/>
              </span>
              <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
              <span className="text-[10px] text-slate-500 ml-auto">{t.messageCount} msgs</span>
            </div>
            <div className="font-medium text-slate-100 leading-tight line-clamp-2 mb-1.5">{t.topic}</div>
            <div className="flex flex-wrap gap-1">
              {t.participants.slice(0, 4).map(p => (
                <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                  {defMap[p]?.emoji ?? "?"} {p}
                </span>
              ))}
            </div>
          </button>
        ))}

        {concluded.length > 0 && (
          <div className="text-[10px] text-slate-500/70 uppercase tracking-wider font-semibold px-1 mt-2 mb-0.5">
            Concluded ({concluded.length})
          </div>
        )}
        {concluded.slice(0, 8).map(t => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id === selected ? null : t.id)}
            className={cn(
              "text-left p-2.5 rounded-lg border transition-all text-xs",
              selected === t.id
                ? "bg-slate-800/80 border-slate-600/50 text-slate-100"
                : "bg-slate-900/40 border-slate-700/20 text-slate-500 hover:border-slate-700/40"
            )}
          >
            <div className="font-medium text-slate-400 leading-tight line-clamp-2 mb-1">{t.topic}</div>
            <div className="flex gap-1 flex-wrap">
              {t.participants.slice(0, 3).map(p => (
                <span key={p} className="text-[10px] text-slate-600">{defMap[p]?.emoji ?? "?"}</span>
              ))}
            </div>
          </button>
        ))}

        {threads.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600 p-4">
            <MessageSquare className="w-8 h-8 opacity-40"/>
            <p className="text-xs text-center">No collaboration threads yet</p>
            <p className="text-[10px] text-center opacity-60">Agents start discussions automatically every few hours</p>
          </div>
        )}
      </div>

      {/* Thread detail */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-900/40 rounded-xl border border-slate-700/30 overflow-hidden">
        {selectedThread ? (
          <>
            <div className="p-3 border-b border-slate-700/40">
              <div className="flex items-start gap-2">
                <div className={cn("mt-0.5 w-2 h-2 rounded-full flex-shrink-0",
                  selectedThread.active ? "bg-emerald-400" : "bg-slate-500")}/>
                <div>
                  <div className="text-sm font-semibold text-slate-100 leading-snug">{selectedThread.topic}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selectedThread.participants.map(p => {
                      const d = defMap[p];
                      return (
                        <span key={p} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                          <span>{d?.emoji}</span> {p}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
              {selectedThread.messages.map((msg, i) => {
                const d = defMap[msg.agentId];
                return (
                  <div key={i} className="flex gap-2">
                    <span className="text-base flex-shrink-0 mt-0.5">{d?.emoji ?? "🤖"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 mb-0.5">
                        <span className="text-[11px] font-semibold" style={{ color: d?.colorHex ?? "#94a3b8" }}>
                          {d?.name ?? msg.agentId}
                        </span>
                        <span className="text-[10px] text-slate-600">
                          {new Date(msg.ts).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 leading-relaxed bg-slate-800/50 rounded-lg p-2 border border-slate-700/30">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}

              {selectedThread.conclusion && (
                <div className="mt-3 p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30">
                  <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide mb-1">Conclusion</div>
                  <div className="text-xs text-emerald-200 leading-relaxed">{selectedThread.conclusion}</div>
                </div>
              )}

              {selectedThread.active && selectedThread.messages.length === 0 && (
                <div className="text-xs text-slate-500 italic">Agents are gathering…</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
            <Users className="w-8 h-8 opacity-40"/>
            <p className="text-xs">Select a thread to view the conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

function ActivityTab({
  recentMail,
  allAgents,
  circuit,
  onReset,
  circuitLoading,
}: {
  recentMail: MailItem[];
  allAgents: AgentStatus[];
  circuit: CircuitStatus | null;
  onReset: () => void;
  circuitLoading: boolean;
}) {
  const defMap = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a]));
  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* Mail feed */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto">
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Inter-Agent Mail Feed</div>
        {recentMail.slice(0, 40).map(m => {
          const from = defMap[m.fromAgent];
          const to   = defMap[m.toAgent];
          return (
            <div key={m.id} className={cn(
              "text-xs p-2.5 rounded-lg border transition-colors",
              m.priority === "critical" ? "bg-red-950/30 border-red-500/30" :
              m.priority === "high"     ? "bg-orange-950/30 border-orange-500/30" :
              "bg-slate-900/40 border-slate-700/30"
            )}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base leading-none">{from?.emoji ?? "📨"}</span>
                <span className="text-slate-300 font-medium">{m.fromAgent}</span>
                <ChevronRight className="w-3 h-3 text-slate-600"/>
                <span className="text-base leading-none">{to?.emoji ?? "📬"}</span>
                <span className="text-slate-300">{m.toAgent}</span>
                <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded",
                  m.priority === "critical" ? "text-red-300 bg-red-500/20" :
                  m.priority === "high"     ? "text-orange-300 bg-orange-500/20" :
                  m.priority === "low"      ? "text-slate-500" :
                  "text-slate-400"
                )}>{m.priority}</span>
              </div>
              <div className="text-slate-100 font-medium">{m.subject}</div>
              <div className="text-slate-500 mt-0.5 text-[10px]">
                {new Date(m.createdAt).toLocaleTimeString()}
              </div>
            </div>
          );
        })}
        {recentMail.length === 0 && (
          <div className="text-slate-600 text-xs">No mail yet — agents will start communicating soon</div>
        )}
      </div>

      {/* Right sidebar */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
        <CircuitBreakerCard circuit={circuit} onReset={onReset} loading={circuitLoading}/>

        {/* Agent roster */}
        <div className="bg-slate-900/60 rounded-lg border border-slate-700/40 p-3">
          <div className="text-xs font-semibold text-slate-300 mb-2">All Agents ({allAgents.length}/12)</div>
          <div className="space-y-1.5">
            {AGENT_DEFS.map(def => {
              const st = allAgents.find(a => a.agentId === def.id);
              return (
                <div key={def.id} className="flex items-center gap-1.5 text-[11px]">
                  <span>{def.emoji}</span>
                  <span className="text-slate-400 flex-1 truncate">{def.name}</span>
                  <span className={cn("w-1.5 h-1.5 rounded-full",
                    st?.status === "working" ? "bg-emerald-400" :
                    st?.status === "error"   ? "bg-red-400" :
                    st?.status === "idle"    ? "bg-yellow-400" :
                    "bg-slate-600"
                  )}/>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dev Agent Tab ─────────────────────────────────────────────────────────────

function DevAgentTab({ recentMail }: { recentMail: MailItem[] }) {
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string[]>([]);

  async function sendDirective() {
    if (!msg.trim()) return;
    setSending(true);
    try {
      await fetch("/api/workers/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "mandor", subject: "User Directive", body: msg.trim(), priority: "high", from: "dlavie" }),
      });
      setSent(prev => [`📨 → Mandor: ${msg.slice(0, 60)}`, ...prev.slice(0, 9)]);
      setMsg("");
    } catch { /* ignore */ }
    setSending(false);
  }

  const bossInbox = recentMail.filter(m => m.toAgent === "boss").slice(0, 12);

  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* Directive sender */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-3">
        <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-3">
          <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-violet-400"/>
            Send Directive to Mandor
          </div>
          <textarea
            value={msg}
            onChange={e => setMsg(e.target.value)}
            placeholder="Give the AI team a mission… e.g. 'Analyze all training datasets and improve quality'"
            rows={4}
            className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg p-2 text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:border-violet-500/50"
          />
          <button
            onClick={sendDirective}
            disabled={sending || !msg.trim()}
            className="mt-2 w-full text-xs py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/50 transition-colors disabled:opacity-40"
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1"/> : null}
            Dispatch Directive
          </button>
        </div>

        {sent.length > 0 && (
          <div className="bg-slate-900/40 rounded-xl border border-slate-700/20 p-3">
            <div className="text-xs text-slate-500 mb-1.5">Sent</div>
            {sent.map((s, i) => (
              <div key={i} className="text-[10px] text-slate-400 py-0.5 border-b border-slate-800/60 last:border-0">{s}</div>
            ))}
          </div>
        )}
      </div>

      {/* Boss inbox */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto">
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Boss Inbox ({bossInbox.length})</div>
        {bossInbox.map(m => (
          <div key={m.id} className={cn(
            "text-xs p-3 rounded-xl border",
            m.priority === "critical" ? "bg-red-950/30 border-red-500/30" :
            m.priority === "high"     ? "bg-orange-950/20 border-orange-500/30" :
            "bg-slate-900/40 border-slate-700/30"
          )}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-semibold text-slate-200">{m.fromAgent}</span>
              <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded",
                m.priority === "critical" ? "text-red-300 bg-red-500/20" :
                m.priority === "high"     ? "text-orange-300 bg-orange-500/20" :
                "text-slate-500"
              )}>{m.priority}</span>
            </div>
            <div className="text-slate-100 font-medium mb-1">{m.subject}</div>
            <div className="text-slate-400 leading-relaxed whitespace-pre-wrap">{m.body.slice(0, 300)}{m.body.length > 300 ? "…" : ""}</div>
            <div className="text-slate-600 mt-1 text-[10px]">{new Date(m.createdAt).toLocaleTimeString()}</div>
          </div>
        ))}
        {bossInbox.length === 0 && (
          <div className="text-slate-600 text-xs">Boss inbox empty — agents will report soon</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "office" | "activity" | "collab" | "dev";

export default function AgentPage() {
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [recentMail, setRecentMail]       = useState<MailItem[]>([]);
  const [threads, setThreads]             = useState<CollabThread[]>([]);
  const [circuit, setCircuit]             = useState<CircuitStatus | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<Tab>("office");
  const [particles, setParticles]         = useState<MailParticle[]>([]);
  const [sseStatus, setSseStatus]         = useState<"connecting" | "connected" | "error">("connecting");
  const [lastRefresh, setLastRefresh]     = useState<Date | null>(null);
  const [nudging, setNudging]             = useState<string | null>(null);
  const [circuitLoading, setCircuitLoading] = useState(false);
  const particleRef = useRef(0);
  const sseRef      = useRef<EventSource | null>(null);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, mailRes, circuitRes, threadRes] = await Promise.allSettled([
        fetch("/api/workers/status"),
        fetch("/api/workers/mail/all?limit=100"),
        fetch("/api/workers/circuit"),
        fetch("/api/workers/threads"),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        const d = await statusRes.value.json();
        setAgentStatuses(d.agents ?? []);
      }
      if (mailRes.status === "fulfilled" && mailRes.value.ok) {
        const d = await mailRes.value.json();
        setRecentMail(d.mail ?? []);
      }
      if (circuitRes.status === "fulfilled" && circuitRes.value.ok) {
        setCircuit(await circuitRes.value.json());
      }
      if (threadRes.status === "fulfilled" && threadRes.value.ok) {
        const d = await threadRes.value.json();
        setThreads(d.threads ?? []);
      }
      setLastRefresh(new Date());
    } catch { /* ignore */ }
  }, []);

  // SSE connection
  useEffect(() => {
    setSseStatus("connecting");
    const es = new EventSource("/api/workers/events");
    sseRef.current = es;

    es.onopen = () => setSseStatus("connected");
    es.onerror = () => setSseStatus("error");

    es.addEventListener("worker_tick", () => {
      fetchAll();
    });

    es.addEventListener("collab_started", (e: MessageEvent) => {
      fetchAll(); // Refresh threads
      const d = JSON.parse(e.data) as { participants?: string[]; id: string };
      if (d.participants && d.participants.length >= 2) {
        // Create a brief particle between participants
        const a = d.participants[0];
        const b = d.participants[1];
        if (a && b) {
          const pid = ++particleRef.current;
          setParticles(p => [...p, { id: pid, fromId: a, toId: b, ts: Date.now() }]);
          setTimeout(() => setParticles(p => p.filter(x => x.id !== pid)), 1200);
        }
      }
    });

    es.addEventListener("collab_message", () => {
      fetchAll();
    });

    es.addEventListener("collab_concluded", () => {
      fetchAll();
    });

    // Mail particle on agent mail events
    const origAddListener = es.addEventListener.bind(es);
    origAddListener("worker_tick", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as { id?: string };
        if (d.id) {
          // Pick a random target for particle effect
          const defs = AGENT_DEFS.filter(a => a.id !== d.id);
          const target = defs[Math.floor(Math.random() * defs.length)];
          if (target && Math.random() < 0.25) {
            const pid = ++particleRef.current;
            setParticles(p => [...p, { id: pid, fromId: d.id!, toId: target.id, ts: Date.now() }]);
            setTimeout(() => setParticles(p => p.filter(x => x.id !== pid)), 1100);
          }
        }
      } catch { /* ignore */ }
    });

    fetchAll();
    const interval = setInterval(fetchAll, 8000);
    return () => {
      es.close();
      clearInterval(interval);
      sseRef.current = null;
    };
  }, [fetchAll]);

  // Nudge agent
  async function nudgeAgent(id: string) {
    setNudging(id);
    try {
      await fetch(`/api/workers/${id}/nudge`, { method: "POST" });
      setTimeout(fetchAll, 2000);
    } catch { /* ignore */ }
    setTimeout(() => setNudging(null), 2000);
  }

  // Reset circuit
  async function resetCircuit() {
    setCircuitLoading(true);
    try {
      await fetch("/api/workers/circuit/reset", { method: "POST" });
      setTimeout(fetchAll, 500);
    } catch { /* ignore */ }
    setTimeout(() => setCircuitLoading(false), 1000);
  }

  const activeThreadCount = threads.filter(t => t.active).length;
  const workingCount      = agentStatuses.filter(a => a.status === "working").length;
  const circuitOpen       = circuit?.open ?? false;

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: "office",   label: "Office",       icon: <Building2 className="w-3.5 h-3.5"/>     },
    { id: "activity", label: "Activity",     icon: <Activity  className="w-3.5 h-3.5"/>     },
    { id: "collab",   label: "Collab",       icon: <Users     className="w-3.5 h-3.5"/>, badge: activeThreadCount },
    { id: "dev",      label: "Dev Console",  icon: <TerminalSquare className="w-3.5 h-3.5"/>},
  ];

  return (
    <div className="flex flex-col h-screen bg-[#050c18] text-slate-200 font-['Space_Mono',monospace] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-slate-800/60 bg-slate-900/30 backdrop-blur-sm flex items-center gap-3">
        <Building2 className="w-5 h-5 text-violet-400"/>
        <div>
          <h1 className="text-sm font-bold text-slate-100 leading-none">Agent Command Center</h1>
          <p className="text-[10px] text-slate-500 mt-0.5">12 autonomous AI agents · DLavie OS</p>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-2 ml-4">
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-mono",
            workingCount > 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-800/50 border-slate-700/30 text-slate-500"
          )}>
            {workingCount} working
          </span>
          {activeThreadCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400 font-mono">
              {activeThreadCount} meeting{activeThreadCount > 1 ? "s" : ""}
            </span>
          )}
          {circuitOpen && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono animate-pulse">
              circuit open
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* SSE badge */}
          <div className={cn("flex items-center gap-1.5 text-[10px]",
            sseStatus === "connected" ? "text-emerald-400" :
            sseStatus === "error"     ? "text-red-400" : "text-yellow-400"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full",
              sseStatus === "connected" ? "bg-emerald-400" :
              sseStatus === "error"     ? "bg-red-400" : "bg-yellow-400"
            )}/>
            {sseStatus === "connected" ? "live" : sseStatus}
          </div>
          <button onClick={fetchAll} className="text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className="w-3.5 h-3.5"/>
          </button>
          {lastRefresh && (
            <span className="text-[10px] text-slate-600 hidden sm:block">
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 px-4 py-1.5 border-b border-slate-800/40 flex gap-0.5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors relative",
              activeTab === tab.id
                ? "bg-slate-800/80 text-slate-100 border border-slate-700/50"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"
            )}
          >
            {tab.icon}
            {tab.label}
            {(tab.badge ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 text-[9px] bg-violet-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        {activeTab === "office" && (
          <div className="flex gap-3 h-full min-h-0">
            {/* SVG Office */}
            <div className="flex-1 min-w-0 bg-slate-900/20 rounded-xl border border-slate-800/50 overflow-hidden">
              <OfficeScene
                agentStatuses={agentStatuses}
                selectedAgent={selectedAgent}
                onSelectAgent={id => setSelectedAgent(id === selectedAgent ? null : id)}
                particles={particles}
                activeThreads={threads}
              />
            </div>

            {/* Agent detail panel */}
            <div className="w-64 flex-shrink-0 bg-slate-900/50 rounded-xl border border-slate-800/50 overflow-hidden flex flex-col">
              <AgentDetailPanel
                agentId={selectedAgent}
                agentStatuses={agentStatuses}
                recentMail={recentMail}
                onNudge={nudgeAgent}
              />
            </div>
          </div>
        )}

        {activeTab === "activity" && (
          <ActivityTab
            recentMail={recentMail}
            allAgents={agentStatuses}
            circuit={circuit}
            onReset={resetCircuit}
            circuitLoading={circuitLoading}
          />
        )}

        {activeTab === "collab" && (
          <div className="h-full min-h-0">
            <CollabThreadPanel threads={threads}/>
          </div>
        )}

        {activeTab === "dev" && (
          <DevAgentTab recentMail={recentMail}/>
        )}
      </div>
    </div>
  );
}
