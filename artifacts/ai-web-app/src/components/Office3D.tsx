/**
 * Office3D.tsx — DLavie OS 3D Multi-Floor Office
 *
 * CSS 3D isometric-style office with 2 floors, 22 agents, elevator shaft.
 * No WebGL required — uses CSS transforms + animations for the sci-fi look.
 * Floor 1: 14 specialist agents (main work floor)
 * Floor 2: 8 executive agents (mandor + codev + leadership)
 */

import { useEffect, useState } from "react";

// ─── Agent Configuration ──────────────────────────────────────────────────────

export const AGENTS_3D = [
  // ── Floor 1 (indices 0-13) ─────────────────────────────────────────────────
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
  // ── Floor 2 (indices 14-21) ────────────────────────────────────────────────
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

interface AgentEmotion {
  emoji:  string;
  reason: string;
}

interface Office3DProps {
  agentStatuses:  AgentStatus[];
  selectedAgent:  string | null;
  onSelectAgent:  (id: string) => void;
  particles?:     unknown;
  activeThreads?: { id: string; active: boolean; participants: string[] }[];
  agentEmotions?: Map<string, AgentEmotion>;
  agentPositions?: Map<string, { state: string; target?: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  working: "#10b981",
  idle:    "#3b82f6",
  error:   "#ef4444",
  offline: "#475569",
};

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

// ─── Agent Desk Card ──────────────────────────────────────────────────────────

function AgentDesk({
  agent,
  status,
  isSelected,
  isInMeeting,
  emotion,
  onClick,
  tick,
}: {
  agent:       typeof AGENTS_3D[number];
  status?:     AgentStatus;
  isSelected:  boolean;
  isInMeeting: boolean;
  emotion?:    AgentEmotion;
  onClick:     () => void;
  tick:        number;
}) {
  const rgb        = hexToRgb(agent.color);
  const statusColor = STATUS_COLORS[status?.status ?? "offline"] ?? "#475569";
  const isWorking  = status?.status === "working";

  return (
    <div
      onClick={onClick}
      style={{
        position:     "relative",
        width:        "100%",
        cursor:       "pointer",
        padding:      "6px",
        borderRadius: "10px",
        border:       isSelected
          ? `2px solid ${agent.color}`
          : `1px solid rgba(${rgb}, 0.22)`,
        background:   isSelected
          ? `rgba(${rgb}, 0.14)`
          : isWorking
          ? `rgba(${rgb}, 0.07)`
          : "rgba(15, 23, 42, 0.5)",
        boxShadow:    isSelected
          ? `0 0 18px rgba(${rgb}, 0.45), inset 0 0 8px rgba(${rgb}, 0.08)`
          : isWorking
          ? `0 0 8px rgba(${rgb}, 0.25)`
          : "none",
        transition:   "all 0.2s ease",
        userSelect:   "none",
      }}
    >
      {/* Desk surface — monitor */}
      <div style={{
        width:        "100%",
        height:       "28px",
        borderRadius: "4px",
        background:   `linear-gradient(135deg, rgba(${rgb}, 0.2) 0%, rgba(15,23,42,0.9) 100%)`,
        border:       `1px solid rgba(${rgb}, 0.3)`,
        display:      "flex",
        alignItems:   "center",
        justifyContent: "center",
        marginBottom: "4px",
        position:     "relative",
        overflow:     "hidden",
      }}>
        {/* Scan line for working agents */}
        {isWorking && (
          <div style={{
            position:   "absolute",
            left: 0, right: 0,
            height:     "1px",
            background: `rgba(${rgb}, 0.7)`,
            top:        `${(tick % 5) * 5.5}px`,
            boxShadow:  `0 0 4px rgba(${rgb}, 0.9)`,
          }} />
        )}
        {/* Monitor icon */}
        <div style={{
          width: "18px", height: "12px",
          borderRadius: "2px",
          background:   isWorking ? `rgba(${rgb}, 0.35)` : "rgba(30,41,59,0.8)",
          border:       `1px solid rgba(${rgb}, 0.4)`,
          display:      "flex",
          alignItems:   "center",
          justifyContent: "center",
          fontSize:     "6px",
        }}>
          {isWorking && (
            <span style={{ color: agent.color, opacity: tick % 2 === 0 ? 1 : 0.3 }}>█</span>
          )}
        </div>
      </div>

      {/* Agent avatar + name */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <div style={{ position: "relative", display: "inline-flex" }}>
          <div style={{
            width:        "26px",
            height:       "26px",
            borderRadius: "50%",
            background:   `rgba(${rgb}, 0.12)`,
            border:       `2px solid ${statusColor}`,
            boxShadow:    isWorking ? `0 0 10px ${statusColor}` : "none",
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
            fontSize:     "13px",
            animation:    isWorking
              ? "agentPulse 2s ease-in-out infinite"
              : isInMeeting
              ? "agentBounce 1s ease-in-out infinite"
              : "none",
          }}>
            {emotion?.emoji ?? agent.emoji}
          </div>
          {/* Status dot */}
          <div style={{
            position:     "absolute",
            bottom: "-1px", right: "-1px",
            width:        "7px",
            height:       "7px",
            borderRadius: "50%",
            background:   statusColor,
            border:       "1px solid #0f172a",
            boxShadow:    `0 0 4px ${statusColor}`,
          }} />
        </div>

        <span style={{
          fontSize:     "8px",
          color:        isSelected ? agent.color : "#94a3b8",
          fontFamily:   "monospace",
          fontWeight:   "bold",
          textAlign:    "center",
          maxWidth:     "62px",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {agent.name}
        </span>

        {isWorking && status?.currentTask && (
          <span style={{
            fontSize:     "6px",
            color:        `rgba(${rgb}, 0.75)`,
            fontFamily:   "monospace",
            textAlign:    "center",
            maxWidth:     "62px",
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}>
            {status.currentTask.slice(0, 20)}…
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Floor Panel ──────────────────────────────────────────────────────────────

const FLOOR_STYLES = {
  1: { bg: "#03070f",   border: "#0f2d4a", label: "#38bdf8", accent: "#0ea5e9" },
  2: { bg: "#070312",   border: "#2d1052", label: "#c084fc", accent: "#a855f7" },
} as const;

function FloorPanel({
  floorNum,
  agents,
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  activeThreads,
  agentEmotions,
  tick,
}: {
  floorNum:      1 | 2;
  agents:        readonly typeof AGENTS_3D[number][];
  agentStatuses: AgentStatus[];
  selectedAgent: string | null;
  onSelectAgent: (id: string) => void;
  activeThreads: { id: string; active: boolean; participants: string[] }[];
  agentEmotions: Map<string, AgentEmotion>;
  tick:          number;
}) {
  const style      = FLOOR_STYLES[floorNum];
  const statusMap  = new Map(agentStatuses.map(s => [s.agentId, s]));
  const meetingSet = new Set(activeThreads.filter(t => t.active).flatMap(t => t.participants));

  const cols         = Math.max(...agents.map(a => a.col)) + 1;
  const rows         = Math.max(...agents.map(a => a.row)) + 1;
  const workingCount = agents.filter(a => statusMap.get(a.id)?.status === "working").length;

  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      agents.find(a => a.col === c && a.row === r) ?? null
    )
  );

  return (
    <div style={{
      background:   `linear-gradient(160deg, ${style.bg} 0%, rgba(5,12,25,0.98) 100%)`,
      border:       `1px solid ${style.border}`,
      borderRadius: "14px",
      padding:      "10px 12px",
      position:     "relative",
      overflow:     "hidden",
      flexShrink:   0,
    }}>
      {/* Corner accent lines */}
      {(["tl","tr","bl","br"] as const).map(pos => (
        <div key={pos} style={{
          position:   "absolute",
          ...(pos.includes("t") ? { top: 0 } : { bottom: 0 }),
          ...(pos.includes("l") ? { left: 0 } : { right: 0 }),
          width:      pos.includes("t") ? "28px" : "2px",
          height:     pos.includes("t") ? "2px"  : "28px",
          background: style.accent,
        }}/>
      ))}
      <div style={{
        position: "absolute", top: 0, left: 0,
        width: "2px", height: "28px", background: style.accent,
      }}/>
      <div style={{
        position: "absolute", bottom: 0, right: 0,
        width: "28px", height: "2px", background: style.accent,
      }}/>

      {/* Floor header */}
      <div style={{
        display:       "flex",
        alignItems:    "center",
        justifyContent: "space-between",
        marginBottom:  "10px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <div style={{
            width:     "6px",
            height:    "6px",
            borderRadius: "50%",
            background: style.accent,
            boxShadow:  `0 0 8px ${style.accent}`,
          }}/>
          <span style={{
            fontSize:      "10px",
            fontFamily:    "monospace",
            fontWeight:    "bold",
            color:         style.label,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}>
            {floorNum === 2 ? "▲ Floor 2 — Executive" : "▼ Floor 1 — Operations"}
          </span>
        </div>
        <span style={{
          fontSize:   "9px",
          fontFamily: "monospace",
          color:      "#10b981",
          background: "rgba(16,185,129,0.08)",
          padding:    "1px 7px",
          borderRadius: "4px",
          border:     "1px solid rgba(16,185,129,0.25)",
        }}>
          {workingCount}/{agents.length} active
        </span>
      </div>

      {/* Agent grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
        {grid.map((row, ri) => (
          <div key={ri} style={{
            display:               "grid",
            gridTemplateColumns:   `repeat(${cols}, 1fr)`,
            gap:                   "6px",
          }}>
            {row.map((agent, ci) =>
              agent ? (
                <AgentDesk
                  key={agent.id}
                  agent={agent}
                  status={statusMap.get(agent.id)}
                  isSelected={selectedAgent === agent.id}
                  isInMeeting={meetingSet.has(agent.id)}
                  emotion={agentEmotions.get(agent.id)}
                  onClick={() => onSelectAgent(agent.id)}
                  tick={tick}
                />
              ) : (
                <div key={ci} style={{
                  border:       "1px dashed rgba(30,41,59,0.3)",
                  borderRadius: "10px",
                  minHeight:    "72px",
                  opacity:      0.15,
                }} />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Elevator Shaft ───────────────────────────────────────────────────────────

function ElevatorShaft({
  activeThreads,
}: {
  activeThreads: { id: string; active: boolean }[];
}) {
  const [cabinFloor, setCabinFloor] = useState<1 | 2>(1);
  const [doorOpen,   setDoorOpen]   = useState(false);
  const activeMeetings = activeThreads.filter(t => t.active).length;

  useEffect(() => {
    const cycle = () => {
      setDoorOpen(true);
      setTimeout(() => {
        setCabinFloor(f => f === 1 ? 2 : 1);
        setTimeout(() => setDoorOpen(false), 400);
      }, 600);
    };
    const id = setInterval(cycle, 9_000 + Math.random() * 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      width:      "44px",
      flexShrink: 0,
      display:    "flex",
      flexDirection: "column",
      alignItems: "center",
      gap:        "4px",
    }}>
      <span style={{ fontSize: "8px", color: "#64748b", fontFamily: "monospace" }}>
        LIFT
      </span>
      <div style={{
        width:        "34px",
        flex:         1,
        minHeight:    "180px",
        background:   "rgba(8,15,30,0.9)",
        border:       "1px solid rgba(148,163,184,0.12)",
        borderRadius: "6px",
        position:     "relative",
        overflow:     "hidden",
        display:      "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding:      "5px 4px",
      }}>
        {/* Rail */}
        <div style={{
          position:  "absolute",
          left: "50%", top: 0, bottom: 0,
          width:     "2px",
          background: "rgba(148,163,184,0.1)",
          transform: "translateX(-50%)",
        }}/>

        {/* Cabin */}
        <div style={{
          position:   "absolute",
          left: "5px", right: "5px",
          height:     "30px",
          transition: "top 1.6s cubic-bezier(0.4,0,0.2,1)",
          top:        cabinFloor === 2 ? "5px" : "calc(100% - 35px)",
          background: "rgba(56,189,248,0.08)",
          border:     "1px solid rgba(56,189,248,0.35)",
          borderRadius: "4px",
          display:    "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow:   "hidden",
          zIndex:     2,
        }}>
          <div style={{
            position:   "absolute",
            left: 0, top: 0, bottom: 0,
            width:      doorOpen ? "0" : "50%",
            background: "rgba(20,50,90,0.95)",
            transition: "width 0.4s ease",
            borderRight: "1px solid rgba(56,189,248,0.2)",
          }}/>
          <div style={{
            position:   "absolute",
            right: 0, top: 0, bottom: 0,
            width:      doorOpen ? "0" : "50%",
            background: "rgba(20,50,90,0.95)",
            transition: "width 0.4s ease",
            borderLeft: "1px solid rgba(56,189,248,0.2)",
          }}/>
          <span style={{ fontSize: "11px", zIndex: 3, pointerEvents: "none" }}>🛗</span>
        </div>

        {/* Floor labels */}
        <span style={{ fontSize: "8px", color: "#7dd3fc", fontFamily: "monospace", textAlign: "center", zIndex: 1 }}>F2</span>
        <span style={{ fontSize: "8px", color: "#7dd3fc", fontFamily: "monospace", textAlign: "center", zIndex: 1 }}>F1</span>
      </div>

      {activeMeetings > 0 && (
        <span style={{
          fontSize:   "7px",
          fontFamily: "monospace",
          color:      "#818cf8",
          background: "rgba(99,102,241,0.1)",
          padding:    "1px 4px",
          borderRadius: "3px",
          border:     "1px solid rgba(99,102,241,0.3)",
          textAlign:  "center",
        }}>
          {activeMeetings} mtg
        </span>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Office3D({
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  activeThreads  = [],
  agentEmotions  = new Map<string, AgentEmotion>(),
}: Office3DProps) {
  const [currentFloor, setCurrentFloor] = useState<1 | 2 | "all">("all");
  const [tick, setTick]                 = useState(0);
  const [scanY, setScanY]               = useState(0);

  // Global tick for animations
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 700);
    return () => clearInterval(id);
  }, []);

  // Ambient scan line
  useEffect(() => {
    const id = setInterval(() => setScanY(y => (y + 1) % 100), 35);
    return () => clearInterval(id);
  }, []);

  const floor1 = AGENTS_3D.filter(a => a.floor === 1) as unknown as readonly typeof AGENTS_3D[number][];
  const floor2 = AGENTS_3D.filter(a => a.floor === 2) as unknown as readonly typeof AGENTS_3D[number][];

  const workingCount = agentStatuses.filter(s => s.status === "working").length;
  const errorCount   = agentStatuses.filter(s => s.status === "error").length;
  const idleCount    = agentStatuses.filter(s => s.status === "idle").length;
  const totalAgents  = AGENTS_3D.length;

  return (
    <div style={{
      width:     "100%",
      height:    "100%",
      background: "linear-gradient(180deg, #020817 0%, #040d1c 60%, #020817 100%)",
      display:   "flex",
      flexDirection: "column",
      overflow:  "hidden",
      position:  "relative",
      fontFamily: "'Space Mono', monospace",
    }}>
      {/* Keyframes */}
      <style>{`
        @keyframes agentPulse {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.06); }
        }
        @keyframes agentBounce {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-3px); }
        }
        @keyframes gridBlink {
          0%,100% { opacity:0.06; }
          50%     { opacity:0.12; }
        }
      `}</style>

      {/* Background grid */}
      <div style={{
        position:   "absolute",
        inset:      0,
        backgroundImage: `
          linear-gradient(rgba(16,185,129,0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(16,185,129,0.06) 1px, transparent 1px)
        `,
        backgroundSize: "28px 28px",
        animation:  "gridBlink 4s ease-in-out infinite",
        pointerEvents: "none",
      }}/>

      {/* Ambient scan line */}
      <div style={{
        position:   "absolute",
        left: 0, right: 0,
        height:     "1px",
        background: "linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.18) 20%, rgba(16,185,129,0.35) 50%, rgba(16,185,129,0.18) 80%, transparent 100%)",
        top:        `${scanY}%`,
        pointerEvents: "none",
        zIndex:     20,
      }}/>

      {/* ── Top HUD ────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display:    "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding:    "7px 14px",
        background: "rgba(2,8,23,0.97)",
        borderBottom: "1px solid rgba(16,185,129,0.2)",
        zIndex:     10,
      }}>
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: "#10b981",
            boxShadow:  "0 0 10px #10b981",
            animation:  "agentPulse 2s ease-in-out infinite",
          }}/>
          <span style={{ color: "#10b981", fontSize: "11px", fontWeight: "bold", letterSpacing: "0.15em" }}>
            DLAVIE OS — AGENT COMMAND CENTER
          </span>
          <span style={{ color: "#38bdf8", fontSize: "10px" }}>
            [{totalAgents} AGENTS / 2 FLOORS]
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: "18px" }}>
          {[
            { label: "ACTIVE", value: workingCount, color: "#10b981" },
            { label: "IDLE",   value: idleCount,    color: "#3b82f6" },
            { label: "ERROR",  value: errorCount,   color: "#ef4444" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "14px", fontWeight: "bold", color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "0.1em" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Floor nav */}
        <div style={{ display: "flex", gap: "4px" }}>
          {([["all", "ALL"], [2, "F2"], [1, "F1"]] as const).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setCurrentFloor(f)}
              style={{
                fontSize:    "9px",
                padding:     "3px 9px",
                borderRadius: "4px",
                cursor:      "pointer",
                fontFamily:  "monospace",
                fontWeight:  "bold",
                letterSpacing: "0.05em",
                border:      currentFloor === f
                  ? "1px solid #38bdf8"
                  : "1px solid rgba(148,163,184,0.18)",
                background:  currentFloor === f
                  ? "rgba(56,189,248,0.13)"
                  : "rgba(15,23,42,0.5)",
                color:       currentFloor === f ? "#38bdf8" : "#64748b",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div style={{
        flex:      1,
        display:   "flex",
        gap:       "10px",
        padding:   "10px 12px",
        overflow:  "auto",
        minHeight: 0,
        position:  "relative",
        zIndex:    5,
      }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
          {(currentFloor === "all" || currentFloor === 2) && (
            <FloorPanel
              floorNum={2}
              agents={floor2}
              agentStatuses={agentStatuses}
              selectedAgent={selectedAgent}
              onSelectAgent={onSelectAgent}
              activeThreads={activeThreads}
              agentEmotions={agentEmotions}
              tick={tick}
            />
          )}
          {(currentFloor === "all" || currentFloor === 1) && (
            <FloorPanel
              floorNum={1}
              agents={floor1}
              agentStatuses={agentStatuses}
              selectedAgent={selectedAgent}
              onSelectAgent={onSelectAgent}
              activeThreads={activeThreads}
              agentEmotions={agentEmotions}
              tick={tick}
            />
          )}
        </div>

        <ElevatorShaft activeThreads={activeThreads} />
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding:    "4px 14px",
        background: "rgba(2,8,23,0.97)",
        borderTop:  "1px solid rgba(16,185,129,0.12)",
        display:    "flex",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex:     10,
      }}>
        <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
          {[
            { c: "#10b981", l: "Working" },
            { c: "#3b82f6", l: "Idle" },
            { c: "#ef4444", l: "Error" },
            { c: "#475569", l: "Offline" },
          ].map(({ c, l }) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "9px", color: "#94a3b8" }}>
              <span style={{
                width: "6px", height: "6px", borderRadius: "50%",
                background: c, display: "inline-block",
                boxShadow: `0 0 4px ${c}`,
              }}/>
              {l}
            </span>
          ))}
        </div>
        <span style={{ fontSize: "9px", color: "#1e3a5f", fontFamily: "monospace" }}>
          DLavie OS v2.0 — {totalAgents}-agent workspace — click agent to inspect
        </span>
      </div>
    </div>
  );
}
