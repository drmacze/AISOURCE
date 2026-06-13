/**
 * Office3D.tsx — DLavie OS Isometric Game Office
 *
 * Realistic isometric office with animated characters, detailed furniture,
 * walking agents, task bubbles, mail particles, and live status.
 * Pure CSS + SVG — no WebGL needed.
 *
 * Zones: Command · Research · Ops · Creative · Infra · Executive · Server · Break
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Isometric projection constants ──────────────────────────────────────────

const TW = 72;          // tile width  (diamond half-width × 2)
const TH = 36;          // tile height (diamond half-height × 2)
const OX = 530;         // origin screen-X
const OY = 95;          // origin screen-Y
const VBW = 1110;
const VBH = 560;

function iso(col: number, row: number): { x: number; y: number } {
  return {
    x: OX + (col - row) * (TW / 2),
    y: OY + (col + row) * (TH / 2),
  };
}

// ─── Exported agent list (kept for agent.tsx compatibility) ──────────────────

export const AGENTS_3D = [
  { id: "orchestrator", name: "Orchestrator", emoji: "🎯", color: "#10b981", floor: 1, col: 0, row: 0 },
  { id: "trainer",      name: "Trainer",      emoji: "🧠", color: "#8b5cf6", floor: 1, col: 1, row: 0 },
  { id: "librarian",    name: "Librarian",    emoji: "📚", color: "#0ea5e9", floor: 1, col: 2, row: 0 },
  { id: "guardian",     name: "Guardian",     emoji: "🛡️", color: "#f59e0b", floor: 1, col: 3, row: 0 },
  { id: "analyst",      name: "Analyst",      emoji: "📊", color: "#3b82f6", floor: 1, col: 4, row: 0 },
  { id: "botmaster",    name: "Botmaster",    emoji: "🤖", color: "#14b8a6", floor: 1, col: 5, row: 0 },
  { id: "curator",      name: "Curator",      emoji: "✨", color: "#ec4899", floor: 1, col: 6, row: 0 },
  { id: "engineer",     name: "Engineer",     emoji: "⚙️", color: "#f97316", floor: 1, col: 0, row: 1 },
  { id: "deployer",     name: "Deployer",     emoji: "🚀", color: "#06b6d4", floor: 1, col: 1, row: 1 },
  { id: "reviewer",     name: "Reviewer",     emoji: "👁️", color: "#84cc16", floor: 1, col: 2, row: 1 },
  { id: "dbadmin",      name: "DB Admin",     emoji: "🗄️", color: "#e11d48", floor: 1, col: 3, row: 1 },
  { id: "storage",      name: "Storage",      emoji: "💾", color: "#0891b2", floor: 1, col: 4, row: 1 },
  { id: "frontend_dev", name: "Frontend",     emoji: "🎨", color: "#7c3aed", floor: 1, col: 5, row: 1 },
  { id: "qa",           name: "QA Eng",       emoji: "🧪", color: "#15803d", floor: 1, col: 6, row: 1 },
  { id: "mandor",       name: "Mandor",       emoji: "👑", color: "#eab308", floor: 2, col: 1, row: 0 },
  { id: "codev",        name: "Co-Dev",       emoji: "🤝", color: "#c2410c", floor: 2, col: 2, row: 0 },
  { id: "researcher",   name: "Researcher",   emoji: "🔬", color: "#a855f7", floor: 2, col: 3, row: 0 },
  { id: "security",     name: "Security",     emoji: "🔒", color: "#b45309", floor: 2, col: 4, row: 0 },
  { id: "network",      name: "Network",      emoji: "🌐", color: "#0284c7", floor: 2, col: 0, row: 1 },
  { id: "devops",       name: "DevOps",       emoji: "🔧", color: "#059669", floor: 2, col: 2, row: 1 },
  { id: "product",      name: "Product",      emoji: "📋", color: "#7e22ce", floor: 2, col: 3, row: 1 },
  { id: "backend_dev",  name: "Backend",      emoji: "⚡", color: "#dc2626", floor: 2, col: 4, row: 1 },
] as const;

export type AgentId3D = typeof AGENTS_3D[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentStatus {
  agentId: string;
  displayName: string;
  status: string;
  currentTask?: string;
  updatedAt?: string;
}

interface AgentEmotion { emoji: string; reason: string }

interface Office3DProps {
  agentStatuses:  AgentStatus[];
  selectedAgent:  string | null;
  onSelectAgent:  (id: string) => void;
  particles?:     unknown;
  activeThreads?: { id: string; active: boolean; participants: string[] }[];
  agentEmotions?: Map<string, AgentEmotion>;
  agentPositions?: Map<string, { state: string; target?: string }>;
}

// ─── Agent grid positions in the isometric office ────────────────────────────

type GridPos = { col: number; row: number };

const AGENT_DESKS: Record<string, GridPos> = {
  // ── Command Center (center-top zone) ─────────────────────────────────────
  orchestrator: { col: 6,  row: 2  },
  // ── Research Lab (right-top zone) ────────────────────────────────────────
  trainer:      { col: 10, row: 1  },
  librarian:    { col: 11, row: 2  },
  reviewer:     { col: 9,  row: 2  },
  researcher:   { col: 10, row: 6  },
  // ── Ops Hub (left-mid zone) ───────────────────────────────────────────────
  guardian:     { col: 2,  row: 3  },
  analyst:      { col: 3,  row: 4  },
  qa:           { col: 2,  row: 4  },
  // ── Creative Studio (center-mid zone) ────────────────────────────────────
  curator:      { col: 5,  row: 4  },
  frontend_dev: { col: 6,  row: 4  },
  botmaster:    { col: 5,  row: 5  },
  // ── Infra Bay (right-mid zone) ────────────────────────────────────────────
  engineer:     { col: 9,  row: 3  },
  deployer:     { col: 10, row: 3  },
  dbadmin:      { col: 11, row: 3  },
  storage:      { col: 11, row: 4  },
  network:      { col: 12, row: 3  },
  devops:       { col: 12, row: 4  },
  // ── Executive Suite (center-bottom zone) ─────────────────────────────────
  mandor:       { col: 6,  row: 6  },
  codev:        { col: 7,  row: 6  },
  product:      { col: 5,  row: 6  },
  backend_dev:  { col: 8,  row: 5  },
  security:     { col: 2,  row: 6  },
};

const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  AGENTS_3D.map(a => [a.id, a.color])
);
const AGENT_EMOJIS: Record<string, string> = Object.fromEntries(
  AGENTS_3D.map(a => [a.id, a.emoji])
);
const AGENT_NAMES: Record<string, string> = Object.fromEntries(
  AGENTS_3D.map(a => [a.id, a.name])
);

// Meeting room table center (agents gather here when in meeting)
const MEETING_TABLE = { col: 1.5, row: 1.5 };
const MEETING_SEATS: GridPos[] = [
  { col: 1, row: 1 }, { col: 2, row: 1 }, { col: 1, row: 2 },
  { col: 2, row: 2 }, { col: 0.5, row: 1.5 }, { col: 2.5, row: 1.5 },
];

// ─── Color helpers ────────────────────────────────────────────────────────────

function hex2rgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

const STATUS_COLOR: Record<string, string> = {
  working: "#10b981",
  idle:    "#3b82f6",
  error:   "#ef4444",
  offline: "#475569",
};

// ─── SVG Isometric Primitives ─────────────────────────────────────────────────

/** Diamond floor tile */
function IsoTile({ col, row, fill, stroke = "rgba(255,255,255,0.04)", opacity = 1 }: {
  col: number; row: number; fill: string; stroke?: string; opacity?: number;
}) {
  const { x, y } = iso(col, row);
  const hw = TW / 2, hh = TH / 2;
  const pts = `${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`;
  return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={0.8} opacity={opacity} />;
}

/** Isometric box (top + left + right face) */
function IsoBox({ col, row, w = 1, d = 1, h = 0.5, topColor = "#1e293b", leftColor = "#0f172a", rightColor = "#162032" }: {
  col: number; row: number; w?: number; d?: number; h?: number;
  topColor?: string; leftColor?: string; rightColor?: string;
}) {
  const base = iso(col, row);
  const tw = TW * w / 2, th = TH * d / 2;
  const ph = h * 28; // pixel height per unit

  const top = [
    `${base.x},${base.y - th}`,
    `${base.x + tw},${base.y}`,
    `${base.x},${base.y + th}`,
    `${base.x - tw},${base.y}`,
  ].join(" ");

  const left = [
    `${base.x - tw},${base.y}`,
    `${base.x},${base.y + th}`,
    `${base.x},${base.y + th + ph}`,
    `${base.x - tw},${base.y + ph}`,
  ].join(" ");

  const right = [
    `${base.x + tw},${base.y}`,
    `${base.x},${base.y + th}`,
    `${base.x},${base.y + th + ph}`,
    `${base.x + tw},${base.y + ph}`,
  ].join(" ");

  return (
    <g>
      <polygon points={left}  fill={leftColor}  />
      <polygon points={right} fill={rightColor} />
      <polygon points={top}   fill={topColor}   />
    </g>
  );
}

/** Desk unit: desk + monitor + keyboard */
function DeskUnit({ col, row, color, isWorking, tick }: {
  col: number; row: number; color: string; isWorking: boolean; tick: number;
}) {
  const c = iso(col, row);
  const tw = TW * 0.42, th = TH * 0.42;

  const screenGlow = isWorking
    ? `rgba(${hex2rgb(color)},0.9)`
    : `rgba(20,40,80,0.8)`;

  return (
    <g>
      {/* Desk surface */}
      <IsoBox col={col} row={row} w={0.85} d={0.6} h={0.38}
        topColor="#1e3a5f" leftColor="#0f2040" rightColor="#142d50" />

      {/* Monitor screen (glowing) */}
      <g opacity={isWorking ? 1 : 0.6}>
        {/* Monitor stand */}
        <rect
          x={c.x - 3} y={c.y - th - 14}
          width={6} height={8}
          rx={1} fill="#0f172a"
        />
        {/* Monitor bezel */}
        <rect
          x={c.x - 18} y={c.y - th - 28}
          width={36} height={22}
          rx={2} fill="#0a0f1a" stroke={`rgba(${hex2rgb(color)},0.4)`} strokeWidth={1}
        />
        {/* Screen content */}
        <rect
          x={c.x - 16} y={c.y - th - 26}
          width={32} height={18}
          rx={1} fill={screenGlow}
          opacity={isWorking ? (tick % 3 === 0 ? 0.85 : 0.7) : 0.2}
        >
          {isWorking && (
            <animate attributeName="opacity" values="0.7;0.95;0.7"
              dur="1.8s" repeatCount="indefinite" />
          )}
        </rect>
        {/* Scanlines on screen when working */}
        {isWorking && [0, 5, 10, 15].map(yy => (
          <line key={yy}
            x1={c.x - 16} y1={c.y - th - 26 + yy}
            x2={c.x + 16} y2={c.y - th - 26 + yy}
            stroke="rgba(0,0,0,0.2)" strokeWidth={0.8}
          />
        ))}
        {/* Cursor blink */}
        {isWorking && (
          <rect x={c.x + 4} y={c.y - th - 16} width={4} height={2} rx={0.5}
            fill="rgba(255,255,255,0.9)">
            <animate attributeName="opacity" values="1;0;1" dur="0.9s" repeatCount="indefinite" />
          </rect>
        )}
      </g>

      {/* Keyboard */}
      <rect
        x={c.x - tw + 4} y={c.y - th / 2 + 2}
        width={tw * 1.2} height={th * 0.7}
        rx={1.5} fill="#0d1b2e" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
        opacity={0.9}
      />

      {/* Mouse */}
      <ellipse cx={c.x + tw - 3} cy={c.y} rx={3} ry={4}
        fill="#0d1b2e" stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />

      {/* Desk lamp glow */}
      {isWorking && (
        <ellipse cx={c.x} cy={c.y} rx={tw * 2.5} ry={th * 2.5}
          fill={`rgba(${hex2rgb(color)},0.06)`} />
      )}
    </g>
  );
}

/** Server rack with blinking LEDs */
function ServerRack({ col, row }: { col: number; row: number }) {
  const c = iso(col, row);
  return (
    <g>
      <IsoBox col={col} row={row} w={0.5} d={0.4} h={1.6}
        topColor="#050d18" leftColor="#030810" rightColor="#071020" />
      {/* LED strips */}
      {[0, 8, 16, 24, 32, 40].map((yy, i) => (
        <g key={i}>
          <rect x={c.x + TW * 0.25 - 2} y={c.y + yy - 10} width={7} height={2} rx={1}
            fill={i % 4 === 0 ? "#22c55e" : i % 4 === 1 ? "#3b82f6" : i % 4 === 2 ? "#f97316" : "#a855f7"}>
            <animate attributeName="opacity"
              values={`1;0.2;1`}
              dur={`${0.8 + i * 0.35}s`} repeatCount="indefinite" />
          </rect>
          <rect x={c.x + TW * 0.25 - 2} y={c.y + yy - 10} width={4} height={1} rx={0.5}
            fill="rgba(255,255,255,0.15)">
            <animate attributeName="opacity" values="0.4;0;0.4"
              dur={`${0.6 + i * 0.2}s`} repeatCount="indefinite" />
          </rect>
        </g>
      ))}
      {/* Vent lines */}
      {[4, 10, 20, 30].map((yy, i) => (
        <line key={i} x1={c.x - TW * 0.15} y1={c.y + yy - 15}
          x2={c.x + TW * 0.15} y2={c.y + yy - 15}
          stroke="rgba(255,255,255,0.05)" strokeWidth={0.8} />
      ))}
    </g>
  );
}

/** Office plant */
function Plant({ col, row }: { col: number; row: number }) {
  const c = iso(col, row);
  return (
    <g>
      {/* Pot */}
      <IsoBox col={col} row={row} w={0.22} d={0.22} h={0.25}
        topColor="#7c3830" leftColor="#5a2820" rightColor="#6b3028" />
      {/* Leaves */}
      <circle cx={c.x} cy={c.y - 18} r={9} fill="#166534" opacity={0.9}>
        <animateTransform attributeName="transform" type="rotate"
          values="-3,0,0; 3,0,0; -3,0,0"
          dur="4s" repeatCount="indefinite" additive="sum" />
      </circle>
      <circle cx={c.x - 5} cy={c.y - 22} r={6} fill="#15803d" opacity={0.85} />
      <circle cx={c.x + 5} cy={c.y - 20} r={7} fill="#16a34a" opacity={0.8} />
      <circle cx={c.x} cy={c.y - 27} r={5} fill="#22c55e" opacity={0.75} />
    </g>
  );
}

/** Conference table */
function ConferenceTable({ col, row }: { col: number; row: number }) {
  return (
    <g>
      <IsoBox col={col} row={row} w={2.2} d={1.4} h={0.35}
        topColor="#1a2e4a" leftColor="#0f1e33" rightColor="#142540" />
      {/* Table top surface pattern */}
      {(() => {
        const c = iso(col, row);
        const tw = TW * 2.2 / 2, th = TH * 1.4 / 2;
        const top = `${c.x},${c.y - th} ${c.x + tw},${c.y} ${c.x},${c.y + th} ${c.x - tw},${c.y}`;
        return (
          <>
            <polygon points={top} fill="rgba(56,189,248,0.04)" />
            <line x1={c.x - tw / 2} y1={c.y - th / 2}
              x2={c.x + tw / 2} y2={c.y + th / 2}
              stroke="rgba(56,189,248,0.08)" strokeWidth={0.8} />
            <circle cx={c.x} cy={c.y} r={5} fill="rgba(56,189,248,0.15)" />
          </>
        );
      })()}
    </g>
  );
}

/** Coffee machine */
function CoffeeMachine({ col, row }: { col: number; row: number }) {
  const c = iso(col, row);
  return (
    <g>
      <IsoBox col={col} row={row} w={0.35} d={0.35} h={0.7}
        topColor="#1a1a2e" leftColor="#0f0f1e" rightColor="#141428" />
      {/* Screen */}
      <rect x={c.x - 6} y={c.y - 26} width={12} height={8} rx={1}
        fill="#1a3a2e" stroke="rgba(16,185,129,0.4)" strokeWidth={0.8}>
        <animate attributeName="fill" values="#1a3a2e;#0d2a1e;#1a3a2e"
          dur="2s" repeatCount="indefinite" />
      </rect>
      {/* Cup holder */}
      <rect x={c.x - 5} y={c.y - 8} width={10} height={5} rx={2}
        fill="#0f0f1e" stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />
      {/* Steam */}
      {[0, 1, 2].map(i => (
        <path key={i}
          d={`M${c.x - 3 + i * 3},${c.y - 30} q2,-4 0,-8 q-2,-4 0,-8`}
          fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.8}>
          <animate attributeName="opacity" values="0;0.5;0"
            dur={`${1.5 + i * 0.4}s`} repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate"
            values={`0,0; 0,-8; 0,-16`}
            dur={`${1.5 + i * 0.4}s`} repeatCount="indefinite" additive="sum" />
        </path>
      ))}
    </g>
  );
}

/** Wall whiteboard */
function Whiteboard({ col, row }: { col: number; row: number }) {
  const c = iso(col, row);
  return (
    <g>
      <IsoBox col={col} row={row} w={0.1} d={1.6} h={1.0}
        topColor="#0f172a" leftColor="#0a0f1a" rightColor="#0f1a2a" />
      {/* Board surface */}
      <rect x={c.x - TW * 0.05} y={c.y - 40} width={TW * 0.9} height={32} rx={2}
        fill="#0f1e35" stroke="rgba(148,163,184,0.2)" strokeWidth={0.8} />
      {/* Board content — fake code/chart lines */}
      {[0, 7, 14, 21].map((yy, i) => (
        <rect key={i} x={c.x - TW * 0.3 + i * 2} y={c.y - 37 + yy}
          width={TW * 0.45 - i * 3} height={2} rx={1}
          fill={`rgba(${["56,189,248","16,185,129","168,85,247","251,191,36"][i]},0.4)`} />
      ))}
    </g>
  );
}

/** Bookshelf */
function Bookshelf({ col, row }: { col: number; row: number }) {
  const BOOK_COLORS = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
    "#a855f7", "#14b8a6", "#ec4899", "#f97316", "#0ea5e9",
  ];
  return (
    <g>
      <IsoBox col={col} row={row} w={1.0} d={0.3} h={0.9}
        topColor="#1e293b" leftColor="#0f172a" rightColor="#162032" />
      {BOOK_COLORS.map((color, i) => {
        const c = iso(col + i * 0.1, row);
        return (
          <rect key={i}
            x={c.x - TW * 0.38 + i * 7.5} y={c.y - 32}
            width={6} height={24 + (i % 3) * 4} rx={0.5}
            fill={color} opacity={0.8}
          />
        );
      })}
    </g>
  );
}

/** Zone floor — a patch of colored tiles */
function ZoneFloor({ colStart, rowStart, cols, rows, color }: {
  colStart: number; rowStart: number; cols: number; rows: number; color: string;
}) {
  const tiles: React.ReactNode[] = [];
  for (let c = colStart; c < colStart + cols; c++) {
    for (let r = rowStart; r < rowStart + rows; r++) {
      tiles.push(
        <IsoTile key={`${c}-${r}`} col={c} row={r} fill={color}
          stroke="rgba(255,255,255,0.03)" />
      );
    }
  }
  return <>{tiles}</>;
}

/** Zone label floating above the floor */
function ZoneLabel({ col, row, label, color }: {
  col: number; row: number; label: string; color: string;
}) {
  const { x, y } = iso(col, row);
  return (
    <g opacity={0.55}>
      <text x={x} y={y - 6}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={7} fontFamily="Space Mono,monospace"
        fontWeight="bold" letterSpacing={1.5}
        fill={color} textDecoration="none"
      >
        {label.toUpperCase()}
      </text>
    </g>
  );
}

/** Data connection line between two agents */
function DataLine({ fromCol, fromRow, toCol, toRow, color }: {
  fromCol: number; fromRow: number; toCol: number; toRow: number; color: string;
}) {
  const from = iso(fromCol, fromRow);
  const to   = iso(toCol, toRow);
  const mx   = (from.x + to.x) / 2;
  const my   = (from.y + to.y) / 2 - 18;
  return (
    <path
      d={`M${from.x},${from.y - 20} Q${mx},${my} ${to.x},${to.y - 20}`}
      fill="none"
      stroke={`rgba(${hex2rgb(color)},0.35)`}
      strokeWidth={1}
      strokeDasharray="4 3"
    >
      <animate attributeName="stroke-dashoffset" from="0" to="-28"
        dur="1.4s" repeatCount="indefinite" />
    </path>
  );
}

// ─── Agent Character (CSS-based, overlaid over SVG) ───────────────────────────

interface AgentCharProps {
  agentId:     string;
  status:      string;
  col:         number;
  row:         number;
  color:       string;
  emoji:       string;
  name:        string;
  currentTask?: string;
  isSelected:  boolean;
  isInMeeting: boolean;
  emotion?:    AgentEmotion;
  tick:        number;
  svgRef:      React.RefObject<SVGSVGElement | null>;
  onClick:     () => void;
}

function AgentCharacter({
  agentId, status, col, row, color, emoji, name,
  currentTask, isSelected, isInMeeting, emotion, tick, svgRef, onClick,
}: AgentCharProps) {
  const pos        = iso(col, row);
  const statusColor = STATUS_COLOR[status] ?? "#475569";
  const isWorking  = status === "working";
  const isError    = status === "error";
  const rgb        = hex2rgb(color);

  // Convert SVG coords → container percentage for CSS positioning
  const [pct, setPct] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const vb  = el.viewBox.baseVal;
    const sx  = (pos.x / vb.width) * 100;
    const sy  = ((pos.y - 36) / vb.height) * 100;
    setPct({ x: sx, y: sy });
  }, [pos.x, pos.y, svgRef]);

  const anim = isError    ? "agentShake  0.4s ease-in-out infinite"
             : isInMeeting ? "agentMeet  1.2s ease-in-out infinite"
             : isWorking  ? "agentType  0.55s ease-in-out infinite"
             :               "agentIdle  3.0s ease-in-out infinite";

  // Stagger bubbles: each agent gets a unique slot based on id hash,
  // so only ~4 agents show their bubble at a time instead of all at once
  const idHash = agentId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const mySlot = idHash % 7;
  const showBubble = isWorking && currentTask && (tick % 7) === mySlot;

  return (
    <div
      onClick={onClick}
      style={{
        position:   "absolute",
        left:       `${pct.x}%`,
        top:        `${pct.y}%`,
        transform:  "translate(-50%, -100%)",
        cursor:     "pointer",
        zIndex:     isSelected ? 40 : isWorking ? 30 : 20,
        transition: "left 2.2s cubic-bezier(0.4,0,0.2,1), top 2.2s cubic-bezier(0.4,0,0.2,1)",
        userSelect: "none",
      }}
    >
      {/* Task bubble */}
      {showBubble && (
        <div style={{
          position:   "absolute",
          bottom:     "calc(100% + 4px)",
          left:       "50%",
          transform:  "translateX(-50%)",
          background: `rgba(${rgb},0.12)`,
          border:     `1px solid rgba(${rgb},0.4)`,
          borderRadius: "8px",
          padding:    "2px 6px",
          whiteSpace: "nowrap",
          fontSize:   "9px",
          color:      color,
          fontFamily: "Space Mono,monospace",
          maxWidth:   "130px",
          overflow:   "hidden",
          textOverflow: "ellipsis",
          animation:  "floatUp 3s ease-in-out infinite",
          boxShadow:  `0 0 8px rgba(${rgb},0.2)`,
          zIndex:     50,
        }}>
          {currentTask?.slice(0, 28)}…
          {/* Bubble tail */}
          <div style={{
            position:   "absolute",
            bottom:     "-5px",
            left:       "50%",
            transform:  "translateX(-50%)",
            width:      0,
            height:     0,
            borderLeft: "4px solid transparent",
            borderRight:"4px solid transparent",
            borderTop:  `5px solid rgba(${rgb},0.4)`,
          }} />
        </div>
      )}

      {/* Character body shadow */}
      <div style={{
        position:   "absolute",
        bottom:     "-4px",
        left:       "50%",
        transform:  "translateX(-50%)",
        width:      "28px",
        height:     "8px",
        borderRadius: "50%",
        background: "rgba(0,0,0,0.5)",
        filter:     "blur(3px)",
      }} />

      {/* Character ring */}
      <div style={{
        width:        "36px",
        height:       "36px",
        borderRadius: "50%",
        background:   isSelected
          ? `radial-gradient(circle, rgba(${rgb},0.35) 0%, rgba(${rgb},0.08) 100%)`
          : `radial-gradient(circle, rgba(${rgb},0.15) 0%, rgba(0,0,0,0) 100%)`,
        border:       isSelected
          ? `2px solid ${color}`
          : `1.5px solid rgba(${rgb},0.45)`,
        display:      "flex",
        alignItems:   "center",
        justifyContent: "center",
        fontSize:     "18px",
        animation:    anim,
        boxShadow:    isSelected
          ? `0 0 18px rgba(${rgb},0.7), 0 0 6px rgba(${rgb},0.4)`
          : isWorking
          ? `0 0 10px rgba(${rgb},0.4)`
          : "none",
        position:     "relative",
      }}>
        {emotion?.emoji ?? emoji}

        {/* Status dot */}
        <div style={{
          position:     "absolute",
          bottom:       "1px",
          right:        "1px",
          width:        "8px",
          height:       "8px",
          borderRadius: "50%",
          background:   statusColor,
          border:       "1px solid #020817",
          boxShadow:    `0 0 5px ${statusColor}`,
        }}>
          {isWorking && (
            <div style={{
              position: "absolute", inset: 0,
              borderRadius: "50%",
              background: statusColor,
              animation: "statusRing 1.4s ease-out infinite",
            }} />
          )}
        </div>
      </div>

      {/* Name tag */}
      <div style={{
        textAlign:  "center",
        fontSize:   "8px",
        fontFamily: "Space Mono,monospace",
        color:      isSelected ? color : "#94a3b8",
        fontWeight: "bold",
        lineHeight: 1.2,
        marginTop:  "2px",
        whiteSpace: "nowrap",
        textShadow: `0 1px 3px rgba(0,0,0,0.9)`,
      }}>
        {name}
      </div>
    </div>
  );
}

// ─── Mail Particle flying between two agents ──────────────────────────────────

interface MailParticle {
  id:     number;
  fromId: string;
  toId:   string;
  color:  string;
  born:   number;
}

function MailParticleEl({ p, svgRef }: { p: MailParticle; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const fromPos = AGENT_DESKS[p.fromId];
  const toPos   = AGENT_DESKS[p.toId];
  if (!fromPos || !toPos) return null;

  const from = iso(fromPos.col, fromPos.row);
  const to   = iso(toPos.col,   toPos.row);

  const [pctFrom, setPctFrom] = useState({ x: 50, y: 50 });
  const [pctTo,   setPctTo]   = useState({ x: 50, y: 50 });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const vb = el.viewBox.baseVal;
    setPctFrom({
      x: (from.x / vb.width)  * 100,
      y: ((from.y - 30) / vb.height) * 100,
    });
    setPctTo({
      x: (to.x / vb.width)  * 100,
      y: ((to.y - 30) / vb.height) * 100,
    });
  }, [from.x, from.y, to.x, to.y, svgRef]);

  const elapsed = (Date.now() - p.born) / 2400; // 0→1
  const t  = Math.min(elapsed, 1);
  const cx = pctFrom.x + (pctTo.x - pctFrom.x) * t;
  const cy = pctFrom.y + (pctTo.y - pctFrom.y) * t - Math.sin(t * Math.PI) * 6;

  return (
    <div style={{
      position:     "absolute",
      left:         `${cx}%`,
      top:          `${cy}%`,
      transform:    "translate(-50%,-50%)",
      width:        "14px",
      height:       "10px",
      background:   `rgba(${hex2rgb(p.color)},0.2)`,
      border:       `1px solid rgba(${hex2rgb(p.color)},0.7)`,
      borderRadius: "2px",
      fontSize:     "7px",
      display:      "flex",
      alignItems:   "center",
      justifyContent: "center",
      color:        p.color,
      boxShadow:    `0 0 6px rgba(${hex2rgb(p.color)},0.5)`,
      pointerEvents: "none",
      zIndex:       60,
      transition:   "left 0.1s linear, top 0.1s linear",
    }}>
      ✉
    </div>
  );
}

// ─── Selected agent info panel ────────────────────────────────────────────────

function AgentInfoPanel({ agentId, agentStatuses, onClose }: {
  agentId: string | null;
  agentStatuses: AgentStatus[];
  onClose: () => void;
}) {
  if (!agentId) return null;
  const def    = AGENTS_3D.find(a => a.id === agentId);
  const status = agentStatuses.find(s => s.agentId === agentId);
  if (!def || !status) return null;
  const rgb = hex2rgb(def.color);

  return (
    <div style={{
      position:     "absolute",
      bottom:       "44px",
      right:        "12px",
      width:        "210px",
      background:   "rgba(2,8,23,0.97)",
      border:       `1px solid rgba(${rgb},0.4)`,
      borderRadius: "10px",
      padding:      "10px 12px",
      zIndex:       100,
      boxShadow:    `0 0 24px rgba(${rgb},0.25)`,
      backdropFilter: "blur(8px)",
    }}>
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: "6px", right: "8px",
          background: "none", border: "none", color: "#64748b",
          cursor: "pointer", fontSize: "14px", lineHeight: 1,
        }}
      >×</button>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "50%",
          background: `rgba(${rgb},0.15)`,
          border:     `2px solid ${def.color}`,
          display:    "flex", alignItems: "center", justifyContent: "center",
          fontSize:   "16px",
        }}>
          {def.emoji}
        </div>
        <div>
          <div style={{ fontSize: "11px", fontWeight: "bold", color: def.color, fontFamily: "Space Mono,monospace" }}>
            {def.name}
          </div>
          <div style={{
            fontSize: "9px", color: STATUS_COLOR[status.status] ?? "#475569",
            fontFamily: "Space Mono,monospace", textTransform: "uppercase",
          }}>
            ● {status.status}
          </div>
        </div>
      </div>

      {status.currentTask && (
        <div style={{
          fontSize:     "9px",
          color:        "#94a3b8",
          fontFamily:   "Space Mono,monospace",
          background:   "rgba(15,23,42,0.6)",
          border:       "1px solid rgba(30,41,59,0.6)",
          borderRadius: "6px",
          padding:      "5px 8px",
          lineHeight:   1.5,
        }}>
          <span style={{ color: "#475569", display: "block", marginBottom: "2px" }}>CURRENT TASK</span>
          {status.currentTask}
        </div>
      )}
    </div>
  );
}

// ─── Main Office3D Component ──────────────────────────────────────────────────

export function Office3D({
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  activeThreads  = [],
  agentEmotions  = new Map<string, AgentEmotion>(),
}: Office3DProps) {
  const svgRef    = useRef<SVGSVGElement>(null);
  const [tick, setTick]           = useState(0);
  const [mailParticles, setMail]  = useState<MailParticle[]>([]);
  const mailCounter               = useRef(0);

  // Tick for animations
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 600);
    return () => clearInterval(id);
  }, []);

  // Spawn mail particles from recent mail activity
  useEffect(() => {
    const id = setInterval(() => {
      const working = agentStatuses.filter(s => s.status === "working");
      if (working.length < 2) return;
      const from = working[Math.floor(Math.random() * working.length)];
      const to   = working[Math.floor(Math.random() * working.length)];
      if (!from || !to || from.agentId === to.agentId) return;
      if (!AGENT_DESKS[from.agentId] || !AGENT_DESKS[to.agentId]) return;
      const id2 = ++mailCounter.current;
      setMail(m => [...m.slice(-6), {
        id: id2, fromId: from.agentId, toId: to.agentId,
        color: AGENT_COLORS[from.agentId] ?? "#38bdf8",
        born: Date.now(),
      }]);
      setTimeout(() => setMail(m => m.filter(p => p.id !== id2)), 2500);
    }, 3800 + Math.random() * 2000);
    return () => clearInterval(id);
  }, [agentStatuses]);

  // Cleanup stale particles
  useEffect(() => {
    const id = setInterval(() => {
      setMail(m => m.filter(p => Date.now() - p.born < 2600));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const statusMap  = new Map(agentStatuses.map(s => [s.agentId, s]));
  const meetingSet = new Set(
    activeThreads.filter(t => t.active).flatMap(t => t.participants)
  );

  const workingCount = agentStatuses.filter(s => s.status === "working").length;
  const errorCount   = agentStatuses.filter(s => s.status === "error").length;
  const idleCount    = agentStatuses.filter(s => s.status === "idle").length;

  // Active data connections (between working agent pairs)
  const workingIds = agentStatuses.filter(s => s.status === "working").map(s => s.agentId);
  const dataLinks: Array<[string, string]> = [];
  for (let i = 0; i < Math.min(workingIds.length, 4); i++) {
    const a = workingIds[i]!;
    const b = workingIds[(i + 1) % workingIds.length]!;
    if (a !== b && AGENT_DESKS[a] && AGENT_DESKS[b]) {
      dataLinks.push([a, b]);
    }
  }

  // Decide each agent's current position (desk or meeting seat)
  function getAgentPos(agentId: string): GridPos {
    const inMeeting = meetingSet.has(agentId);
    if (inMeeting) {
      const idx = [...meetingSet].indexOf(agentId);
      return MEETING_SEATS[idx % MEETING_SEATS.length] ?? AGENT_DESKS[agentId] ?? { col: 6, row: 6 };
    }
    return AGENT_DESKS[agentId] ?? { col: 6, row: 6 };
  }

  // Sort agents back-to-front for correct isometric rendering
  const sortedAgents = [...AGENTS_3D].sort((a, b) => {
    const pa = getAgentPos(a.id);
    const pb = getAgentPos(b.id);
    return (pa.col + pa.row) - (pb.col + pb.row);
  });

  return (
    <div style={{
      width:        "100%",
      height:       "100%",
      position:     "relative",
      overflow:     "hidden",
      background:   "radial-gradient(ellipse at 50% 30%, #030d1e 0%, #020817 60%, #010510 100%)",
      fontFamily:   "'Space Mono',monospace",
    }}>
      {/* ── CSS keyframes ────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes agentType {
          0%,100% { transform: translateY(0px) rotate(0deg); }
          25%     { transform: translateY(-3px) rotate(-2deg); }
          75%     { transform: translateY(-1px) rotate(2deg); }
        }
        @keyframes agentIdle {
          0%,100% { transform: scale(1) translateY(0px); }
          50%     { transform: scale(0.96) translateY(1px); }
        }
        @keyframes agentMeet {
          0%,100% { transform: translateY(0px) rotate(-6deg) scale(1); }
          50%     { transform: translateY(-5px) rotate(6deg) scale(1.06); }
        }
        @keyframes agentShake {
          0%,100% { transform: translateX(0px); }
          25%     { transform: translateX(-4px) rotate(-4deg); }
          75%     { transform: translateX(4px) rotate(4deg); }
        }
        @keyframes statusRing {
          0%   { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes floatUp {
          0%,100% { transform: translateX(-50%) translateY(0px); }
          50%     { transform: translateX(-50%) translateY(-5px); }
        }
        @keyframes gridPulse {
          0%,100% { opacity: 0.05; }
          50%     { opacity: 0.10; }
        }
        @keyframes scanLine {
          0%   { top: -2%; }
          100% { top: 102%; }
        }
        @keyframes hudBlink {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.4; }
        }
      `}</style>

      {/* ── Background grid ───────────────────────────────────────────────── */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `
          linear-gradient(rgba(16,185,129,0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(16,185,129,0.05) 1px, transparent 1px)
        `,
        backgroundSize: "32px 32px",
        animation: "gridPulse 5s ease-in-out infinite",
      }} />

      {/* ── Scan line ─────────────────────────────────────────────────────── */}
      <div style={{
        position: "absolute", left: 0, right: 0, height: "2px",
        background: "linear-gradient(90deg,transparent 0%,rgba(16,185,129,0.25) 30%,rgba(16,185,129,0.4) 50%,rgba(16,185,129,0.25) 70%,transparent 100%)",
        animation: "scanLine 7s linear infinite",
        pointerEvents: "none",
        zIndex: 3,
      }} />

      {/* ── Top HUD ───────────────────────────────────────────────────────── */}
      <div style={{
        position:     "absolute",
        top: 0, left: 0, right: 0,
        zIndex:       15,
        display:      "flex",
        alignItems:   "center",
        justifyContent: "space-between",
        padding:      "6px 14px",
        background:   "rgba(2,8,23,0.92)",
        borderBottom: "1px solid rgba(16,185,129,0.15)",
        backdropFilter: "blur(4px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "7px", height: "7px", borderRadius: "50%",
            background: "#10b981", boxShadow: "0 0 8px #10b981",
            animation: "hudBlink 2s ease-in-out infinite",
          }} />
          <span style={{ fontSize: "10px", color: "#10b981", fontWeight: "bold", letterSpacing: "0.12em" }}>
            DLAVIE OS — AGENT OFFICE
          </span>
          <span style={{ fontSize: "9px", color: "#1e4a6e" }}>
            [{AGENTS_3D.length} AGENTS · LIVE]
          </span>
        </div>

        <div style={{ display: "flex", gap: "20px" }}>
          {[
            { v: workingCount, l: "WORKING", c: "#10b981" },
            { v: idleCount,    l: "IDLE",    c: "#3b82f6" },
            { v: errorCount,   l: "ERROR",   c: "#ef4444" },
            { v: activeThreads.filter(t => t.active).length, l: "MEETINGS", c: "#8b5cf6" },
          ].map(({ v, l, c }) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: c, lineHeight: 1 }}>{v}</div>
              <div style={{ fontSize: "7px", color: "#334155", letterSpacing: "0.08em" }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {[
            { c: "#10b981", l: "Working" },
            { c: "#3b82f6", l: "Idle"    },
            { c: "#ef4444", l: "Error"   },
            { c: "#475569", l: "Offline" },
          ].map(({ c, l }) => (
            <span key={l} style={{
              display: "flex", alignItems: "center", gap: "3px",
              fontSize: "8px", color: "#475569",
            }}>
              <span style={{
                width: "5px", height: "5px", borderRadius: "50%",
                background: c, display: "inline-block", boxShadow: `0 0 3px ${c}`,
              }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* ── SVG isometric office ──────────────────────────────────────────── */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${VBH}`}
        style={{
          width: "100%", height: "100%",
          position: "absolute", inset: 0,
          zIndex: 1, overflow: "visible",
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Zone glow filters */}
          <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* ── Zone floors (back to front) ──────────────────────────────────── */}
        {/* Far zones */}
        <ZoneFloor colStart={8}  rowStart={0} cols={5} rows={4} color="#050e1c" /> {/* Infra Bay */}
        <ZoneFloor colStart={4}  rowStart={0} cols={4} rows={3} color="#050c18" /> {/* Command */}
        <ZoneFloor colStart={0}  rowStart={0} cols={4} rows={3} color="#080c14" /> {/* Meeting/Research */}

        {/* Mid zones */}
        <ZoneFloor colStart={8}  rowStart={4} cols={5} rows={4} color="#040c1a" /> {/* Dev Bay */}
        <ZoneFloor colStart={4}  rowStart={3} cols={4} rows={4} color="#050d14" /> {/* Creative/Exec */}
        <ZoneFloor colStart={0}  rowStart={3} cols={4} rows={4} color="#07101a" /> {/* Ops Hub */}

        {/* Near zones */}
        <ZoneFloor colStart={8}  rowStart={8} cols={5} rows={3} color="#030a18" /> {/* Server Room */}
        <ZoneFloor colStart={4}  rowStart={7} cols={4} rows={4} color="#040e18" /> {/* Executive */}
        <ZoneFloor colStart={0}  rowStart={7} cols={4} rows={4} color="#060d16" /> {/* Break Room */}

        {/* Zone accent tiles (colored borders/accents) */}
        {/* Command Center highlight */}
        {[4,5,6,7].map(c => <IsoTile key={`cmd-${c}`} col={c} row={0} fill="rgba(16,185,129,0.06)" />)}
        {/* Research highlight */}
        {[8,9,10,11].map(c => <IsoTile key={`res-${c}`} col={c} row={0} fill="rgba(139,92,246,0.06)" />)}
        {/* Executive highlight */}
        {[4,5,6,7].map(c => <IsoTile key={`exec-${c}`} col={c} row={8} fill="rgba(234,179,8,0.05)" />)}

        {/* ── Zone labels ──────────────────────────────────────────────────── */}
        <ZoneLabel col={5.5} row={1.0} label="Command Center" color="#34d399" />
        <ZoneLabel col={9.5} row={0.5} label="Research Lab"   color="#a78bfa" />
        <ZoneLabel col={1.5} row={0.5} label="Meeting Room"   color="#60a5fa" />
        <ZoneLabel col={1.5} row={4.5} label="Ops Hub"        color="#fb923c" />
        <ZoneLabel col={5.5} row={4.0} label="Creative Studio" color="#f472b6" />
        <ZoneLabel col={9.5} row={4.5} label="Infra Bay"      color="#38bdf8" />
        <ZoneLabel col={5.5} row={8.0} label="Executive Suite" color="#fde047" />
        <ZoneLabel col={1.5} row={8.5} label="Break Room"     color="#86efac" />
        <ZoneLabel col={9.5} row={8.5} label="Server Room"    color="#fb7185" />

        {/* ── Floor grid accent lines ───────────────────────────────────────── */}
        {[0,1,2,3,4,5,6,7,8,9,10,11].map(r => {
          const a = iso(0, r), b = iso(13, r);
          return <line key={`hr-${r}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgba(255,255,255,0.02)" strokeWidth={0.5} />;
        })}
        {[0,1,2,3,4,5,6,7,8,9,10,11,12,13].map(c => {
          const a = iso(c, 0), b = iso(c, 11);
          return <line key={`vc-${c}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgba(255,255,255,0.02)" strokeWidth={0.5} />;
        })}

        {/* ── Static furniture assets (back-to-front, sorted by col+row) ──── */}

        {/* Meeting room */}
        <ConferenceTable col={1} row={1} />
        {/* Meeting room chairs (small boxes around table) */}
        {MEETING_SEATS.map((s, i) => (
          <IsoBox key={`mseat-${i}`} col={s.col} row={s.row} w={0.25} d={0.25} h={0.18}
            topColor="#0f1e35" leftColor="#0a1228" rightColor="#0c1830" />
        ))}
        {/* Meeting room whiteboard */}
        <Whiteboard col={0} row={0} />

        {/* Research Lab bookshelf */}
        <Bookshelf col={12} row={0} />
        <Bookshelf col={13} row={1} />

        {/* Plants scattered around */}
        <Plant col={3}  row={0} />
        <Plant col={0}  row={2} />
        <Plant col={7}  row={2} />
        <Plant col={13} row={5} />
        <Plant col={3}  row={8} />
        <Plant col={7}  row={9} />
        <Plant col={0}  row={10} />

        {/* Break room */}
        <CoffeeMachine col={1} row={8} />
        <IsoBox col={2} row={8} w={0.8} d={0.5} h={0.32}
          topColor="#1a2a1a" leftColor="#0f1f0f" rightColor="#141f14" /> {/* Fridge */}
        <IsoBox col={1} row={9} w={1.2} d={0.5} h={0.28}
          topColor="#1e2a1e" leftColor="#0f1a0f" rightColor="#141a14" /> {/* Lounge sofa */}

        {/* Server room racks */}
        <ServerRack col={9}  row={8} />
        <ServerRack col={10} row={8} />
        <ServerRack col={11} row={8} />
        <ServerRack col={12} row={8} />
        <ServerRack col={9}  row={9} />
        <ServerRack col={10} row={9} />
        {/* Server room cooling units */}
        <IsoBox col={13} row={8} w={0.4} d={0.8} h={1.2}
          topColor="#05101e" leftColor="#030b18" rightColor="#040e1e" />
        <IsoBox col={13} row={9} w={0.4} d={0.8} h={1.2}
          topColor="#05101e" leftColor="#030b18" rightColor="#040e1e" />

        {/* Executive suite round table */}
        <IsoBox col={6} row={8} w={1.0} d={1.0} h={0.3}
          topColor="#1a2a3a" leftColor="#0f1a28" rightColor="#142030" />

        {/* Infra whiteboard */}
        <Whiteboard col={8} row={0} />

        {/* All agent desks (sorted back-to-front) */}
        {Object.entries(AGENT_DESKS)
          .sort(([, a], [, b]) => (a.col + a.row) - (b.col + b.row))
          .map(([agentId, pos]) => {
            const s   = statusMap.get(agentId);
            const clr = AGENT_COLORS[agentId] ?? "#38bdf8";
            return (
              <DeskUnit
                key={`desk-${agentId}`}
                col={pos.col} row={pos.row}
                color={clr}
                isWorking={s?.status === "working"}
                tick={tick}
              />
            );
          })
        }

        {/* ── Data connection lines (working agents) ──────────────────────── */}
        {dataLinks.map(([a, b]) => {
          const pa = getAgentPos(a);
          const pb = getAgentPos(b);
          return (
            <DataLine key={`link-${a}-${b}`}
              fromCol={pa.col} fromRow={pa.row}
              toCol={pb.col} toRow={pb.row}
              color={AGENT_COLORS[a] ?? "#38bdf8"}
            />
          );
        })}
      </svg>

      {/* ── Agent characters (CSS-positioned over SVG) ───────────────────── */}
      {sortedAgents.map(agent => {
        const status = statusMap.get(agent.id);
        const pos    = getAgentPos(agent.id);
        return (
          <AgentCharacter
            key={agent.id}
            agentId={agent.id}
            status={status?.status ?? "offline"}
            col={pos.col}
            row={pos.row}
            color={agent.color}
            emoji={AGENT_EMOJIS[agent.id] ?? agent.emoji}
            name={AGENT_NAMES[agent.id] ?? agent.name}
            currentTask={status?.currentTask ?? undefined}
            isSelected={selectedAgent === agent.id}
            isInMeeting={meetingSet.has(agent.id)}
            emotion={agentEmotions.get(agent.id)}
            tick={tick}
            svgRef={svgRef}
            onClick={() => onSelectAgent(agent.id)}
          />
        );
      })}

      {/* ── Mail particles ───────────────────────────────────────────────── */}
      {mailParticles.map(p => (
        <MailParticleEl key={p.id} p={p} svgRef={svgRef} />
      ))}

      {/* ── Agent info panel (on select) ─────────────────────────────────── */}
      <AgentInfoPanel
        agentId={selectedAgent}
        agentStatuses={agentStatuses}
        onClose={() => onSelectAgent(selectedAgent ?? "")}
      />

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div style={{
        position:     "absolute",
        bottom: 0, left: 0, right: 0,
        zIndex:       15,
        padding:      "4px 14px",
        background:   "rgba(2,8,23,0.95)",
        borderTop:    "1px solid rgba(16,185,129,0.1)",
        display:      "flex",
        alignItems:   "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          {/* Live activity ticker */}
          {agentStatuses.filter(s => s.status === "working").slice(0, 3).map(s => (
            <span key={s.agentId} style={{
              fontSize: "8px", color: AGENT_COLORS[s.agentId] ?? "#38bdf8",
              fontFamily: "Space Mono,monospace",
              display: "flex", alignItems: "center", gap: "4px",
            }}>
              <span style={{
                width: "4px", height: "4px", borderRadius: "50%",
                background: AGENT_COLORS[s.agentId] ?? "#38bdf8",
                display: "inline-block",
                animation: "hudBlink 1.2s ease-in-out infinite",
              }} />
              {AGENT_NAMES[s.agentId] ?? s.agentId}
              {s.currentTask ? ` · ${s.currentTask.slice(0, 22)}…` : ""}
            </span>
          ))}
        </div>
        <span style={{ fontSize: "8px", color: "#1e3a5f", fontFamily: "Space Mono,monospace" }}>
          DLavie OS · {AGENTS_3D.length}-agent isometric office · click agent to inspect
        </span>
      </div>
    </div>
  );
}
