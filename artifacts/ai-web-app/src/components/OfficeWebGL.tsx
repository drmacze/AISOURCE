/**
 * OfficeWebGL.tsx — CSS 3D Agent Office with Orbit Controls
 * Uses CSS perspective + transform-style: preserve-3d (WebGL-free).
 *
 * Coordinate rules inside the rotated world (rotateX ~52°):
 *   translateZ(+H) → element appears H units ABOVE the floor (closer to viewer = higher)
 *   translateZ(-H) → element sinks below the floor
 *   translateX/Y   → moves on the floor plane
 */

import { useRef, useMemo, useState, useCallback, useEffect, memo } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface AgentStatus {
  agentId: string;
  displayName: string;
  status: string;
  currentTask?: string | null;
}
interface OfficeWebGLProps {
  agentStatuses:   AgentStatus[];
  selectedAgent:   string | null;
  onSelectAgent:   (id: string) => void;
  particles?:      unknown;
  activeThreads?:  { id: string; active: boolean; participants: string[]; topic?: string }[];
  agentEmotions?:  Map<string, { emoji: string; reason: string }>;
  agentPositions?: Map<string, { state: string; target?: string }>;
}

// ─── Agent definitions ─────────────────────────────────────────────────────────
const AGENTS_DEF = [
  { id: "orchestrator", name: "Orchestrator", emoji: "🎯", color: "#10b981" },
  { id: "trainer",      name: "Trainer",      emoji: "🧠", color: "#8b5cf6" },
  { id: "librarian",    name: "Librarian",    emoji: "📚", color: "#0ea5e9" },
  { id: "guardian",     name: "Guardian",     emoji: "🛡️", color: "#f59e0b" },
  { id: "analyst",      name: "Analyst",      emoji: "📊", color: "#3b82f6" },
  { id: "botmaster",    name: "Botmaster",    emoji: "🤖", color: "#14b8a6" },
  { id: "curator",      name: "Curator",      emoji: "✨", color: "#ec4899" },
  { id: "engineer",     name: "Engineer",     emoji: "⚙️", color: "#f97316" },
  { id: "deployer",     name: "Deployer",     emoji: "🚀", color: "#06b6d4" },
  { id: "reviewer",     name: "Reviewer",     emoji: "👁️", color: "#84cc16" },
  { id: "dbadmin",      name: "DB Admin",     emoji: "🗄️", color: "#e11d48" },
  { id: "storage",      name: "Storage",      emoji: "💾", color: "#0891b2" },
  { id: "frontend_dev", name: "Frontend",     emoji: "🎨", color: "#7c3aed" },
  { id: "qa",           name: "QA",           emoji: "🧪", color: "#15803d" },
  { id: "mandor",       name: "Mandor",       emoji: "👑", color: "#eab308" },
  { id: "codev",        name: "Co-Dev",       emoji: "🤝", color: "#c2410c" },
  { id: "researcher",   name: "Researcher",   emoji: "🔬", color: "#a855f7" },
  { id: "security",     name: "Security",     emoji: "🔒", color: "#b45309" },
  { id: "network",      name: "Network",      emoji: "🌐", color: "#0284c7" },
  { id: "devops",       name: "DevOps",       emoji: "🔧", color: "#059669" },
  { id: "product",      name: "Product",      emoji: "📋", color: "#7e22ce" },
  { id: "backend_dev",  name: "Backend",      emoji: "⚡", color: "#dc2626" },
] as const;

// ─── World positions ──────────────────────────────────────────────────────────
const DESK_XZ: Record<string, [number, number]> = {
  orchestrator:  [ 0.0, -4.0], trainer:      [ 8.0, -5.5],
  librarian:     [10.0, -3.5], reviewer:     [ 7.0, -4.0],
  guardian:      [-6.5,  0.5], analyst:      [-5.0,  2.5],
  qa:            [-7.0,  2.0], curator:      [ 0.5,  2.5],
  frontend_dev:  [ 2.5,  2.0], botmaster:    [ 1.0,  4.0],
  engineer:      [ 7.0,  1.0], deployer:     [ 9.0,  0.0],
  dbadmin:       [10.5,  2.0], storage:      [11.5,  0.5],
  network:       [12.5,  0.0], devops:       [11.5,  3.0],
  backend_dev:   [ 5.5,  3.5], mandor:       [ 0.5,  7.5],
  codev:         [ 2.5,  7.0], product:      [-1.5,  7.0],
  security:      [-6.5,  6.5], researcher:   [ 8.5,  6.5],
};
const MEETING_XZ: [number, number] = [-8.5, -4.0];

// ─── Zone definitions ─────────────────────────────────────────────────────────
const ZONES = [
  { name: "Command Center",  color: "#10b981", x: -1,  z: -6,  w: 4,  d: 5  },
  { name: "Research Lab",    color: "#8b5cf6", x:  6,  z: -7,  w: 6,  d: 6  },
  { name: "Ops Hub",         color: "#3b82f6", x: -9,  z: -1,  w: 6,  d: 6  },
  { name: "Creative Studio", color: "#ec4899", x: -1,  z:  1,  w: 6,  d: 5  },
  { name: "Infrastructure",  color: "#f97316", x:  6,  z: -1,  w: 8,  d: 6  },
  { name: "Executive Suite", color: "#eab308", x: -2,  z:  6,  w: 7,  d: 4  },
  { name: "Break Room",      color: "#22c55e", x: -10, z:  4,  w: 5,  d: 5  },
  { name: "Meeting Room",    color: "#60a5fa", x: -11, z: -7,  w: 6,  d: 6  },
  { name: "Server Room",     color: "#ef4444", x:  6,  z:  6,  w: 8,  d: 5  },
];

// ─── Scale ────────────────────────────────────────────────────────────────────
const S = 56; // px per world unit
const W = (x: number) => x * S;
const D = (z: number) => z * S;
const PILLAR_H  = 80;  // pillar height in Z units (px above floor)
const LABEL_Z   = 130; // label floats this high above floor

// ─── Animation hook ───────────────────────────────────────────────────────────
function useTime() {
  const [t, setT] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const tick  = () => { setT((performance.now() - start) / 1000); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  return t;
}

// ─── Single agent pillar ──────────────────────────────────────────────────────
const AgentPillar = memo(function AgentPillar({
  def, status, task, emotion, isSelected, inMeeting, onClick, time,
}: {
  def:        typeof AGENTS_DEF[number];
  status:     string;
  task?:      string | null;
  emotion?:   { emoji: string; reason: string };
  isSelected: boolean;
  inMeeting:  boolean;
  onClick:    () => void;
  time:       number;
}) {
  const [wx, wz] = DESK_XZ[def.id] ?? [0, 0];
  const isWorking = status === "working";
  const isError   = status === "error";
  const isIdle    = status === "idle";
  const statusColor = isError ? "#ef4444" : isWorking ? def.color : isIdle ? "#eab308" : "#334155";

  // Bob animation: only the pillar body moves up/down in Z
  const bob = isWorking
    ? Math.sin(time * 3.2 + wx * 0.4) * 7
    : Math.sin(time * 0.9 + wz * 0.3) * 2;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: "absolute",
        left: W(wx),
        top:  D(wz),
        transformStyle: "preserve-3d",
        cursor: "pointer",
        zIndex: isSelected ? 20 : 1,
      }}
    >
      {/* ── Desk surface (flat on floor) ── */}
      <div style={{
        position: "absolute",
        width: 56, height: 44,
        left: -28, top: -22,
        background: `${def.color}12`,
        border: `1px solid ${def.color}30`,
        borderRadius: 4,
        transform: "translateZ(1px)",
      }}/>

      {/* ── Status glow ring (flat on floor) ── */}
      <div style={{
        position: "absolute",
        width: 72, height: 72,
        left: -36, top: -36,
        borderRadius: "50%",
        border: `2px solid ${statusColor}`,
        boxShadow: isWorking ? `0 0 16px ${def.color}80, 0 0 6px ${def.color}40` : "none",
        opacity: isWorking ? 1 : 0.35,
        transform: "translateZ(2px)",
        animation: isWorking ? "ringPulse 1.6s ease-in-out infinite" : "none",
        pointerEvents: "none",
      }}/>

      {/* ── Pillar body (rises above floor using positive Z) ── */}
      <div style={{
        position: "absolute",
        width: 44,
        height: 44,
        left: -22,
        top: -22,
        transform: `translateZ(${PILLAR_H / 2 + bob}px)`,
        transformStyle: "preserve-3d",
        background: `radial-gradient(circle at 35% 35%, ${def.color}cc, ${def.color}55)`,
        border: `2px solid ${def.color}`,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "22px",
        boxShadow: isSelected
          ? `0 0 28px ${def.color}cc, 0 0 10px ${def.color}70`
          : isWorking
          ? `0 0 18px ${def.color}80`
          : `0 0 6px ${def.color}30`,
      }}>
        {def.emoji}
        {/* Inner glow ring when working */}
        {isWorking && (
          <div style={{
            position: "absolute",
            inset: -4,
            borderRadius: "50%",
            border: `1px solid ${def.color}60`,
            animation: "ringPulse 1s ease-in-out infinite",
          }}/>
        )}
      </div>

      {/* ── Connecting line from floor to body ── */}
      <div style={{
        position: "absolute",
        width: 2,
        height: PILLAR_H / 2 + bob,
        left: -1,
        top: 0,
        transform: "rotateX(-90deg)",
        transformOrigin: "bottom",
        background: `linear-gradient(to top, ${def.color}80, transparent)`,
        transformStyle: "preserve-3d",
        pointerEvents: "none",
      }}/>

      {/* ── Label card (floats well above floor) ── */}
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate(-50%, -50%) translateZ(${LABEL_Z + bob}px)`,
        pointerEvents: "none",
        whiteSpace: "nowrap",
        transformStyle: "preserve-3d",
      }}>
        <div style={{
          background: isSelected ? `${def.color}20` : "rgba(2,8,22,0.92)",
          border: `1px solid ${isSelected ? def.color : "#1e3a5f"}`,
          borderRadius: 8,
          padding: "3px 9px 4px",
          fontSize: 10,
          fontFamily: "Space Mono, monospace",
          lineHeight: 1.5,
          boxShadow: isSelected ? `0 0 20px ${def.color}50` : "0 2px 12px #00000060",
          textAlign: "center",
          minWidth: 74,
        }}>
          <div style={{ fontWeight: "bold", color: isSelected ? def.color : "#cbd5e1", fontSize: 11 }}>
            {def.name}
          </div>
          <div style={{
            fontSize: 9,
            color: isWorking ? "#34d399" : isError ? "#f87171" : isIdle ? "#fbbf24" : "#475569",
          }}>
            ● {status || "offline"}
          </div>
          {task && isWorking && (
            <div style={{ fontSize: 8, color: "#475569", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis" }}>
              {task.slice(0, 24)}…
            </div>
          )}
        </div>
        {/* Badges row */}
        {(inMeeting || emotion) && (
          <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 2 }}>
            {inMeeting && <span style={{ fontSize: 13, filter: `drop-shadow(0 0 5px #60a5fa)` }}>🤝</span>}
            {emotion   && <span style={{ fontSize: 13 }} title={emotion.reason}>{emotion.emoji}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Connection arc between two agents ───────────────────────────────────────
function ConnectionArc({
  ax, az, bx, bz, color, pct,
}: {
  ax: number; az: number; bx: number; bz: number;
  color: string; pct: number;
}) {
  const steps = 24;
  const ARCZ  = 90; // max arc height above floor in Z

  // Build arc as a series of thin horizontal discs at increasing Z heights
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const t   = i / steps;
    const x   = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * ((ax + bx) / 2) + t * t * bx;
    const z2  = (1 - t) * (1 - t) * az + 2 * (1 - t) * t * ((az + bz) / 2) + t * t * bz;
    const h   = 4 * t * (1 - t) * ARCZ; // parabolic arc height
    return { x, z: z2, h };
  });

  // Particle position along arc
  const pi   = Math.floor(pct * steps);
  const pp   = points[pi] ?? points[0]!;

  return (
    <>
      {/* Arc segments */}
      {points.slice(0, -1).map((p, i) => {
        const next = points[i + 1]!;
        const dx = W(next.x - p.x);
        const dy = D(next.z - p.z);
        const len = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <div key={i} style={{
            position: "absolute",
            left: W(p.x),
            top:  D(p.z),
            width: len + 1,
            height: 2,
            background: color,
            opacity: 0.45,
            transform: `rotate(${angle}deg) translateZ(${p.h}px)`,
            transformOrigin: "left center",
            borderRadius: 1,
          }}/>
        );
      })}
      {/* Moving particle */}
      <div style={{
        position: "absolute",
        left:  W(pp.x) - 5,
        top:   D(pp.z) - 5,
        width:  10, height: 10,
        borderRadius: "50%",
        background: color,
        transform: `translateZ(${pp.h}px)`,
        boxShadow: `0 0 10px ${color}, 0 0 4px ${color}`,
        zIndex: 5,
      }}/>
    </>
  );
}

// ─── Meeting table ────────────────────────────────────────────────────────────
function MeetingTable({ activeThreads, time }: {
  activeThreads: NonNullable<OfficeWebGLProps["activeThreads"]>;
  time: number;
}) {
  const [mx, mz] = MEETING_XZ;
  const hasMeeting = activeThreads.some(t => t.active);
  const topic = activeThreads.find(t => t.active)?.topic;
  const pulse = Math.sin(time * 2) * 0.15 + 1;

  return (
    <div style={{
      position: "absolute",
      left: W(mx), top: D(mz),
      transformStyle: "preserve-3d",
    }}>
      {/* Table surface */}
      <div style={{
        position: "absolute",
        width: 160, height: 160,
        left: -80, top: -80,
        borderRadius: "50%",
        background: "radial-gradient(circle at 40% 40%, #1e3a5f, #0a1628)",
        border: `2px solid ${hasMeeting ? "#60a5fa" : "#1e3a5f"}`,
        boxShadow: hasMeeting ? `0 0 ${20 * pulse}px #60a5fa60, inset 0 0 30px #60a5fa10` : "none",
        transform: "translateZ(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <span style={{ fontSize: 28 }}>🤝</span>
      </div>

      {/* Meeting topic label */}
      {hasMeeting && topic && (
        <div style={{
          position: "absolute",
          left: 0, top: 0,
          transform: `translate(-50%, -50%) translateZ(${100}px)`,
          whiteSpace: "nowrap",
          background: "rgba(2,8,22,0.9)",
          border: "1px solid #60a5fa",
          borderRadius: 8,
          padding: "3px 10px",
          fontSize: 9,
          color: "#93c5fd",
          fontFamily: "Space Mono, monospace",
          boxShadow: "0 0 14px #60a5fa40",
          pointerEvents: "none",
        }}>
          {topic.slice(0, 40)}
        </div>
      )}

      {/* Chairs */}
      {Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const cx = Math.cos(angle) * 100;
        const cy = Math.sin(angle) * 100;
        return (
          <div key={i} style={{
            position: "absolute",
            width: 22, height: 22,
            left: cx - 11, top: cy - 11,
            borderRadius: "50%",
            background: "#0f172a",
            border: `1px solid ${hasMeeting ? "#60a5fa50" : "#1e3a5f"}`,
            transform: "translateZ(3px)",
          }}/>
        );
      })}
    </div>
  );
}

// ─── Floor + zones ────────────────────────────────────────────────────────────
function Floor() {
  return (
    <>
      {/* Base floor */}
      <div style={{
        position: "absolute",
        left: -11 * S, top: -8 * S,
        width: 27 * S, height: 21 * S,
        background: "#020810",
        backgroundImage: [
          "linear-gradient(rgba(30,58,95,0.18) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(30,58,95,0.18) 1px, transparent 1px)",
        ].join(","),
        backgroundSize: `${S}px ${S}px`,
        border: "1px solid #0a1628",
        transform: "translateZ(0px)",
      }}/>
      {/* Zone overlays */}
      {ZONES.map(z => (
        <div key={z.name} style={{
          position: "absolute",
          left: z.x * S, top: z.z * S,
          width: z.w * S, height: z.d * S,
          background: `${z.color}0a`,
          border: `1px solid ${z.color}30`,
          borderRadius: 3,
          transform: "translateZ(1px)",
        }}>
          <span style={{
            position: "absolute",
            bottom: 5, left: 7,
            fontSize: 8,
            color: z.color,
            fontFamily: "Space Mono, monospace",
            fontWeight: "bold",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            opacity: 0.65,
            whiteSpace: "nowrap",
          }}>
            {z.name}
          </span>
        </div>
      ))}
    </>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────
export function OfficeWebGL({
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  activeThreads = [],
  agentEmotions = new Map(),
}: OfficeWebGLProps) {
  const time = useTime();

  const [rot,  setRot]  = useState({ x: 52, y: 22 });
  const [zoom, setZoom] = useState(0.82);
  const drag = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);

  const statusMap = useMemo(
    () => new Map(agentStatuses.map(a => [a.agentId, a])),
    [agentStatuses],
  );
  const meetingSet = useMemo(() => {
    const s = new Set<string>();
    activeThreads.filter(t => t.active).forEach(t => t.participants.forEach(p => s.add(p)));
    return s;
  }, [activeThreads]);

  const arcs = useMemo(() => {
    const list: { key: string; ax: number; az: number; bx: number; bz: number; color: string }[] = [];
    activeThreads.filter(t => t.active).forEach(t => {
      for (let i = 0; i < t.participants.length - 1; i++) {
        const a = t.participants[i]; const b = t.participants[i + 1];
        if (!a || !b) continue;
        const [ax, az] = DESK_XZ[a] ?? [0, 0];
        const [bx, bz] = DESK_XZ[b] ?? [0, 0];
        list.push({ key: `${t.id}-${i}`, ax, az, bx, bz, color: AGENTS_DEF.find(x => x.id === a)?.color ?? "#60a5fa" });
      }
    });
    return list;
  }, [activeThreads]);

  const onMouseDown  = useCallback((e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, rx: rot.x, ry: rot.y };
  }, [rot]);
  const onMouseMove  = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    setRot({
      x: Math.max(18, Math.min(82, drag.current.rx - (e.clientY - drag.current.y) * 0.4)),
      y: drag.current.ry + (e.clientX - drag.current.x) * 0.45,
    });
  }, []);
  const onMouseUp    = useCallback(() => { drag.current = null; }, []);
  const onWheel      = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.38, Math.min(1.9, z - e.deltaY * 0.0012)));
  }, []);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]; if (t) drag.current = { x: t.clientX, y: t.clientY, rx: rot.x, ry: rot.y };
  }, [rot]);
  const onTouchMove  = useCallback((e: React.TouchEvent) => {
    if (!drag.current) return;
    const t = e.touches[0]; if (!t) return;
    setRot({
      x: Math.max(18, Math.min(82, drag.current.rx - (t.clientY - drag.current.y) * 0.4)),
      y: drag.current.ry + (t.clientX - drag.current.x) * 0.45,
    });
  }, []);

  const workingCount  = agentStatuses.filter(a => a.status === "working").length;
  const meetingCount  = activeThreads.filter(t => t.active).length;
  const arcPct        = (time * 0.38) % 1;

  return (
    <div
      style={{
        width: "100%", height: "100%",
        background: "#020810",
        overflow: "hidden",
        position: "relative",
        cursor: drag.current ? "grabbing" : "grab",
        userSelect: "none",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onMouseUp}
    >
      {/* Perspective container */}
      <div style={{
        position: "absolute",
        inset: 0,
        perspective: "1100px",
        perspectiveOrigin: "50% 40%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}>
        {/* Rotatable world */}
        <div style={{
          transformStyle: "preserve-3d",
          transform: `scale(${zoom}) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
          position: "relative",
          width: 0,
          height: 0,
        }}>
          {/* Floor + zones */}
          <Floor />

          {/* Meeting table */}
          <MeetingTable activeThreads={activeThreads} time={time} />

          {/* Communication arcs */}
          {arcs.map(arc => (
            <ConnectionArc key={arc.key} {...arc} pct={arcPct} />
          ))}

          {/* 22 agent pillars */}
          {AGENTS_DEF.map(def => {
            const st = statusMap.get(def.id);
            return (
              <AgentPillar
                key={def.id}
                def={def}
                status={st?.status ?? "offline"}
                task={st?.currentTask}
                emotion={agentEmotions.get(def.id)}
                isSelected={selectedAgent === def.id}
                inMeeting={meetingSet.has(def.id)}
                onClick={() => onSelectAgent(def.id)}
                time={time}
              />
            );
          })}
        </div>
      </div>

      {/* HUD */}
      <div style={{
        position: "absolute", top: 12, left: 12,
        color: "#334155", fontSize: 9,
        fontFamily: "Space Mono, monospace",
        lineHeight: 1.9, pointerEvents: "none", zIndex: 30,
      }}>
        <div>🖱 Drag — orbit</div>
        <div>⚙ Scroll — zoom</div>
        <div>▶ Click — select agent</div>
      </div>

      <div style={{
        position: "absolute", top: 12, right: 12,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5,
        fontFamily: "Space Mono, monospace", fontSize: 10,
        pointerEvents: "none", zIndex: 30,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#34d399" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", display: "inline-block" }}/>
          {workingCount} working
        </div>
        {meetingCount > 0 && (
          <div style={{ color: "#60a5fa" }}>🤝 {meetingCount} meeting{meetingCount > 1 ? "s" : ""}</div>
        )}
      </div>

      {/* CSS keyframes */}
      <style>{`
        @keyframes ringPulse {
          0%, 100% { opacity: 1;   transform: scale(1)    translateZ(2px); }
          50%       { opacity: 0.5; transform: scale(1.12) translateZ(2px); }
        }
      `}</style>
    </div>
  );
}

export default OfficeWebGL;
