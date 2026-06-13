/**
 * DLavie OS — Agent Command Center v4
 * 12 autonomous AI agents · cinematic isometric HQ · 8 new features
 * A: Heatmap | B: Thought Bubbles | C: Network Graph | D: Agent Chat
 * E: Mission Board | F: Memory Inspector | G: Toasts | H: Scorecard
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  Bot, Brain, BookOpen, Shield, BarChart2, Wrench, Star, Radio,
  Mail, Activity, TerminalSquare, Zap, RefreshCw, Send,
  AlertTriangle, CheckCircle2, Loader2, Sparkles, ChevronRight,
  RotateCcw, ShieldAlert, ShieldCheck, MessageSquare,
  Users, FlaskConical, Rocket, Eye, Building2,
  Target, Inbox, Cpu, TrendingUp, Search, Trash2, X,
  PlusCircle, Network, BarChart3, ClipboardList, Database,
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

// Dedicated collaboration room position (SVG coordinates)
const COLLAB_ROOM_POS: [number, number] = [800, 388];

const ZONE_GLOWS = [
  { cx: 232, cy: 218, rx: 148, ry: 78,  fill: "#a855f7" },
  { cx: 460, cy: 155, rx: 90,  ry: 48,  fill: "#10b981" },
  { cx: 728, cy: 112, rx: 72,  ry: 42,  fill: "#eab308" },
  { cx: 416, cy: 264, rx: 112, ry: 56,  fill: "#3b82f6" },
  { cx: 240, cy: 370, rx: 122, ry: 68,  fill: "#ec4899" },
  { cx: 596, cy: 242, rx: 98,  ry: 68,  fill: "#f97316" },
  { cx: 444, cy: 408, rx: 60,  ry: 36,  fill: "#14b8a6" },
];

const ZONE_LABELS = [
  { x: 72,  y: 136, label: "Research Lab",   color: "#c084fc" },
  { x: 395, y: 96,  label: "Command Center", color: "#34d399" },
  { x: 655, y: 58,  label: "Executive Suite",color: "#fde047" },
  { x: 295, y: 218, label: "Ops Hub",        color: "#60a5fa" },
  { x: 95,  y: 296, label: "Creative Studio",color: "#f472b6" },
  { x: 497, y: 138, label: "Infra Bay",      color: "#fb923c" },
  { x: 375, y: 360, label: "Comms",          color: "#2dd4bf" },
];

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

interface CollabMessage { agentId: string; content: string; ts: number; }
interface CollabThread {
  id: string; topic: string; initiator: string; participants: string[];
  messageCount: number; messages: CollabMessage[];
  startedAt: number; concludedAt: number | null;
  conclusion: string | null; active: boolean;
}

interface CircuitStatus {
  open: boolean; consecutiveFails: number; opensAt: number | null;
  recoversIn: number | null; threshold: number; cooldownMs: number;
  thoughtCacheSize: number; mailDedupSize: number;
}

interface MailParticle { id: number; fromId: string; toId: string; ts: number; }

interface Mission {
  id: string; title: string; description: string; assignedTo: string;
  priority: "low" | "normal" | "high" | "critical";
  status: "queue" | "working" | "done";
  createdAt: string; updatedAt: string;
}

interface AgentMemory {
  id: number; category: string; content: string; importance: number;
  tags: string | null; usageCount: number; createdAt: string;
}

interface ScorecardRow {
  agentId: string; displayName: string; tickCount: number;
  mailSent: number; mailReceived: number; status: string;
  lastSeen: string | null; currentTask: string | null;
}

interface HeatmapData { buckets: Record<string, number[]>; since: string; }

// ─── Enhanced Isometric Office Props ─────────────────────────────────────────

/** Generic isometric box: top face + left + right sides */
function IsoBox({ cx, cy, w = 20, d = 16, h = 20, topColor = "#1e293b", leftColor = "#0f172a", rightColor = "#162032" }: {
  cx: number; cy: number; w?: number; d?: number; h?: number;
  topColor?: string; leftColor?: string; rightColor?: string;
}) {
  const hw = w / 2; const hd = d / 2;
  const top   = `${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}`;
  const left  = `${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx - hw},${cy + h}`;
  const right = `${cx + hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx + hw},${cy + h}`;
  return (
    <g>
      <polygon points={top}   fill={topColor}   />
      <polygon points={left}  fill={leftColor}  />
      <polygon points={right} fill={rightColor} />
    </g>
  );
}

/** Server rack — tall box with blinking lights on front */
function ServerRack({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <IsoBox cx={cx} cy={cy} w={14} d={10} h={36} topColor="#0f172a" leftColor="#0a0f1a" rightColor="#111827"/>
      {/* LED strips on right face */}
      {[0,8,16,24].map((yoff, i) => (
        <rect key={i} x={cx + 1} y={cy + yoff + 4} width={5} height={2} rx={0.5}
          fill={i % 3 === 0 ? "#22c55e" : i % 3 === 1 ? "#3b82f6" : "#f97316"} opacity={0.9}>
          <animate attributeName="opacity" values="0.9;0.3;0.9" dur={`${1.2 + i * 0.3}s`} repeatCount="indefinite"/>
        </rect>
      ))}
      {/* Rack unit lines on left face */}
      {[6,12,20,28].map((yoff, i) => (
        <line key={i} x1={cx - 7} y1={cy + yoff} x2={cx} y2={cy + yoff + 5}
          stroke="#1e293b" strokeWidth={0.5} opacity={0.6}/>
      ))}
    </g>
  );
}

/** Bookshelf — wide box with colored book spines on top */
function Bookshelf({ cx, cy }: { cx: number; cy: number }) {
  const bookColors = ["#3b82f6","#ef4444","#22c55e","#f59e0b","#a855f7","#14b8a6","#ec4899","#f97316"];
  return (
    <g>
      <IsoBox cx={cx} cy={cy} w={28} d={10} h={22} topColor="#1e293b" leftColor="#111827" rightColor="#162032"/>
      {/* Book spines on top face */}
      {bookColors.map((c, i) => {
        const bx = cx - 12 + i * 3.2;
        const by = cy - 5 + i * 0.5;
        return (
          <g key={i}>
            <rect x={bx} y={by - 3} width={2.5} height={5} rx={0.3} fill={c} opacity={0.85}/>
          </g>
        );
      })}
    </g>
  );
}

/** Water cooler */
function WaterCooler({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy + 8} rx={7} ry={3.5} fill="#1e293b"/>
      <rect x={cx - 7} y={cy - 6} width={14} height={14} rx={2} fill="#0ea5e9" opacity={0.3}/>
      <rect x={cx - 6} y={cy - 5} width={12} height={12} rx={1.5} fill="#0c4a6e" stroke="#0ea5e9" strokeWidth={0.5}/>
      <ellipse cx={cx} cy={cy - 6} rx={5} ry={7} fill="#0ea5e9" opacity={0.6}/>
      <ellipse cx={cx} cy={cy - 6} rx={4} ry={6} fill="#38bdf8" opacity={0.8}>
        <animate attributeName="opacity" values="0.8;0.5;0.8" dur="3s" repeatCount="indefinite"/>
      </ellipse>
      <rect x={cx - 2} y={cy + 3} width={1.5} height={2} rx={0.5} fill="#22c55e"/>
    </g>
  );
}

/** Printer station */
function PrinterStation({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <IsoBox cx={cx} cy={cy} w={18} d={12} h={10} topColor="#1e293b" leftColor="#111827" rightColor="#162032"/>
      {/* Paper tray */}
      <ellipse cx={cx} cy={cy - 5} rx={6} ry={3} fill="#f8fafc" opacity={0.9}/>
      <ellipse cx={cx} cy={cy - 4.5} rx={5} ry={2.5} fill="#e2e8f0" opacity={0.7}/>
      {/* LED indicator */}
      <circle cx={cx + 4} cy={cy - 9} r={1.5} fill="#22c55e">
        <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite"/>
      </circle>
    </g>
  );
}

/** Network cable traces on the floor */
function CableTraces() {
  return (
    <g opacity={0.18}>
      <path d={`M564,210 L628,300`} stroke="#06b6d4" strokeWidth={1} strokeDasharray="3 2"/>
      <path d={`M564,210 L460,165`} stroke="#f97316" strokeWidth={1} strokeDasharray="3 2"/>
      <path d={`M628,300 L466,265`} stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 2"/>
    </g>
  );
}

/** Whiteboard on wall (Creative Studio) */
function Whiteboard({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <rect x={cx - 20} y={cy - 22} width={40} height={24} rx={2} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={0.8}/>
      <line x1={cx - 15} y1={cy - 16} x2={cx + 8}  y2={cy - 14} stroke="#3b82f6" strokeWidth={1.2} opacity={0.7}/>
      <line x1={cx - 15} y1={cy - 10} x2={cx + 5}  y2={cy - 8}  stroke="#ef4444" strokeWidth={1} opacity={0.6}/>
      <line x1={cx - 15} y1={cy - 4}  x2={cx + 12} y2={cy - 2}  stroke="#10b981" strokeWidth={1} opacity={0.6}/>
      <rect x={cx - 20} y={cy + 2} width={40} height={4} rx={1} fill="#1e293b"/>
      <text x={cx} y={cy - 25} textAnchor="middle" fontSize={5} fill="#64748b">WHITEBOARD</text>
    </g>
  );
}

/** Reception desk at the front of the office */
function ReceptionDesk({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <IsoBox cx={cx} cy={cy} w={52} d={18} h={12} topColor="#0f1e33" leftColor="#0a1222" rightColor="#0d1a2e"/>
      {/* Glass partition */}
      <polygon
        points={`${cx - 26},${cy} ${cx + 26},${cy} ${cx + 26},${cy - 16} ${cx - 26},${cy - 16}`}
        fill="#0ea5e9" opacity={0.08}/>
      <line x1={cx - 26} y1={cy - 16} x2={cx + 26} y2={cy - 16} stroke="#0ea5e9" strokeWidth={0.5} opacity={0.4}/>
      {/* Name plate */}
      <rect x={cx - 14} y={cy - 6} width={28} height={5} rx={1} fill="#0ea5e9" opacity={0.2}/>
      <text x={cx} y={cy - 2.5} textAnchor="middle" fontSize={4} fill="#7dd3fc">DLavie OS HQ</text>
      {/* Monitor */}
      <rect x={cx + 8} y={cy - 22} width={14} height={10} rx={1} fill="#0f172a"/>
      <rect x={cx + 9} y={cy - 21} width={12} height={8} rx={0.5} fill="#1e3a5f"/>
      <text x={cx + 15} y={cy - 15} textAnchor="middle" fontSize={3.5} fill="#34d399">●</text>
    </g>
  );
}

/** Ceiling light panel */
function CeilingLight({ cx, cy, color = "#7dd3fc" }: { cx: number; cy: number; color?: string }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={16} ry={8} fill={color} opacity={0.06}>
        <animate attributeName="opacity" values="0.06;0.12;0.06" dur="4s" repeatCount="indefinite"/>
      </ellipse>
      <ellipse cx={cx} cy={cy} rx={6} ry={3} fill={color} opacity={0.18}/>
      <line x1={cx} y1={cy - 3} x2={cx} y2={cy - 14} stroke={color} strokeWidth={0.5} opacity={0.3}/>
    </g>
  );
}

/** Company sign on "wall" */
function CompanySign() {
  return (
    <g>
      <rect x={362} y={28} width={100} height={24} rx={4} fill="#050c18" stroke="#1e3a5f" strokeWidth={1}/>
      <text x={412} y={38} textAnchor="middle" fontSize={8} fill="#10b981" fontFamily="monospace" fontWeight="bold">DLavie OS</text>
      <text x={412} y={48} textAnchor="middle" fontSize={5} fill="#34d399" fontFamily="monospace">AI COMMAND CENTER v4</text>
      <rect x={362} y={28} width={100} height={24} rx={4} fill="none" stroke="#10b981" strokeWidth={0.5} opacity={0.4}>
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="3s" repeatCount="indefinite"/>
      </rect>
    </g>
  );
}

// ─── Isometric Desk ──────────────────────────────────────────────────────────

function IsoDesk({ cx, cy, deskColor, active, collaborating }: {
  cx: number; cy: number; deskColor: string; active: boolean; collaborating?: boolean;
}) {
  const w = 46; const h = 46; const th = 10;
  const hw = w / 2; const hh = h / 2;
  const topF = active ? deskColor : `${deskColor}99`;
  const top   = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  const left  = `${cx - hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh + th} ${cx - hw},${cy + th}`;
  const right = `${cx + hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh + th} ${cx + hw},${cy + th}`;
  return (
    <>
      {collaborating && (
        <ellipse cx={cx} cy={cy + 4} rx={hw + 8} ry={hh + 4}
          fill="none" stroke="#a78bfa" strokeWidth={1.5} opacity={0.6}>
          <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite"/>
        </ellipse>
      )}
      <polygon points={top}   fill={topF}          />
      <polygon points={left}  fill="#00000055"      />
      <polygon points={right} fill="#00000033"      />
      {/* Monitor */}
      <rect x={cx - 8} y={cy - hh - 12} width={16} height={10} rx={1} fill="#0f172a"/>
      <rect x={cx - 7} y={cy - hh - 11} width={14} height={8}  rx={0.5} fill={active ? "#1e3a5f" : "#111827"}/>
      {active && <rect x={cx - 6} y={cy - hh - 10} width={4} height={1} fill={deskColor} opacity={0.8}/>}
      {active && <rect x={cx - 6} y={cy - hh - 8}  width={7} height={1} fill={deskColor} opacity={0.5}/>}
      {/* Keyboard */}
      <rect x={cx - 7} y={cy - hh + 2} width={14} height={4} rx={0.5} fill="#0f172a" opacity={0.7}/>
      {/* Coffee cup */}
      <circle cx={cx + 10} cy={cy - hh + 4} r={2} fill="#7c3aed" opacity={0.7}/>
    </>
  );
}

// ─── Agent Character with Thought Bubble ─────────────────────────────────────

function AgentChar({ cx, cy, def, status, collaborating, hovered, thoughtText, emotion }: {
  cx: number; cy: number; def: typeof AGENT_DEFS[number];
  status?: AgentStatus; collaborating?: boolean; hovered?: boolean;
  thoughtText?: string; emotion?: string;
}) {
  const isWorking = status?.status === "working";
  const isError   = status?.status === "error";
  const isOffline = !status;
  const color = def.colorHex;

  return (
    <motion.g initial={{ opacity: 0, y: -4 }} animate={{ opacity: isOffline ? 0.35 : 1, y: 0 }} transition={{ duration: 0.4 }}>
      {isWorking && (
        <ellipse cx={cx} cy={cy + 2} rx={14} ry={7} fill={color} opacity={0.18}>
          <animate attributeName="opacity" values="0.18;0.38;0.18" dur="2s" repeatCount="indefinite"/>
        </ellipse>
      )}
      {collaborating && (
        <ellipse cx={cx} cy={cy + 2} rx={16} ry={8} fill="none" stroke="#a78bfa" strokeWidth={1.2} opacity={0.7}>
          <animate attributeName="opacity" values="0.7;1;0.7" dur="1s" repeatCount="indefinite"/>
        </ellipse>
      )}
      <ellipse cx={cx} cy={cy + 4} rx={9} ry={5} fill={`${color}55`}/>
      <circle cx={cx} cy={cy - 2} r={8} fill={color}/>
      <circle cx={cx} cy={cy - 2} r={6.5} fill={`${color}cc`}/>
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize={8} style={{ userSelect: "none" }}>{def.emoji}</text>
      <circle cx={cx + 7} cy={cy - 8} r={2.5}
        fill={isError ? "#ef4444" : isOffline ? "#475569" : isWorking ? "#22c55e" : "#eab308"}>
        {isWorking && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>}
      </circle>
      {/* Thought bubble when hovered */}
      {hovered && thoughtText && (
        <g>
          <rect x={cx - 50} y={cy - 46} width={100} height={20} rx={4} fill="#1e293b" stroke={color} strokeWidth={0.8}/>
          <polygon points={`${cx},${cy - 26} ${cx - 4},${cy - 30} ${cx + 4},${cy - 30}`} fill="#1e293b"/>
          <text x={cx} y={cy - 34} textAnchor="middle" fontSize={5} fill="#cbd5e1" style={{ userSelect: "none" }}>
            {thoughtText.slice(0, 32)}{thoughtText.length > 32 ? "…" : ""}
          </text>
        </g>
      )}
      {/* Emotion badge — floating top-right of character */}
      {emotion && (
        <g>
          <circle cx={cx + 13} cy={cy - 13} r={7.5} fill="#020810" stroke={color} strokeWidth={0.6} opacity={0.95}/>
          <text x={cx + 13} y={cy - 9} textAnchor="middle" fontSize={9} style={{ userSelect: "none" }}>{emotion}</text>
        </g>
      )}
    </motion.g>
  );
}

// ─── Mail Particle ────────────────────────────────────────────────────────────

function MailParticleAnim({ from, to }: { from: [number, number]; to: [number, number] }) {
  const mx = (from[0] + to[0]) / 2;
  const my = Math.min(from[1], to[1]) - 38;
  const path = `M${from[0]},${from[1]} Q${mx},${my} ${to[0]},${to[1]}`;
  return (
    <g>
      <path d={path} fill="none" stroke="none"/>
      <circle r={3} fill="#a78bfa" opacity={0.85}>
        <animateMotion dur="1.1s" fill="freeze" path={path}/>
        <animate attributeName="opacity" values="0;0.85;0" dur="1.1s" fill="freeze"/>
      </circle>
      <circle r={1.5} fill="#fff" opacity={0.5}>
        <animateMotion dur="1.1s" fill="freeze" path={path}/>
        <animate attributeName="opacity" values="0;0.5;0" dur="1.1s" fill="freeze"/>
      </circle>
    </g>
  );
}

// ─── Conference Table ─────────────────────────────────────────────────────────

function ConferenceTable({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy}     rx={52} ry={28} fill="#1e293b" stroke="#334155" strokeWidth={1.5}/>
      <ellipse cx={cx} cy={cy - 4} rx={52} ry={28} fill="#1e3a5f" stroke="#3b82f6" strokeWidth={1} opacity={0.8}/>
      <ellipse cx={cx} cy={cy - 4} rx={40} ry={20} fill="#0f172a" stroke="#1d4ed8" strokeWidth={0.8}/>
      <ellipse cx={cx} cy={cy - 4} rx={56} ry={32} fill="none" stroke="#6366f1" strokeWidth={2} opacity={0.4}>
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite"/>
      </ellipse>
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize={7} fill="#818cf8" style={{ userSelect: "none" }}>MEETING</text>
      {[-36, 0, 36].map((dx, i) => (
        <ellipse key={i} cx={cx + dx} cy={cy + 22} rx={8} ry={4} fill="#1e293b" stroke="#334155" strokeWidth={0.8}/>
      ))}
      {[-36, 0, 36].map((dx, i) => (
        <ellipse key={i + 3} cx={cx + dx} cy={cy - 28} rx={8} ry={4} fill="#1e293b" stroke="#334155" strokeWidth={0.8}/>
      ))}
    </g>
  );
}

// ─── Enhanced Office Scene ───────────────────────────────────────────────────

function OfficeScene({ agentStatuses, selectedAgent, onSelectAgent, particles, activeThreads, agentEmotions, agentPositions }: {
  agentStatuses: AgentStatus[];
  selectedAgent: string | null;
  onSelectAgent: (id: string) => void;
  particles: MailParticle[];
  activeThreads: CollabThread[];
  agentEmotions: Map<string, { emoji: string; reason: string }>;
  agentPositions: Map<string, { state: string; target?: string }>;
}) {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const statusMap = new Map(agentStatuses.map(a => [a.agentId, a]));
  const collaboratingAgents = new Set<string>();
  activeThreads.filter(t => t.active).forEach(t => t.participants.forEach(p => collaboratingAgents.add(p)));
  const hasMeeting = activeThreads.some(t => t.active);

  return (
    <svg viewBox="0 0 920 540" className="w-full h-full select-none"
      style={{ background: "linear-gradient(135deg, #020810 0%, #050c18 40%, #030913 100%)" }}>
      <defs>
        <radialGradient id="roomGlow" cx="50%" cy="45%" r="55%">
          <stop offset="0%"   stopColor="#1e3a5f" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#020810" stopOpacity="0"/>
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="softglow">
          <feGaussianBlur stdDeviation="5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Ambient room glow */}
      <ellipse cx={460} cy={270} rx={420} ry={240} fill="url(#roomGlow)"/>

      {/* Floor tiles — detailed grid */}
      {Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 15 }, (_, col) => {
          const cx = 460 + (col - 7) * 60 - row * 30;
          const cy = 270 + row * 24 + (col - 7) * 12;
          const shade = (row + col) % 2 === 0 ? "#080f1c" : "#0a1424";
          return (
            <polygon key={`${row}-${col}`}
              points={`${cx},${cy - 12} ${cx + 30},${cy} ${cx},${cy + 12} ${cx - 30},${cy}`}
              fill={shade} stroke="#0b1525" strokeWidth={0.4}/>
          );
        })
      )}

      {/* Zone area rugs */}
      <ellipse cx={232} cy={230} rx={130} ry={65} fill="#4c1d95" opacity={0.04}/>
      <ellipse cx={460} cy={165} rx={80}  ry={42} fill="#064e3b" opacity={0.06}/>
      <ellipse cx={600} cy={248} rx={95}  ry={62} fill="#7c2d12" opacity={0.04}/>
      <ellipse cx={420} cy={272} rx={105} ry={52} fill="#1e3a8a" opacity={0.04}/>
      <ellipse cx={240} cy={375} rx={115} ry={60} fill="#831843" opacity={0.04}/>

      {/* Ceiling lights — above each zone */}
      <CeilingLight cx={232} cy={180} color="#a855f7"/>
      <CeilingLight cx={460} cy={118} color="#10b981"/>
      <CeilingLight cx={728} cy={78}  color="#eab308"/>
      <CeilingLight cx={416} cy={228} color="#3b82f6"/>
      <CeilingLight cx={240} cy={328} color="#ec4899"/>
      <CeilingLight cx={596} cy={200} color="#f97316"/>
      <CeilingLight cx={444} cy={368} color="#14b8a6"/>

      {/* Zone glow overlays */}
      {ZONE_GLOWS.map((z, i) => (
        <ellipse key={i} cx={z.cx} cy={z.cy} rx={z.rx} ry={z.ry} fill={z.fill} opacity={0.05}/>
      ))}

      {/* Zone labels */}
      {ZONE_LABELS.map((z, i) => (
        <g key={i}>
          <rect x={z.x - 2} y={z.y - 10} width={z.label.length * 5.5 + 4} height={13}
            rx={3} fill="#020810" opacity={0.75}/>
          <text x={z.x} y={z.y} fontSize={7.5} fill={z.color} opacity={0.7} fontFamily="monospace"
            style={{ userSelect: "none" }}>{z.label}</text>
        </g>
      ))}

      {/* Company sign */}
      <CompanySign/>

      {/* ── Office Props ─────────────────────────────────── */}

      {/* Server racks — Infra Bay */}
      <ServerRack cx={538} cy={202}/>
      <ServerRack cx={554} cy={212}/>
      <ServerRack cx={615} cy={260}/>

      {/* Network cable traces */}
      <CableTraces/>

      {/* Printer near Engineer */}
      <PrinterStation cx={585} cy={178}/>

      {/* Bookshelf near Librarian */}
      <Bookshelf cx={148} cy={368}/>

      {/* Whiteboard in Creative Studio */}
      <Whiteboard cx={110} cy={370}/>

      {/* Reception desk at front */}
      <ReceptionDesk cx={460} cy={490}/>

      {/* Water cooler near Break Room */}
      <WaterCooler cx={790} cy={182}/>

      {/* Enhanced plants */}
      {[
        [72, 460, "#166534"], [90, 395, "#15803d"], [808, 158, "#166534"], [848, 438, "#15803d"],
        [880, 340, "#14532d"], [50, 300, "#166534"], [740, 460, "#15803d"],
      ].map(([px, py, color], i) => (
        <g key={i}>
          <ellipse cx={px as number} cy={(py as number) + 8} rx={9} ry={4} fill="#14532d"/>
          <circle  cx={px as number} cy={py as number}     r={8}  fill={color as string}/>
          <circle  cx={(px as number) - 5} cy={(py as number) - 4} r={5} fill="#15803d"/>
          <circle  cx={(px as number) + 5} cy={(py as number) - 4} r={5} fill="#15803d"/>
          <circle  cx={px as number} cy={(py as number) - 8} r={4} fill="#16a34a"/>
        </g>
      ))}

      {/* Break room — enhanced */}
      <g>
        <rect x={806} y={105} width={98} height={62} rx={5} fill="#080f1c" stroke="#1e293b" strokeWidth={1}/>
        <text x={855} y={119} textAnchor="middle" fontSize={7} fill="#334155" style={{ userSelect: "none" }}>BREAK ROOM</text>
        {/* Coffee machine */}
        <rect x={818} y={123} width={16} height={18} rx={2} fill="#1e293b" stroke="#334155" strokeWidth={0.5}/>
        <rect x={820} y={125} width={12} height={7}  rx={1} fill="#0f172a"/>
        <circle cx={826} cy={137} r={3} fill="#7c3aed" opacity={0.8}>
          <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite"/>
        </circle>
        {/* Round table */}
        <ellipse cx={862} cy={140} rx={20} ry={10} fill="#0f172a" stroke="#1e293b" strokeWidth={0.8}/>
        <ellipse cx={862} cy={138} rx={18} ry={9}  fill="#1e293b"/>
        {/* Chairs */}
        {[[-14,8],[14,8],[0,-8]].map(([dx, dy], i) => (
          <ellipse key={i} cx={862 + dx} cy={138 + dy} rx={6} ry={3} fill="#0f172a" stroke="#334155" strokeWidth={0.5}/>
        ))}
        {/* Mugs on table */}
        <circle cx={856} cy={136} r={2} fill="#7c3aed" opacity={0.7}/>
        <circle cx={868} cy={139} r={2} fill="#0ea5e9" opacity={0.7}/>
      </g>

      {/* Conference table (when meeting active) */}
      <AnimatePresence>
        {hasMeeting && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ConferenceTable cx={460} cy={290}/>
          </motion.g>
        )}
      </AnimatePresence>

      {/* ── Dedicated Collaboration Room (bottom-right) ─────────────────────── */}
      <g>
        {/* Room boundary */}
        <rect x={728} y={335} width={168} height={118} rx={7}
          fill="#030c1c" stroke="#1e3a5f" strokeWidth={1.5} opacity={0.95}/>
        <text x={812} y={350} textAnchor="middle" fontSize={7} fill="#4f6791"
          fontFamily="monospace" style={{ userSelect: "none" }}>COLLAB ROOM</text>
        {/* Round table */}
        <ellipse cx={812} cy={393} rx={44} ry={26} fill="#0f172a" stroke="#3b82f6" strokeWidth={1.2}/>
        <ellipse cx={812} cy={389} rx={40} ry={22} fill="#1e293b"/>
        {/* Pulsing aura when meeting active */}
        <ellipse cx={812} cy={389} rx={48} ry={30} fill="none"
          stroke={hasMeeting ? "#6366f1" : "#1e3a5f"} strokeWidth={1.5} opacity={hasMeeting ? 0.7 : 0.3}>
          {hasMeeting && <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/>}
        </ellipse>
        <text x={812} y={392} textAnchor="middle" fontSize={6.5} fill="#818cf8"
          fontFamily="monospace" style={{ userSelect: "none" }}>{hasMeeting ? "MEETING" : "STANDBY"}</text>
        {/* 6 chairs around table */}
        {[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const r = (deg * Math.PI) / 180;
          return (
            <ellipse key={i}
              cx={Math.round(812 + 54 * Math.cos(r))}
              cy={Math.round(389 + 33 * Math.sin(r))}
              rx={7} ry={4} fill="#1e293b" stroke="#334155" strokeWidth={0.6}/>
          );
        })}
        {/* Whiteboard on wall */}
        <rect x={734} y={342} width={38} height={22} rx={2} fill="#0f172a" stroke="#334155" strokeWidth={0.6}/>
        <rect x={736} y={344} width={34} height={18} rx={1} fill="#1e293b"/>
        <line x1={738} y1={349} x2={766} y2={349} stroke="#6366f1" strokeWidth={0.5} opacity={0.6}/>
        <line x1={738} y1={353} x2={760} y2={353} stroke="#6366f1" strokeWidth={0.5} opacity={0.4}/>
      </g>

      {/* Mail particles */}
      {particles.map(p => {
        const fromPos = DESK_POS[p.fromId]; const toPos = DESK_POS[p.toId];
        if (!fromPos || !toPos) return null;
        return <MailParticleAnim key={p.id} from={fromPos} to={toPos}/>;
      })}

      {/* Collaboration beams */}
      {hasMeeting && activeThreads.filter(t => t.active).flatMap(t => {
        const beams: React.ReactNode[] = [];
        for (let i = 0; i < t.participants.length - 1; i++) {
          const a = DESK_POS[t.participants[i]!]; const b = DESK_POS[t.participants[i + 1]!];
          if (!a || !b) continue;
          beams.push(
            <line key={`beam_${i}`} x1={a[0]} y1={a[1] - 20} x2={b[0]} y2={b[1] - 20}
              stroke="#6366f1" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.5}>
              <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2s" repeatCount="indefinite"/>
            </line>
          );
        }
        return beams;
      })}

      {/* Desks + Agents (desks fixed, characters animate to target position) */}
      {AGENT_DEFS.map(def => {
        const deskPos = DESK_POS[def.id]; if (!deskPos) return null;
        const [cx, cy] = deskPos;
        const status     = statusMap.get(def.id);
        const isActive   = status?.status === "working";
        const isCollab   = collaboratingAgents.has(def.id);
        const isSelected = selectedAgent === def.id;
        const isHovered  = hoveredAgent === def.id;
        const emotion    = agentEmotions.get(def.id);

        // Compute visual target position for walking animation
        const posState   = agentPositions.get(def.id);
        let vx = cx; let vy = cy;
        if (posState?.state === "collab_room") {
          [vx, vy] = COLLAB_ROOM_POS;
        } else if (posState?.state === "visiting" && posState.target) {
          const td = DESK_POS[posState.target];
          if (td) { vx = Math.round((cx + td[0]) / 2); vy = Math.round((cy + td[1]) / 2) - 8; }
        }

        return (
          <g key={def.id} style={{ cursor: "pointer" }}
            onClick={() => onSelectAgent(def.id)}
            onMouseEnter={() => setHoveredAgent(def.id)}
            onMouseLeave={() => setHoveredAgent(null)}>

            {/* Selection ring stays at desk */}
            {isSelected && (
              <ellipse cx={cx} cy={cy + 4} rx={34} ry={20} fill="none"
                stroke={def.colorHex} strokeWidth={2} opacity={0.9}/>
            )}
            {/* Desk is always fixed */}
            <IsoDesk cx={cx} cy={cy} deskColor={def.deskHex} active={isActive} collaborating={isCollab}/>

            {/* Agent character + name label animate smoothly to target */}
            <motion.g
              animate={{ x: vx - cx, y: vy - cy }}
              transition={{ duration: 1.8, ease: "easeInOut" }}>
              <AgentChar cx={cx} cy={cy - 26} def={def} status={status} collaborating={isCollab}
                hovered={isHovered} thoughtText={status?.currentTask ?? undefined}
                emotion={emotion?.emoji}/>
              <rect x={cx - 22} y={cy - 52} width={44} height={12} rx={3} fill="#020810" opacity={0.9}/>
              <text x={cx} y={cy - 43} textAnchor="middle" fontSize={6.5}
                fill={isActive ? def.colorHex : "#475569"} fontFamily="monospace"
                style={{ userSelect: "none" }}>{def.name}</text>
            </motion.g>
          </g>
        );
      })}

      {/* Legend */}
      <g>
        {[["🟢","Working"],["🟡","Idle"],["🔴","Error"]].map(([dot, label], i) => (
          <text key={i} x={14} y={530 - i * 14} fontSize={8} fill="#475569" style={{ userSelect: "none" }}>
            {dot} {label}
          </text>
        ))}
      </g>
    </svg>
  );
}

// ─── Agent Chat Modal [D] ─────────────────────────────────────────────────────

function AgentChatModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const def = AGENT_DEFS.find(a => a.id === agentId);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text: userText }]);
    setLoading(true);
    try {
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `[Talking to ${def?.name ?? agentId}] ${userText}` }),
      });
      const d = await r.json() as { reply?: string; error?: string };
      setMessages(m => [...m, { role: "assistant", text: d.reply ?? d.error ?? "No response" }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", text: "Connection error — try again" }]);
    }
    setLoading(false);
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="w-full max-w-lg bg-[#0a1628] border rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        style={{ borderColor: def?.colorHex + "60", maxHeight: "80vh" }}
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-slate-800/60"
          style={{ borderLeftColor: def?.colorHex, borderLeftWidth: 3 }}>
          <span className="text-2xl">{def?.emoji}</span>
          <div className="flex-1">
            <div className="font-bold text-slate-100 text-sm">{def?.name ?? agentId}</div>
            <div className="text-xs text-slate-400">{def?.role}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="text-center text-slate-600 text-xs mt-8">
              <span className="text-2xl">{def?.emoji}</span>
              <p className="mt-2">Start chatting with {def?.name}</p>
              <p className="opacity-60">Ask them about their current tasks or give them directives</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "assistant" && <span className="text-lg flex-shrink-0">{def?.emoji ?? "🤖"}</span>}
              <div className={cn("max-w-[80%] text-xs p-2.5 rounded-xl leading-relaxed",
                m.role === "user"
                  ? "bg-violet-600/30 border border-violet-500/40 text-slate-100"
                  : "bg-slate-800/60 border border-slate-700/40 text-slate-200"
              )}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <span className="text-lg">{def?.emoji ?? "🤖"}</span>
              <div className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-2.5">
                <Loader2 className="w-3 h-3 animate-spin text-slate-400"/>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>
        {/* Input */}
        <div className="p-3 border-t border-slate-800/60 flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message ${def?.name ?? agentId}…`}
            className="flex-1 text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
          <button onClick={send} disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/50 transition-colors disabled:opacity-40">
            <Send className="w-3.5 h-3.5"/>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Agent Detail Panel ───────────────────────────────────────────────────────

function AgentDetailPanel({ agentId, agentStatuses, recentMail, onNudge, onChat }: {
  agentId: string | null; agentStatuses: AgentStatus[]; recentMail: MailItem[];
  onNudge: (id: string) => void; onChat: (id: string) => void;
}) {
  const def  = AGENT_DEFS.find(a => a.id === agentId);
  const stat = agentStatuses.find(a => a.agentId === agentId);
  const mail = recentMail.filter(m => m.fromAgent === agentId || m.toAgent === agentId).slice(0, 6);

  if (!def) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 p-6">
        <Building2 className="w-10 h-10 opacity-40"/>
        <p className="text-sm">Click an agent in the office</p>
        <p className="text-xs opacity-60">to view their live status & chat with them</p>
      </div>
    );
  }

  const statusColor = stat?.status === "working" ? "text-emerald-400" : stat?.status === "error" ? "text-red-400" : stat?.status === "idle" ? "text-yellow-400" : "text-slate-500";
  const statusBg    = stat?.status === "working" ? "bg-emerald-500/10 border-emerald-500/30" : stat?.status === "error" ? "bg-red-500/10 border-red-500/30" : stat?.status === "idle" ? "bg-yellow-500/10 border-yellow-500/30" : "bg-slate-800/50 border-slate-700/30";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-slate-800/60" style={{ borderLeftColor: def.colorHex, borderLeftWidth: 3 }}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{def.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-100 text-sm">{def.name}</div>
            <div className="text-xs text-slate-400">{def.role}</div>
          </div>
          <div className="flex gap-1">
            <button onClick={() => onChat(def.id)}
              className="text-xs px-2 py-1 rounded border border-violet-700/50 text-violet-400 hover:border-violet-500 hover:text-violet-200 transition-colors flex items-center gap-1">
              <MessageSquare className="w-3 h-3"/> Chat
            </button>
            <button onClick={() => onNudge(def.id)}
              className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors">
              Nudge ▶
            </button>
          </div>
        </div>
      </div>
      {stat && (
        <div className={cn("mx-3 mt-3 p-2.5 rounded border text-xs", statusBg)}>
          <div className={cn("font-semibold uppercase tracking-wide mb-1", statusColor)}>{stat.status}</div>
          <div className="text-slate-300 leading-relaxed">{stat.currentTask || "Waiting for next cycle…"}</div>
          <div className="text-slate-500 mt-1">{stat.tickCount} ticks · {stat.lastSeen ? new Date(stat.lastSeen).toLocaleTimeString() : ""}</div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 pb-3 mt-3 min-h-0">
        <div className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Recent Mail</div>
        {mail.length === 0
          ? <div className="text-xs text-slate-600">No mail yet</div>
          : mail.map(m => (
            <div key={m.id} className={cn("text-xs p-2 mb-1.5 rounded-md border",
              m.fromAgent === agentId ? "bg-slate-800/50 border-slate-700/40" : "bg-slate-800/30 border-slate-700/20")}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-slate-400">{m.fromAgent === agentId ? `→ ${m.toAgent}` : `← ${m.fromAgent}`}</span>
                <span className={cn("ml-auto text-[10px]",
                  m.priority === "critical" ? "text-red-400" : m.priority === "high" ? "text-orange-400" : m.priority === "low" ? "text-slate-500" : "text-slate-400"
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

function CircuitBreakerCard({ circuit, onReset, loading }: {
  circuit: CircuitStatus | null; onReset: () => void; loading: boolean;
}) {
  if (!circuit) return null;
  const isOpen = circuit.open;
  return (
    <div className={cn("rounded-lg border p-3 transition-colors",
      isOpen ? "bg-amber-950/40 border-amber-500/40" : "bg-slate-900/60 border-slate-700/40")}>
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
        <span>Fails</span>        <span className="text-slate-200">{circuit.consecutiveFails}/{circuit.threshold}</span>
        {isOpen && <><span>Recovers in</span><span className="text-amber-300">{circuit.recoversIn}s</span></>}
        <span>Cache</span>        <span className="text-slate-200">{circuit.thoughtCacheSize}</span>
      </div>
      {isOpen && (
        <button onClick={onReset} disabled={loading}
          className="w-full text-xs py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors">
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline"/> : "↩ Reset Circuit"}
        </button>
      )}
    </div>
  );
}

// ─── Mission Board Tab [E] ────────────────────────────────────────────────────

function MissionBoardTab() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", assignedTo: "orchestrator", priority: "normal" });

  async function fetchMissions() {
    try {
      const r = await fetch("/api/workers/missions");
      const d = await r.json() as { missions: Mission[] };
      setMissions(d.missions ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchMissions(); const t = setInterval(fetchMissions, 10000); return () => clearInterval(t); }, []);

  async function createMission() {
    if (!form.title.trim()) return;
    setLoading(true);
    await fetch("/api/workers/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ title: "", description: "", assignedTo: "orchestrator", priority: "normal" });
    setShowForm(false);
    await fetchMissions();
    setLoading(false);
    toast.success("Mission created!");
  }

  async function updateStatus(id: string, status: Mission["status"]) {
    await fetch(`/api/workers/missions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await fetchMissions();
  }

  async function deleteMission(id: string) {
    await fetch(`/api/workers/missions/${id}`, { method: "DELETE" });
    await fetchMissions();
    toast.success("Mission deleted");
  }

  const queue   = missions.filter(m => m.status === "queue");
  const working = missions.filter(m => m.status === "working");
  const done    = missions.filter(m => m.status === "done");

  const priorityColor = (p: string) =>
    p === "critical" ? "text-red-400 bg-red-500/10 border-red-500/30" :
    p === "high"     ? "text-orange-400 bg-orange-500/10 border-orange-500/30" :
    p === "low"      ? "text-slate-500 bg-slate-800/30 border-slate-700/20" :
    "text-blue-400 bg-blue-500/10 border-blue-500/30";

  const MissionCard = ({ m }: { m: Mission }) => {
    const def = AGENT_DEFS.find(a => a.id === m.assignedTo);
    return (
      <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3 group hover:border-slate-600/60 transition-colors">
        <div className="flex items-start gap-2 mb-2">
          <span className="text-lg">{def?.emoji ?? "🤖"}</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-100 leading-snug">{m.title}</div>
            {m.description && <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.description}</div>}
          </div>
          <button onClick={() => deleteMission(m.id)}
            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all">
            <Trash2 className="w-3 h-3"/>
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", priorityColor(m.priority))}>{m.priority}</span>
          <span className="text-[10px] text-slate-500">{def?.name ?? m.assignedTo}</span>
          <div className="ml-auto flex gap-1">
            {m.status !== "queue"    && <button onClick={() => updateStatus(m.id, "queue")}    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 hover:bg-slate-700 transition-colors">← Queue</button>}
            {m.status !== "working"  && <button onClick={() => updateStatus(m.id, "working")}  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-700/30 text-blue-400 hover:bg-blue-700/50 transition-colors">▶ Work</button>}
            {m.status !== "done"     && <button onClick={() => updateStatus(m.id, "done")}     className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/30 text-emerald-400 hover:bg-emerald-700/50 transition-colors">✓ Done</button>}
          </div>
        </div>
      </div>
    );
  };

  const Column = ({ title, items, color, icon }: { title: string; items: Mission[]; color: string; icon: React.ReactNode }) => (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2 px-1 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-xs font-semibold" style={{ color }}>{title}</span>
        <span className="ml-auto text-[10px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded-full">{items.length}</span>
      </div>
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0">
        {items.length === 0
          ? <div className="text-xs text-slate-700 text-center py-6 border border-dashed border-slate-800 rounded-xl">No missions</div>
          : items.map(m => <MissionCard key={m.id} m={m}/>)
        }
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-violet-400"/>
          <span className="text-sm font-semibold text-slate-200">Mission Board</span>
          <span className="text-[10px] text-slate-500">{missions.length} total</span>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/50 transition-colors">
          <PlusCircle className="w-3.5 h-3.5"/> New Mission
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3 flex-shrink-0 overflow-hidden">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Mission title *" className="col-span-2 text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"/>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description (optional)" className="text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"/>
              <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                className="text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none">
                {AGENT_DEFS.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
              </select>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none">
                {["low","normal","high","critical"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={createMission} disabled={loading || !form.title.trim()}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/50 disabled:opacity-40 transition-colors">
                  {loading ? <Loader2 className="w-3 h-3 animate-spin inline"/> : "Create"}
                </button>
                <button onClick={() => setShowForm(false)} className="text-xs px-2 py-1.5 rounded-lg border border-slate-700/40 text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-3 flex-1 min-h-0 overflow-hidden">
        <Column title="Queue" items={queue} color="#94a3b8" icon={<ClipboardList className="w-3.5 h-3.5"/>}/>
        <div className="w-px bg-slate-800/60 flex-shrink-0"/>
        <Column title="In Progress" items={working} color="#3b82f6" icon={<Zap className="w-3.5 h-3.5"/>}/>
        <div className="w-px bg-slate-800/60 flex-shrink-0"/>
        <Column title="Done" items={done} color="#10b981" icon={<CheckCircle2 className="w-3.5 h-3.5"/>}/>
      </div>
    </div>
  );
}

// ─── Heatmap Component [A] ────────────────────────────────────────────────────

function HeatmapPanel({ data }: { data: HeatmapData | null }) {
  if (!data) return <div className="flex items-center justify-center h-full text-slate-600 text-xs">Loading heatmap…</div>;

  const maxVal = Math.max(1, ...Object.values(data.buckets).flatMap(b => b));
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const CELL_W = 22; const CELL_H = 16; const LABEL_W = 72;

  const colorFor = (val: number) => {
    const t = val / maxVal;
    if (t === 0) return "#0a1628";
    if (t < 0.25) return "#1e3a5f";
    if (t < 0.5)  return "#1d4ed8";
    if (t < 0.75) return "#2563eb";
    return "#60a5fa";
  };

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <BarChart3 className="w-4 h-4 text-blue-400"/>
        <span className="text-xs font-semibold text-slate-200">24-Hour Activity Heatmap</span>
        <span className="text-[10px] text-slate-500">mail sent per agent per hour</span>
      </div>
      <div className="flex-1 overflow-auto">
        <svg width={LABEL_W + CELL_W * 24 + 8} height={AGENT_DEFS.length * CELL_H + 32} className="text-[9px] font-mono">
          {/* Hour labels */}
          {hours.map(h => (
            <text key={h} x={LABEL_W + h * CELL_W + CELL_W / 2} y={12} textAnchor="middle" fill="#475569" fontSize={7}>{h}h</text>
          ))}
          {/* Agent rows */}
          {AGENT_DEFS.map((def, row) => {
            const buckets = data.buckets[def.id] ?? new Array(24).fill(0);
            const y = row * CELL_H + 18;
            return (
              <g key={def.id}>
                <text x={LABEL_W - 4} y={y + CELL_H / 2 + 3} textAnchor="end" fill={def.colorHex} fontSize={8}>{def.emoji} {def.name}</text>
                {buckets.map((val, h) => (
                  <g key={h}>
                    <rect x={LABEL_W + h * CELL_W + 1} y={y + 1} width={CELL_W - 2} height={CELL_H - 2} rx={2} fill={colorFor(val)}/>
                    {val > 0 && <text x={LABEL_W + h * CELL_W + CELL_W / 2} y={y + CELL_H / 2 + 3} textAnchor="middle" fill="#93c5fd" fontSize={6.5}>{val}</text>}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-slate-500">
        <span>Low</span>
        {["#0a1628","#1e3a5f","#1d4ed8","#2563eb","#60a5fa"].map((c, i) => (
          <span key={i} className="w-5 h-3 rounded-sm inline-block" style={{ background: c }}/>
        ))}
        <span>High</span>
      </div>
    </div>
  );
}

// ─── Network Graph Component [C] ──────────────────────────────────────────────

function NetworkGraphPanel({ mail }: { mail: MailItem[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const R = 160; const cx = 230; const cy = 185;
  const n = AGENT_DEFS.length;

  const nodePos = AGENT_DEFS.map((_, i) => ({
    x: cx + R * Math.cos((2 * Math.PI * i) / n - Math.PI / 2),
    y: cy + R * Math.sin((2 * Math.PI * i) / n - Math.PI / 2),
  }));

  const edgeMap = new Map<string, number>();
  mail.forEach(m => {
    const key = [m.fromAgent, m.toAgent].sort().join("|");
    edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
  });

  const maxEdge = Math.max(1, ...Array.from(edgeMap.values()));

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Network className="w-4 h-4 text-violet-400"/>
        <span className="text-xs font-semibold text-slate-200">Agent Communication Network</span>
        <span className="text-[10px] text-slate-500">edge thickness = mail volume</span>
      </div>
      <div className="flex gap-3 flex-1 min-h-0">
        <svg width={460} height={370} className="flex-shrink-0 bg-slate-900/30 rounded-xl border border-slate-800/40">
          <defs>
            <radialGradient id="nodeGrad" cx="50%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.6"/>
              <stop offset="100%" stopColor="#020810" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={R + 20} fill="url(#nodeGrad)"/>

          {/* Edges */}
          {Array.from(edgeMap.entries()).map(([key, count]) => {
            const [aId, bId] = key.split("|");
            const ai = AGENT_DEFS.findIndex(a => a.id === aId);
            const bi = AGENT_DEFS.findIndex(a => a.id === bId);
            if (ai < 0 || bi < 0) return null;
            const a = nodePos[ai]!; const b = nodePos[bi]!;
            const thickness = 0.5 + (count / maxEdge) * 3;
            const isHighlighted = selected === aId || selected === bId;
            return (
              <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={isHighlighted ? "#6366f1" : "#1e3a5f"}
                strokeWidth={thickness}
                opacity={selected ? (isHighlighted ? 0.9 : 0.15) : 0.5}/>
            );
          })}

          {/* Nodes */}
          {AGENT_DEFS.map((def, i) => {
            const pos = nodePos[i]!;
            const isSelected = selected === def.id;
            return (
              <g key={def.id} style={{ cursor: "pointer" }} onClick={() => setSelected(s => s === def.id ? null : def.id)}>
                <circle cx={pos.x} cy={pos.y} r={isSelected ? 20 : 16}
                  fill={def.colorHex + "22"} stroke={def.colorHex}
                  strokeWidth={isSelected ? 2 : 1} opacity={selected && !isSelected ? 0.4 : 1}/>
                <text x={pos.x} y={pos.y + 5} textAnchor="middle" fontSize={12} style={{ userSelect: "none" }}>{def.emoji}</text>
              </g>
            );
          })}
        </svg>

        {/* Side stats */}
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
            {selected ? `Connections for ${AGENT_DEFS.find(a => a.id === selected)?.name}` : "Top connections — click node to filter"}
          </div>
          {Array.from(edgeMap.entries())
            .filter(([key]) => !selected || key.includes(selected))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([key, count]) => {
              const [aId, bId] = key.split("|");
              const a = AGENT_DEFS.find(d => d.id === aId); const b = AGENT_DEFS.find(d => d.id === bId);
              return (
                <div key={key} className="flex items-center gap-2 text-[11px] bg-slate-900/40 rounded-lg px-2.5 py-1.5 border border-slate-800/40">
                  <span>{a?.emoji}</span>
                  <span className="text-slate-400 truncate flex-1">{a?.name} ↔ {b?.name}</span>
                  <span className="text-slate-500">{b?.emoji}</span>
                  <span className="text-blue-400 font-mono font-bold ml-2">{count}</span>
                </div>
              );
            })
          }
          {edgeMap.size === 0 && (
            <div className="text-xs text-slate-600 text-center pt-8">No agent communication yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Scorecard Tab [H] ────────────────────────────────────────────────────────

function ScorecardPanel() {
  const [scores, setScores] = useState<ScorecardRow[]>([]);
  const [sortKey, setSortKey] = useState<"tickCount" | "mailSent" | "mailReceived">("tickCount");

  useEffect(() => {
    async function fetchScores() {
      try {
        const r = await fetch("/api/workers/scorecard");
        const d = await r.json() as { scores: ScorecardRow[] };
        setScores(d.scores ?? []);
      } catch { /* ignore */ }
    }
    fetchScores();
    const t = setInterval(fetchScores, 15000);
    return () => clearInterval(t);
  }, []);

  const sorted = [...scores].sort((a, b) => b[sortKey] - a[sortKey]);
  const maxTick = Math.max(1, ...scores.map(s => s.tickCount));
  const maxSent = Math.max(1, ...scores.map(s => s.mailSent));
  const maxRecv = Math.max(1, ...scores.map(s => s.mailReceived));

  const Bar = ({ val, max, color }: { val: number; max: number; color: string }) => (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${(val / max) * 100}%`, background: color }}/>
      </div>
      <span className="text-[10px] text-slate-400 w-6 text-right">{val}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <TrendingUp className="w-4 h-4 text-emerald-400"/>
        <span className="text-xs font-semibold text-slate-200">Agent Performance Scorecard</span>
        <div className="ml-auto flex gap-1">
          {(["tickCount","mailSent","mailReceived"] as const).map(k => (
            <button key={k} onClick={() => setSortKey(k)}
              className={cn("text-[10px] px-2 py-0.5 rounded transition-colors",
                sortKey === k ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-slate-500 border border-slate-700/40 hover:text-slate-300")}>
              {k === "tickCount" ? "Ticks" : k === "mailSent" ? "Sent" : "Recv"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {sorted.map((s, idx) => {
          const def = AGENT_DEFS.find(a => a.id === s.agentId);
          const statusColor = s.status === "working" ? "#22c55e" : s.status === "error" ? "#ef4444" : "#eab308";
          return (
            <div key={s.agentId} className="flex items-center gap-3 bg-slate-900/50 border border-slate-800/40 rounded-xl px-3 py-2.5 hover:border-slate-700/60 transition-colors">
              <span className="text-[10px] text-slate-600 font-mono w-4">#{idx + 1}</span>
              <span className="text-base">{def?.emoji ?? "🤖"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-semibold text-slate-200">{def?.name ?? s.agentId}</span>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }}/>
                  <span className="text-[10px] text-slate-500 truncate flex-1">{s.currentTask?.slice(0, 40)}</span>
                </div>
                <div className="flex gap-4">
                  <div>
                    <div className="text-[9px] text-slate-600 mb-0.5">Ticks</div>
                    <Bar val={s.tickCount} max={maxTick} color="#10b981"/>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-600 mb-0.5">Sent</div>
                    <Bar val={s.mailSent} max={maxSent} color="#3b82f6"/>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-600 mb-0.5">Recv</div>
                    <Bar val={s.mailReceived} max={maxRecv} color="#8b5cf6"/>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-bold text-slate-100">{s.tickCount}</div>
                <div className="text-[9px] text-slate-600">ticks</div>
              </div>
            </div>
          );
        })}
        {scores.length === 0 && (
          <div className="text-xs text-slate-600 text-center pt-12">Waiting for agent data…</div>
        )}
      </div>
    </div>
  );
}

// ─── Intelligence Tab — Heatmap + Network + Scorecard ─────────────────────────

type IntelSubTab = "heatmap" | "network" | "scorecard";

function IntelligenceTab({ mail }: { mail: MailItem[] }) {
  const [subTab, setSubTab] = useState<IntelSubTab>("heatmap");
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);

  useEffect(() => {
    async function fetchHeatmap() {
      try {
        const r = await fetch("/api/workers/heatmap");
        const d = await r.json() as HeatmapData;
        setHeatmap(d);
      } catch { /* ignore */ }
    }
    fetchHeatmap();
    const t = setInterval(fetchHeatmap, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex gap-1 flex-shrink-0">
        {([
          { id: "heatmap",   label: "Heatmap",  icon: <BarChart3 className="w-3 h-3"/> },
          { id: "network",   label: "Network",  icon: <Network   className="w-3 h-3"/> },
          { id: "scorecard", label: "Scorecard",icon: <TrendingUp className="w-3 h-3"/> },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={cn("flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border transition-all",
              subTab === t.id ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-slate-700/40 text-slate-500 hover:text-slate-300 hover:border-slate-600/40")}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {subTab === "heatmap"   && <HeatmapPanel data={heatmap}/>}
        {subTab === "network"   && <NetworkGraphPanel mail={mail}/>}
        {subTab === "scorecard" && <ScorecardPanel/>}
      </div>
    </div>
  );
}

// ─── Memory Inspector Tab [F] ─────────────────────────────────────────────────

function MemoriesTab() {
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [filter, setFilter]     = useState("");
  const [loading, setLoading]   = useState(true);

  async function fetchMemories() {
    setLoading(true);
    try {
      const r = await fetch("/api/agent/memories");
      const d = await r.json() as { memories: AgentMemory[] };
      setMemories(d.memories ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function deleteMemory(id: number) {
    await fetch(`/api/agent/memories/${id}`, { method: "DELETE" });
    setMemories(m => m.filter(x => x.id !== id));
    toast.success("Memory deleted");
  }

  useEffect(() => { fetchMemories(); }, []);

  const filtered = memories.filter(m =>
    !filter || m.content.toLowerCase().includes(filter.toLowerCase()) ||
    m.category.toLowerCase().includes(filter.toLowerCase())
  );

  const catColor = (c: string) => ({
    insight: "#3b82f6", pattern: "#8b5cf6", success: "#22c55e",
    failure: "#ef4444", knowledge: "#f59e0b", plan: "#14b8a6", preference: "#ec4899",
  }[c] ?? "#64748b");

  const importanceDots = (n: number) => Array.from({ length: 10 }, (_, i) => (
    <span key={i} className="inline-block w-1.5 h-1.5 rounded-full mx-px"
      style={{ background: i < n ? "#f59e0b" : "#1e293b" }}/>
  ));

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Database className="w-4 h-4 text-blue-400"/>
        <span className="text-xs font-semibold text-slate-200">Agent Memory Inspector</span>
        <span className="text-[10px] text-slate-500">{memories.length} memories</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600"/>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search memories…"
              className="text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg pl-7 pr-3 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 w-48"/>
          </div>
          <button onClick={fetchMemories} className="text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className="w-3.5 h-3.5"/>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-slate-500"/>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-xs text-slate-600 text-center pt-12">
            {filter ? "No memories match your search" : "No memories stored yet"}
          </div>
        )}
        {filtered.map(m => (
          <div key={m.id} className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-3 group hover:border-slate-700/60 transition-colors">
            <div className="flex items-start gap-2.5">
              <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
                  style={{ color: catColor(m.category), background: catColor(m.category) + "20" }}>{m.category}</span>
                <div className="flex mt-1">{importanceDots(m.importance)}</div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 leading-relaxed">{m.content}</p>
                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-600">
                  <span>Used {m.usageCount}×</span>
                  <span>·</span>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                  {m.tags && <span>· {m.tags}</span>}
                </div>
              </div>
              <button onClick={() => deleteMemory(m.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Collab Thread Panel ──────────────────────────────────────────────────────

function CollabThreadPanel({ threads }: { threads: CollabThread[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active    = threads.filter(t => t.active);
  const concluded = threads.filter(t => !t.active);
  const selectedThread = threads.find(t => t.id === selected);
  const defMap = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a]));

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="w-56 flex-shrink-0 overflow-y-auto flex flex-col gap-1.5">
        {active.length > 0 && <div className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold px-1 mb-0.5">Active ({active.length})</div>}
        {active.map(t => (
          <button key={t.id} onClick={() => setSelected(t.id === selected ? null : t.id)}
            className={cn("text-left p-2.5 rounded-lg border transition-all text-xs",
              selected === t.id ? "bg-violet-900/40 border-violet-500/50 text-slate-100" : "bg-slate-900/60 border-slate-700/40 text-slate-300 hover:border-slate-600/60")}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse"/>
              <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
              <span className="text-[10px] text-slate-500 ml-auto">{t.messageCount} msgs</span>
            </div>
            <div className="font-medium text-slate-100 leading-tight line-clamp-2 mb-1.5">{t.topic}</div>
            <div className="flex flex-wrap gap-1">
              {t.participants.slice(0, 4).map(p => (
                <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                  {defMap[p]?.emoji} {p}
                </span>
              ))}
            </div>
          </button>
        ))}
        {concluded.length > 0 && <div className="text-[10px] text-slate-500/70 uppercase tracking-wider font-semibold px-1 mt-2 mb-0.5">Concluded ({concluded.length})</div>}
        {concluded.slice(0, 8).map(t => (
          <button key={t.id} onClick={() => setSelected(t.id === selected ? null : t.id)}
            className={cn("text-left p-2.5 rounded-lg border transition-all text-xs",
              selected === t.id ? "bg-slate-800/80 border-slate-600/50 text-slate-100" : "bg-slate-900/40 border-slate-700/20 text-slate-500 hover:border-slate-700/40")}>
            <div className="font-medium text-slate-400 leading-tight line-clamp-2 mb-1">{t.topic}</div>
            <div className="flex gap-1 flex-wrap">{t.participants.slice(0, 3).map(p => <span key={p} className="text-[10px] text-slate-600">{defMap[p]?.emoji}</span>)}</div>
          </button>
        ))}
        {threads.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600 p-4">
            <MessageSquare className="w-8 h-8 opacity-40"/>
            <p className="text-xs text-center">No collaboration threads yet</p>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col bg-slate-900/40 rounded-xl border border-slate-700/30 overflow-hidden">
        {selectedThread ? (
          <>
            <div className="p-3 border-b border-slate-700/40">
              <div className="flex items-start gap-2">
                <div className={cn("mt-0.5 w-2 h-2 rounded-full flex-shrink-0", selectedThread.active ? "bg-emerald-400" : "bg-slate-500")}/>
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
                        <span className="text-[11px] font-semibold" style={{ color: d?.colorHex ?? "#94a3b8" }}>{d?.name ?? msg.agentId}</span>
                        <span className="text-[10px] text-slate-600">{new Date(msg.ts).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-xs text-slate-300 leading-relaxed bg-slate-800/50 rounded-lg p-2 border border-slate-700/30">{msg.content}</div>
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
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
            <Users className="w-8 h-8 opacity-40"/>
            <p className="text-xs">Select a thread to view conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

function ActivityTab({ recentMail, allAgents, circuit, onReset, circuitLoading }: {
  recentMail: MailItem[]; allAgents: AgentStatus[];
  circuit: CircuitStatus | null; onReset: () => void; circuitLoading: boolean;
}) {
  const defMap = Object.fromEntries(AGENT_DEFS.map(a => [a.id, a]));
  return (
    <div className="flex gap-3 h-full min-h-0">
      <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto">
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Inter-Agent Mail Feed</div>
        {recentMail.slice(0, 40).map(m => {
          const from = defMap[m.fromAgent]; const to = defMap[m.toAgent];
          return (
            <div key={m.id} className={cn("text-xs p-2.5 rounded-lg border transition-colors",
              m.priority === "critical" ? "bg-red-950/30 border-red-500/30" :
              m.priority === "high"     ? "bg-orange-950/30 border-orange-500/30" :
              "bg-slate-900/40 border-slate-700/30")}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base leading-none">{from?.emoji ?? "📨"}</span>
                <span className="text-slate-300 font-medium">{m.fromAgent}</span>
                <ChevronRight className="w-3 h-3 text-slate-600"/>
                <span className="text-base leading-none">{to?.emoji ?? "📬"}</span>
                <span className="text-slate-300">{m.toAgent}</span>
                <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded",
                  m.priority === "critical" ? "text-red-300 bg-red-500/20" :
                  m.priority === "high"     ? "text-orange-300 bg-orange-500/20" :
                  m.priority === "low"      ? "text-slate-500" : "text-slate-400"
                )}>{m.priority}</span>
              </div>
              <div className="text-slate-100 font-medium">{m.subject}</div>
              <div className="text-slate-500 mt-0.5 text-[10px]">{new Date(m.createdAt).toLocaleTimeString()}</div>
            </div>
          );
        })}
        {recentMail.length === 0 && <div className="text-slate-600 text-xs">No mail yet — agents will start communicating soon</div>}
      </div>
      <div className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
        <CircuitBreakerCard circuit={circuit} onReset={onReset} loading={circuitLoading}/>
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
                    st?.status === "idle"    ? "bg-yellow-400" : "bg-slate-600")}/>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dev Console Tab ──────────────────────────────────────────────────────────

function DevAgentTab({ recentMail }: { recentMail: MailItem[] }) {
  const [msg, setMsg]       = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent]     = useState<string[]>([]);

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
      toast.success("Directive dispatched to Mandor");
    } catch { toast.error("Failed to send directive"); }
    setSending(false);
  }

  const bossInbox = recentMail.filter(m => m.toAgent === "boss").slice(0, 12);

  return (
    <div className="flex gap-3 h-full min-h-0">
      <div className="w-64 flex-shrink-0 flex flex-col gap-3">
        <div className="bg-slate-900/60 rounded-xl border border-slate-700/40 p-3">
          <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-violet-400"/> Send Directive to Mandor
          </div>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            placeholder="Give the AI team a mission… e.g. 'Analyze all training datasets and improve quality'"
            className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg p-2 text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:border-violet-500/50"/>
          <button onClick={sendDirective} disabled={sending || !msg.trim()}
            className="mt-2 w-full text-xs py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/50 transition-colors disabled:opacity-40">
            {sending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1"/> : null}
            Dispatch Directive
          </button>
        </div>
        {sent.length > 0 && (
          <div className="bg-slate-900/40 rounded-xl border border-slate-700/20 p-3">
            <div className="text-xs text-slate-500 mb-1.5">Sent</div>
            {sent.map((s, i) => <div key={i} className="text-[10px] text-slate-400 py-0.5 border-b border-slate-800/60 last:border-0">{s}</div>)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto">
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Boss Inbox ({bossInbox.length})</div>
        {bossInbox.map(m => (
          <div key={m.id} className={cn("text-xs p-3 rounded-xl border",
            m.priority === "critical" ? "bg-red-950/30 border-red-500/30" :
            m.priority === "high"     ? "bg-orange-950/20 border-orange-500/30" :
            "bg-slate-900/40 border-slate-700/30")}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-semibold text-slate-200">{m.fromAgent}</span>
              <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded",
                m.priority === "critical" ? "text-red-300 bg-red-500/20" :
                m.priority === "high"     ? "text-orange-300 bg-orange-500/20" : "text-slate-500"
              )}>{m.priority}</span>
            </div>
            <div className="text-slate-100 font-medium mb-1">{m.subject}</div>
            <div className="text-slate-400 leading-relaxed whitespace-pre-wrap">{m.body.slice(0, 300)}{m.body.length > 300 ? "…" : ""}</div>
            <div className="text-slate-600 mt-1 text-[10px]">{new Date(m.createdAt).toLocaleTimeString()}</div>
          </div>
        ))}
        {bossInbox.length === 0 && <div className="text-slate-600 text-xs">Boss inbox empty — agents will report soon</div>}
      </div>
    </div>
  );
}

// ─── Model Create Tab ─────────────────────────────────────────────────────────

function ModelCreateTab() {
  const [form, setForm] = useState({
    modelName: "", baseModel: "tinyllama", systemPrompt: "",
    temperature: "0.7", topK: "", topP: "", numCtx: "", stopSequence: "",
  });
  const [log, setLog] = useState<Array<{ type: string; text: string }>>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; model?: string } | null>(null);
  const [models, setModels] = useState<string[]>(["tinyllama"]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/models").then(r => r.json()).then((d: { models?: Array<{ name: string }> }) => {
      if (d.models?.length) setModels(d.models.map(m => m.name));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  async function handleCreate() {
    if (!form.modelName.trim() || running) return;
    setRunning(true); setLog([]); setResult(null);
    const resp = await fetch("/api/models/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelName: form.modelName, baseModel: form.baseModel,
        systemPrompt: form.systemPrompt,
        temperature: parseFloat(form.temperature) || 0.7,
        topK: form.topK ? parseInt(form.topK) : undefined,
        topP: form.topP ? parseFloat(form.topP) : undefined,
        numCtx: form.numCtx ? parseInt(form.numCtx) : undefined,
        stopSequence: form.stopSequence || undefined,
      }),
    });
    if (!resp.ok || !resp.body) {
      setLog([{ type: "error", text: `Request failed: HTTP ${resp.status}` }]);
      setRunning(false); return;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const dataLine = part.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const obj = JSON.parse(dataLine.slice(5)) as { type: string; text?: string; success?: boolean; model?: string };
          if (obj.type === "done") { setResult({ success: obj.success ?? false, model: obj.model }); }
          else { setLog(l => [...l, { type: obj.type, text: obj.text ?? "" }]); }
        } catch { /* skip */ }
      }
    }
    setRunning(false);
  }

  const logColor = (t: string) =>
    t === "error" ? "text-red-400" : t === "info" ? "text-blue-400" :
    t === "modelfile" ? "text-violet-300" : "text-emerald-300";

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* Left — Config form */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto pb-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Cpu className="w-4 h-4 text-violet-400"/>
          <span className="text-sm font-semibold text-slate-200">Create AI Model</span>
          <span className="text-[10px] text-slate-500">Ollama Modelfile</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3 space-y-3">
          <div>
            <label className="text-[10px] text-slate-400 uppercase tracking-wide mb-1 block">Model Name *</label>
            <input value={form.modelName} onChange={e => setForm(f => ({ ...f, modelName: e.target.value }))}
              placeholder="e.g. my-coder-v1"
              className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"/>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 uppercase tracking-wide mb-1 block">Base Model</label>
            <select value={form.baseModel} onChange={e => setForm(f => ({ ...f, baseModel: e.target.value }))}
              className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 uppercase tracking-wide mb-1 block">System Prompt</label>
            <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              rows={5} placeholder="You are a helpful assistant specialized in..."
              className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:border-violet-500/50"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Temperature", key: "temperature", placeholder: "0.7", type: "number", step: "0.1" },
              { label: "Top-K",       key: "topK",        placeholder: "40",  type: "number", step: "1"   },
              { label: "Top-P",       key: "topP",        placeholder: "0.95",type: "number", step: "0.05"},
              { label: "Context",     key: "numCtx",      placeholder: "2048",type: "number", step: "1"   },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[10px] text-slate-400 uppercase tracking-wide mb-1 block">{f.label}</label>
                <input value={(form as Record<string, string>)[f.key]} type={f.type} step={f.step}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-violet-500/50"/>
              </div>
            ))}
          </div>
          <div>
            <label className="text-[10px] text-slate-400 uppercase tracking-wide mb-1 block">Stop Sequence</label>
            <input value={form.stopSequence} onChange={e => setForm(f => ({ ...f, stopSequence: e.target.value }))}
              placeholder='e.g. "###"'
              className="w-full text-xs bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"/>
          </div>
          <button onClick={handleCreate} disabled={running || !form.modelName.trim()}
            className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300 hover:bg-violet-600/50 transition-colors disabled:opacity-40">
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Sparkles className="w-3.5 h-3.5"/>}
            {running ? "Building model…" : "Create Model"}
          </button>
        </div>
      </div>

      {/* Right — Build log */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <TerminalSquare className="w-4 h-4 text-emerald-400"/>
          <span className="text-xs font-semibold text-slate-200">Build Log</span>
          {running && <Loader2 className="w-3 h-3 animate-spin text-violet-400"/>}
          {result && (
            <span className={cn("text-xs px-2 py-0.5 rounded-full border",
              result.success ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400")}>
              {result.success ? `✅ ${result.model ?? "Created"}` : "❌ Failed"}
            </span>
          )}
        </div>
        <div ref={logRef}
          className="flex-1 min-h-0 overflow-y-auto bg-[#020810] border border-slate-800/60 rounded-xl p-3 font-mono text-[11px] space-y-0.5">
          {log.length === 0 && !running && (
            <div className="text-center text-slate-600 mt-8">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-20"/>
              <p>Configure a model on the left and click Create</p>
              <p className="opacity-50 mt-1 text-[10px]">Ollama streams build progress here in real time</p>
            </div>
          )}
          {log.map((l, i) => (
            <div key={i} className={cn("leading-relaxed whitespace-pre-wrap break-all", logColor(l.type))}>
              <span className="text-slate-700 select-none mr-1">{String(i).padStart(3, "0")}</span>
              {l.text}
            </div>
          ))}
          {running && <div className="text-violet-400 animate-pulse">▊</div>}
        </div>
        {result?.success && (
          <div className="flex-shrink-0 bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-400"/>
              <span className="font-semibold text-emerald-300">Model created: {result.model}</span>
            </div>
            <p className="text-emerald-400/70">Available in Ollama now. Use it in Chat tab or via the API.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "office" | "activity" | "collab" | "missions" | "intel" | "memories" | "dev" | "modelcreate";

export default function AgentPage() {
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [recentMail, setRecentMail]       = useState<MailItem[]>([]);
  const [threads, setThreads]             = useState<CollabThread[]>([]);
  const [circuit, setCircuit]             = useState<CircuitStatus | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [chatAgent, setChatAgent]         = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<Tab>("office");
  const [particles, setParticles]         = useState<MailParticle[]>([]);
  const [sseStatus, setSseStatus]         = useState<"connecting" | "connected" | "error">("connecting");
  const [lastRefresh, setLastRefresh]     = useState<Date | null>(null);
  const [nudging, setNudging]             = useState<string | null>(null);
  const [circuitLoading, setCircuitLoading] = useState(false);
  const [agentEmotions,  setAgentEmotions]  = useState<Map<string, { emoji: string; reason: string }>>(new Map());
  const [agentPositions, setAgentPositions] = useState<Map<string, { state: string; target?: string }>>(new Map());
  const [ttsOn, setTtsOn]                 = useState(false);
  const particleRef  = useRef(0);
  const prevMailIds  = useRef(new Set<number>());
  const prevThreadIds = useRef(new Set<string>());
  const ttsRef       = useRef(false);
  ttsRef.current = ttsOn;

  const speak = useCallback((text: string, rate = 1.05) => {
    if (!ttsRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate; u.pitch = 1.15; u.volume = 0.75;
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    const eng = voices.find(v => v.lang.startsWith("en") && v.name.toLowerCase().includes("google"));
    if (eng) u.voice = eng;
    window.speechSynthesis.speak(u);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, mailRes, circuitRes, threadRes, emotionRes, positionRes] = await Promise.allSettled([
        fetch("/api/workers/status"),
        fetch("/api/workers/mail/all?limit=100"),
        fetch("/api/workers/circuit"),
        fetch("/api/workers/threads"),
        fetch("/api/workers/emotions"),
        fetch("/api/workers/positions"),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        const d = await statusRes.value.json() as { agents?: AgentStatus[] };
        setAgentStatuses(d.agents ?? []);
      }
      if (mailRes.status === "fulfilled" && mailRes.value.ok) {
        const d = await mailRes.value.json() as { mail?: MailItem[] };
        const newMail = d.mail ?? [];
        // Toast + TTS for new high-priority mail [G]
        newMail.filter(m => !prevMailIds.current.has(m.id) && (m.priority === "critical" || m.priority === "high")).forEach(m => {
          const fromDef = AGENT_DEFS.find(a => a.id === m.fromAgent);
          toast(m.subject, {
            description: `${fromDef?.emoji ?? "📨"} ${m.fromAgent} → ${m.toAgent}`,
            duration: 4000,
            icon: m.priority === "critical" ? "🚨" : "📬",
          });
          if (m.priority === "critical") {
            speak(`Critical alert from ${fromDef?.name ?? m.fromAgent}: ${m.subject}`, 1.2);
          }
        });
        newMail.forEach(m => prevMailIds.current.add(m.id));
        setRecentMail(newMail);
      }
      if (circuitRes.status === "fulfilled" && circuitRes.value.ok) {
        const newCircuit = await circuitRes.value.json() as CircuitStatus;
        setCircuit(prev => {
          if (!prev?.open && newCircuit.open) toast.warning("Circuit breaker opened — LLM providers failing", { duration: 8000 });
          if (prev?.open && !newCircuit.open) toast.success("Circuit breaker recovered ✅", { duration: 4000 });
          return newCircuit;
        });
      }
      if (threadRes.status === "fulfilled" && threadRes.value.ok) {
        const d = await threadRes.value.json() as { threads?: CollabThread[] };
        const newThreads = d.threads ?? [];
        // Toast for new meetings [G]
        newThreads.filter(t => t.active && !prevThreadIds.current.has(t.id)).forEach(t => {
          toast(`New meeting: ${t.topic}`, { description: `Participants: ${t.participants.join(", ")}`, icon: "🤝", duration: 5000 });
          prevThreadIds.current.add(t.id);
        });
        // Toast for concluded meetings
        newThreads.filter(t => !t.active && prevThreadIds.current.has(t.id) && t.conclusion).forEach(t => {
          toast.success(`Meeting concluded`, { description: t.conclusion?.slice(0, 80), duration: 5000 });
        });
        newThreads.forEach(t => prevThreadIds.current.add(t.id));
        setThreads(newThreads);
      }
      if (emotionRes.status === "fulfilled" && emotionRes.value.ok) {
        const d = await emotionRes.value.json() as { emotions?: Record<string, { emoji: string; reason: string }> };
        if (d.emotions) setAgentEmotions(new Map(Object.entries(d.emotions)));
      }
      if (positionRes.status === "fulfilled" && positionRes.value.ok) {
        const d = await positionRes.value.json() as { positions?: Record<string, { state: string; target?: string }> };
        if (d.positions) setAgentPositions(new Map(Object.entries(d.positions)));
      }
      setLastRefresh(new Date());
    } catch { /* ignore */ }
  }, [speak]);

  useEffect(() => {
    setSseStatus("connecting");
    const es = new EventSource("/api/workers/events");

    es.onopen = () => setSseStatus("connected");
    es.onerror = () => setSseStatus("error");

    es.addEventListener("worker_tick", (e: MessageEvent) => {
      fetchAll();
      try {
        const d = JSON.parse(e.data as string) as { id?: string };
        if (d.id) {
          const defs = AGENT_DEFS.filter(a => a.id !== d.id);
          const target = defs[Math.floor(Math.random() * defs.length)];
          if (target && Math.random() < 0.2) {
            const pid = ++particleRef.current;
            setParticles(p => [...p, { id: pid, fromId: d.id!, toId: target.id, ts: Date.now() }]);
            setTimeout(() => setParticles(p => p.filter(x => x.id !== pid)), 1200);
          }
        }
      } catch { /* ignore */ }
    });

    es.addEventListener("collab_started", (e: MessageEvent) => {
      fetchAll();
      try {
        const d = JSON.parse(e.data as string) as { participants?: string[] };
        if (d.participants && d.participants.length >= 2) {
          const a = d.participants[0]; const b = d.participants[1];
          if (a && b) {
            const pid = ++particleRef.current;
            setParticles(p => [...p, { id: pid, fromId: a, toId: b, ts: Date.now() }]);
            setTimeout(() => setParticles(p => p.filter(x => x.id !== pid)), 1200);
          }
        }
      } catch { /* ignore */ }
    });

    es.addEventListener("collab_message", () => fetchAll());
    es.addEventListener("collab_concluded", () => fetchAll());

    es.addEventListener("agent_emotion", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data as string) as { agentId: string; emoji: string; reason: string };
        if (d.agentId) {
          setAgentEmotions(prev => {
            const next = new Map(prev);
            next.set(d.agentId, { emoji: d.emoji, reason: d.reason });
            return next;
          });
        }
      } catch { /* ignore */ }
    });

    es.addEventListener("agent_position", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data as string) as { agentId: string; state: string; target?: string };
        if (d.agentId) {
          setAgentPositions(prev => {
            const next = new Map(prev);
            next.set(d.agentId, { state: d.state, target: d.target });
            return next;
          });
        }
      } catch { /* ignore */ }
    });

    fetchAll();
    const interval = setInterval(fetchAll, 8000);
    return () => { es.close(); clearInterval(interval); };
  }, [fetchAll]);

  async function nudgeAgent(id: string) {
    setNudging(id);
    try {
      await fetch(`/api/workers/${id}/nudge`, { method: "POST" });
      toast.info(`Nudging ${AGENT_DEFS.find(a => a.id === id)?.name ?? id}…`);
      setTimeout(fetchAll, 2000);
    } catch { /* ignore */ }
    setTimeout(() => setNudging(null), 2000);
  }

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
    { id: "office",      label: "Office",        icon: <Building2      className="w-3.5 h-3.5"/> },
    { id: "activity",    label: "Activity",      icon: <Activity       className="w-3.5 h-3.5"/> },
    { id: "collab",      label: "Collab",        icon: <Users          className="w-3.5 h-3.5"/>, badge: activeThreadCount },
    { id: "missions",    label: "Missions",      icon: <Target         className="w-3.5 h-3.5"/> },
    { id: "intel",       label: "Intelligence",  icon: <BarChart3      className="w-3.5 h-3.5"/> },
    { id: "memories",    label: "Memories",      icon: <Database       className="w-3.5 h-3.5"/> },
    { id: "dev",         label: "Dev Console",   icon: <TerminalSquare className="w-3.5 h-3.5"/> },
    { id: "modelcreate", label: "Create Model",  icon: <Cpu            className="w-3.5 h-3.5"/> },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#020810] text-slate-200 font-['Space_Mono',monospace] overflow-hidden">
      {/* Toast provider [G] */}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{ style: { background: "#0a1628", border: "1px solid #1e3a5f", color: "#e2e8f0", fontFamily: "Space Mono, monospace", fontSize: "12px" } }}
      />

      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-slate-800/60 bg-slate-900/30 backdrop-blur-sm flex items-center gap-3">
        <Building2 className="w-5 h-5 text-violet-400"/>
        <div>
          <h1 className="text-sm font-bold text-slate-100 leading-none">Agent Command Center</h1>
          <p className="text-[10px] text-slate-500 mt-0.5">12 autonomous AI agents · DLavie OS v4</p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-mono",
            workingCount > 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-800/50 border-slate-700/30 text-slate-500")}>
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
          <div className={cn("flex items-center gap-1.5 text-[10px]",
            sseStatus === "connected" ? "text-emerald-400" :
            sseStatus === "error"     ? "text-red-400" : "text-yellow-400")}>
            <span className={cn("w-1.5 h-1.5 rounded-full",
              sseStatus === "connected" ? "bg-emerald-400 animate-pulse" :
              sseStatus === "error"     ? "bg-red-400" : "bg-yellow-400")}/>
            {sseStatus === "connected" ? "live" : sseStatus}
          </div>
          <button onClick={fetchAll} className="text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className="w-3.5 h-3.5"/>
          </button>
          {lastRefresh && (
            <span className="text-[10px] text-slate-600 hidden sm:block">{lastRefresh.toLocaleTimeString()}</span>
          )}
          {/* TTS toggle */}
          <button onClick={() => setTtsOn(v => !v)} title={ttsOn ? "TTS on — click to mute" : "TTS off — click to enable voice alerts"}
            className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors",
              ttsOn ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-slate-700/40 text-slate-600 hover:text-slate-400")}>
            {ttsOn ? "🔊 voice" : "🔇 mute"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 px-4 py-1.5 border-b border-slate-800/40 flex gap-0.5 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={cn("flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border whitespace-nowrap transition-all relative",
              activeTab === tab.id
                ? "bg-violet-500/20 border-violet-500/40 text-violet-200"
                : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/40")}>
            {tab.icon}
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-emerald-500 text-white text-[8px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "office" && (
          <div className="flex h-full">
            {/* Office SVG */}
            <div className="flex-1 min-w-0 h-full">
              <OfficeScene
                agentStatuses={agentStatuses}
                selectedAgent={selectedAgent}
                onSelectAgent={id => setSelectedAgent(s => s === id ? null : id)}
                particles={particles}
                activeThreads={threads}
                agentEmotions={agentEmotions}
                agentPositions={agentPositions}
              />
            </div>
            {/* Detail panel */}
            <div className="w-72 flex-shrink-0 border-l border-slate-800/60 bg-slate-900/20 backdrop-blur-sm h-full overflow-hidden">
              <AgentDetailPanel
                agentId={selectedAgent}
                agentStatuses={agentStatuses}
                recentMail={recentMail}
                onNudge={nudgeAgent}
                onChat={id => setChatAgent(id)}
              />
            </div>
          </div>
        )}

        {activeTab === "activity" && (
          <div className="h-full p-4">
            <ActivityTab recentMail={recentMail} allAgents={agentStatuses} circuit={circuit} onReset={resetCircuit} circuitLoading={circuitLoading}/>
          </div>
        )}

        {activeTab === "collab" && (
          <div className="h-full p-4">
            <CollabThreadPanel threads={threads}/>
          </div>
        )}

        {activeTab === "missions" && (
          <div className="h-full p-4">
            <MissionBoardTab/>
          </div>
        )}

        {activeTab === "intel" && (
          <div className="h-full p-4">
            <IntelligenceTab mail={recentMail}/>
          </div>
        )}

        {activeTab === "memories" && (
          <div className="h-full p-4">
            <MemoriesTab/>
          </div>
        )}

        {activeTab === "dev" && (
          <div className="h-full p-4">
            <DevAgentTab recentMail={recentMail}/>
          </div>
        )}

        {activeTab === "modelcreate" && (
          <div className="h-full p-4">
            <ModelCreateTab/>
          </div>
        )}
      </div>

      {/* Agent Chat Modal [D] */}
      <AnimatePresence>
        {chatAgent && (
          <AgentChatModal agentId={chatAgent} onClose={() => setChatAgent(null)}/>
        )}
      </AnimatePresence>
    </div>
  );
}
