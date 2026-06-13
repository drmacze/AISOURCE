/**
 * Office3D.tsx — DLavie OS Isometric 3D Canvas Office
 *
 * Performance architecture:
 *  • bgCanvas — cached offscreen canvas for floor + furniture + zone lines.
 *    Only re-drawn when orbit moves >2 px or canvas resizes. (~0–1 redraw/sec)
 *  • Dynamic layer — only 22 agent avatars + particles per frame (~22 items).
 *  • ZERO ctx.shadowBlur anywhere — glow replaced with alpha fills.
 *  • 20 fps cap via performance.now() — no work at 60 fps.
 *  • No per-frame closure allocation for static geometry.
 */

import { useEffect, useRef, useState } from "react";

// ─── Exported agent list (kept here for backwards compat with agent.tsx) ──────
export const AGENTS_3D = [
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
  { id: "qa",           name: "QA Eng",       emoji: "🧪", color: "#15803d" },
  { id: "mandor",       name: "Mandor",       emoji: "👑", color: "#eab308" },
  { id: "codev",        name: "Co-Dev",       emoji: "🤝", color: "#c2410c" },
  { id: "researcher",   name: "Researcher",   emoji: "🔬", color: "#a855f7" },
  { id: "security",     name: "Security",     emoji: "🔒", color: "#b45309" },
  { id: "network",      name: "Network",      emoji: "🌐", color: "#0284c7" },
  { id: "devops",       name: "DevOps",       emoji: "🔧", color: "#059669" },
  { id: "product",      name: "Product",      emoji: "📋", color: "#7e22ce" },
  { id: "backend_dev",  name: "Backend",      emoji: "⚡", color: "#dc2626" },
] as const;
export type AgentId3D = typeof AGENTS_3D[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────
interface AgentStatus {
  agentId: string;
  displayName: string;
  status: string;
  currentTask?: string | null;
  updatedAt?: string;
}
interface Office3DProps {
  agentStatuses:   AgentStatus[];
  selectedAgent:   string | null;
  onSelectAgent:   (id: string) => void;
  particles?:      unknown;
  activeThreads?:  { id: string; active: boolean; participants: string[] }[];
  agentEmotions?:  Map<string, { emoji: string; reason: string }>;
  agentPositions?: Map<string, { state: string; target?: string }>;
}
interface AgentAnim  { cx: number; cz: number; tx: number; tz: number; }
interface MailParticle {
  fromX: number; fromZ: number; toX: number; toZ: number;
  born: number;  life: number;  color: string;
}
type DrawFn   = () => void;
type DrawItem = { depth: number; fn: DrawFn };

// ─── Isometric constants ──────────────────────────────────────────────────────
const TW2 = 40;  // half tile width  (TW=80)
const TH2 = 20;  // half tile height (TH=40)
const HS  = 52;  // screen pixels per world Y unit

// ─── World layout ─────────────────────────────────────────────────────────────
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

const MEETING_SEATS: [number, number][] = [
  [-8.5,-4.5],[-7.5,-4.0],[-8.5,-3.5],
  [-9.5,-4.0],[-8.0,-5.0],[-8.0,-3.0],
];

const AGENT_COLOR: Record<string,string> = Object.fromEntries(AGENTS_3D.map(a=>[a.id,a.color]));
const AGENT_EMOJI: Record<string,string> = Object.fromEntries(AGENTS_3D.map(a=>[a.id,a.emoji]));
const AGENT_NAME:  Record<string,string> = Object.fromEntries(AGENTS_3D.map(a=>[a.id,a.name]));

// ─── Color utils ──────────────────────────────────────────────────────────────
function hexToRGB(hex: string): [number,number,number] {
  const h = hex.replace("#","");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbStr(r: number, g: number, b: number, a = 1) {
  return `rgba(${r|0},${g|0},${b|0},${a})`;
}
function shadeHex(hex: string, f: number, a = 1): string {
  const [r,g,b] = hexToRGB(hex);
  return rgbStr(r*f, g*f, b*f, a);
}
function hexToRgbStr(hex: string): string {
  const [r,g,b] = hexToRGB(hex); return `${r},${g},${b}`;
}

// ─── Isometric projection ─────────────────────────────────────────────────────
interface Ctx2 { c: CanvasRenderingContext2D; ox: number; oy: number; }

function sx(ctx: Ctx2, wx: number, wz: number): number {
  return ctx.ox + (wx - wz) * TW2;
}
function sy(ctx: Ctx2, wx: number, wy: number, wz: number): number {
  return ctx.oy + (wx + wz) * TH2 - wy * HS;
}

// ─── Draw primitives ─────────────────────────────────────────────────────────
function isoTile(ctx: Ctx2, wx: number, wz: number, col: string) {
  const c = ctx.c;
  c.beginPath();
  c.moveTo(sx(ctx,wx,  wz),   sy(ctx,wx,  0,wz));
  c.lineTo(sx(ctx,wx+1,wz),   sy(ctx,wx+1,0,wz));
  c.lineTo(sx(ctx,wx+1,wz+1), sy(ctx,wx+1,0,wz+1));
  c.lineTo(sx(ctx,wx,  wz+1), sy(ctx,wx,  0,wz+1));
  c.closePath();
  c.fillStyle = col; c.fill();
}

function isoBox(
  ctx: Ctx2,
  bx: number, by: number, bz: number,
  bw: number, bh: number, bd: number,
  topCol: string, leftCol: string, rightCol: string,
) {
  const c = ctx.c;
  const x0=bx, x1=bx+bw, y0=by, y1=by+bh, z0=bz, z1=bz+bd;
  const TBL=[sx(ctx,x0,z0),sy(ctx,x0,y1,z0)];
  const TBR=[sx(ctx,x1,z0),sy(ctx,x1,y1,z0)];
  const TFR=[sx(ctx,x1,z1),sy(ctx,x1,y1,z1)];
  const TFL=[sx(ctx,x0,z1),sy(ctx,x0,y1,z1)];
  const BBR=[sx(ctx,x1,z0),sy(ctx,x1,y0,z0)];
  const BFR=[sx(ctx,x1,z1),sy(ctx,x1,y0,z1)];
  const BFL=[sx(ctx,x0,z1),sy(ctx,x0,y0,z1)];

  c.beginPath();
  c.moveTo(TFL[0]!,TFL[1]!); c.lineTo(TFR[0]!,TFR[1]!);
  c.lineTo(BFR[0]!,BFR[1]!); c.lineTo(BFL[0]!,BFL[1]!);
  c.closePath(); c.fillStyle=leftCol; c.fill();

  c.beginPath();
  c.moveTo(TBR[0]!,TBR[1]!); c.lineTo(TFR[0]!,TFR[1]!);
  c.lineTo(BFR[0]!,BFR[1]!); c.lineTo(BBR[0]!,BBR[1]!);
  c.closePath(); c.fillStyle=rightCol; c.fill();

  c.beginPath();
  c.moveTo(TBL[0]!,TBL[1]!); c.lineTo(TBR[0]!,TBR[1]!);
  c.lineTo(TFR[0]!,TFR[1]!); c.lineTo(TFL[0]!,TFL[1]!);
  c.closePath(); c.fillStyle=topCol; c.fill();
}

function isoBoxEdge(
  ctx: Ctx2, bx:number, by:number, bz:number,
  bw:number, bh:number, bd:number, col:string, alpha=0.3
) {
  const c=ctx.c;
  const x0=bx,x1=bx+bw,y0=by,y1=by+bh,z0=bz,z1=bz+bd;
  const TBL=[sx(ctx,x0,z0),sy(ctx,x0,y1,z0)];
  const TBR=[sx(ctx,x1,z0),sy(ctx,x1,y1,z0)];
  const TFR=[sx(ctx,x1,z1),sy(ctx,x1,y1,z1)];
  const TFL=[sx(ctx,x0,z1),sy(ctx,x0,y1,z1)];
  const BBR=[sx(ctx,x1,z0),sy(ctx,x1,y0,z0)];
  const BFR=[sx(ctx,x1,z1),sy(ctx,x1,y0,z1)];
  const BFL=[sx(ctx,x0,z1),sy(ctx,x0,y0,z1)];
  c.strokeStyle=col; c.globalAlpha=alpha; c.lineWidth=0.8;
  const edge=(pts:number[][])=>{
    c.beginPath();
    pts.forEach(([px,py],i)=>i===0?c.moveTo(px!,py!):c.lineTo(px!,py!));
    c.closePath(); c.stroke();
  };
  edge([TFL,TFR,BFR,BFL]);
  edge([TBR,TFR,BFR,BBR]);
  edge([TBL,TBR,TFR,TFL]);
  c.globalAlpha=1;
}

// ─── Emoji canvas cache ───────────────────────────────────────────────────────
const EMOJI_CACHE = new Map<string, HTMLCanvasElement>();
function getEmojiCanvas(emoji: string, hexColor: string): HTMLCanvasElement {
  const key = emoji + hexColor;
  if (EMOJI_CACHE.has(key)) return EMOJI_CACHE.get(key)!;
  const sz = 64;
  const ec = document.createElement("canvas");
  ec.width = ec.height = sz;
  const cx = ec.getContext("2d")!;
  const [r,g,b] = hexToRGB(hexColor);
  const grad = cx.createRadialGradient(sz/2,sz/2,4,sz/2,sz/2,sz/2);
  grad.addColorStop(0, rgbStr(r,g,b,0.30));
  grad.addColorStop(1, rgbStr(r,g,b,0));
  cx.fillStyle = grad;
  cx.beginPath(); cx.arc(sz/2,sz/2,sz/2,0,Math.PI*2); cx.fill();
  cx.strokeStyle = hexColor; cx.lineWidth = 2;
  cx.beginPath(); cx.arc(sz/2,sz/2,sz/2-2,0,Math.PI*2); cx.stroke();
  cx.font = `${sz*0.50}px serif`;
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillText(emoji, sz/2, sz/2+1);
  EMOJI_CACHE.set(key, ec);
  return ec;
}

// ─── Zone helpers ─────────────────────────────────────────────────────────────
const zoneOf = (wx: number, wz: number): string => {
  if (wx>=-1&&wx<=3  &&wz>=-6&&wz<=-1) return "cmd";
  if (wx>=6 &&wx<=12 &&wz>=-7&&wz<=-1) return "res";
  if (wx>=-9&&wx<=-3 &&wz>=-1&&wz<=5)  return "ops";
  if (wx>=-1&&wx<=5  &&wz>=1 &&wz<=6)  return "cre";
  if (wx>=6 &&wx<=14 &&wz>=-1&&wz<=5)  return "inf";
  if (wx>=-2&&wx<=5  &&wz>=6 &&wz<=10) return "exe";
  if (wx>=-10&&wx<=-5&&wz>=4 &&wz<=9)  return "brk";
  if (wx>=-11&&wx<=-5&&wz>=-7&&wz<=-1) return "mtg";
  if (wx>=6 &&wx<=14 &&wz>=6 &&wz<=11) return "srv";
  return "def";
};
const ZONE_COLOR: Record<string,string> = {
  cmd:"#082218",res:"#110b2a",ops:"#070e26",cre:"#1c0a1a",
  inf:"#1a0d00",exe:"#1a1400",brk:"#071a10",mtg:"#060d1f",
  srv:"#1a0505",def:"#060c18",
};
const ZONE_EDGE: Record<string,string> = {
  cmd:"#10b98118",res:"#8b5cf618",ops:"#3b82f618",cre:"#ec489918",
  inf:"#f9731618",exe:"#eab30818",brk:"#22c55e18",mtg:"#60a5fa18",
  srv:"#ef444418",def:"#1e293b",
};

// ─── Background renderer (no shadowBlur) ─────────────────────────────────────
function renderBg(ctx2: Ctx2, t: number) {
  const c = ctx2.c;
  const W = (c.canvas as HTMLCanvasElement).width;
  const H = (c.canvas as HTMLCanvasElement).height;

  c.fillStyle = "#020812";
  c.fillRect(0, 0, W, H);

  // Floor tiles — depth-ordered two-loop (no painter's algo needed for flat tiles)
  for (let d = -19; d <= 25; d++) {
    for (let wx = Math.max(-11, d-11); wx <= Math.min(14, d+8); wx++) {
      const wz = d - wx;
      if (wz < -8 || wz > 11) continue;
      const zk = zoneOf(wx, wz);
      isoTile(ctx2, wx, wz, ZONE_COLOR[zk]!);
      c.globalAlpha = 0.13;
      c.strokeStyle = ZONE_EDGE[zk] ?? "#1e293b";
      c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(sx(ctx2,wx,  wz),   sy(ctx2,wx,  0,wz));
      c.lineTo(sx(ctx2,wx+1,wz),   sy(ctx2,wx+1,0,wz));
      c.lineTo(sx(ctx2,wx+1,wz+1), sy(ctx2,wx+1,0,wz+1));
      c.lineTo(sx(ctx2,wx,  wz+1), sy(ctx2,wx,  0,wz+1));
      c.closePath(); c.stroke();
      c.globalAlpha = 1;
    }
  }

  // Zone perimeter lines (no shadowBlur — just alpha stroke)
  const zones = [
    {x:-1, z:-6,w:4, d2:5, col:"#10b981"},{x: 6, z:-7,w:6, d2:6, col:"#8b5cf6"},
    {x:-9, z:-1,w:6, d2:6, col:"#3b82f6"},{x:-1, z: 1,w:6, d2:5, col:"#ec4899"},
    {x: 6, z:-1,w:8, d2:6, col:"#f97316"},{x:-2, z: 6,w:7, d2:4, col:"#eab308"},
    {x:-10,z: 4,w:5, d2:5, col:"#22c55e"},{x:-11,z:-7,w:6, d2:6, col:"#60a5fa"},
    {x: 6, z: 6,w:8, d2:5, col:"#ef4444"},
  ];
  zones.forEach(z => {
    c.strokeStyle = z.col; c.globalAlpha = 0.22; c.lineWidth = 1.5;
    const pts: [number,number][] = [
      [sx(ctx2,z.x,       z.z),      sy(ctx2,z.x,       0.01,z.z)],
      [sx(ctx2,z.x+z.w,   z.z),      sy(ctx2,z.x+z.w,   0.01,z.z)],
      [sx(ctx2,z.x+z.w,   z.z+z.d2), sy(ctx2,z.x+z.w,   0.01,z.z+z.d2)],
      [sx(ctx2,z.x,       z.z+z.d2), sy(ctx2,z.x,       0.01,z.z+z.d2)],
    ];
    c.beginPath();
    pts.forEach(([px,py],i)=>i===0?c.moveTo(px,py):c.lineTo(px,py));
    c.closePath(); c.stroke(); c.globalAlpha=1;
  });

  // Server racks (depth-sorted inline)
  const rackColors = ["#22c55e","#3b82f6","#f97316","#a855f7"];
  const rackItems: DrawItem[] = [];
  for (let ri = 0; ri < 4; ri++) {
    for (let rj = 0; rj < 2; rj++) {
      const rx = 8 + ri*1.5, rz = 7.5 + rj*1.3;
      const rc = rackColors[ri % rackColors.length]!;
      rackItems.push({ depth: rx+rz, fn: () => {
        isoBox(ctx2, rx-0.35,0,rz-0.25, 0.7,1.8,0.5,
          shadeHex(rc,0.15),shadeHex(rc,0.10),shadeHex(rc,0.07));
        isoBoxEdge(ctx2, rx-0.35,0,rz-0.25, 0.7,1.8,0.5, rc, 0.22);
        // LED strips (no shadow — use bright fill color)
        for (let k = 0; k < 5; k++) {
          const blink = Math.sin(t*3.5+(ri*2+rj)*1.7+k*0.9) > 0;
          const ledCol = blink ? rc : "#0a1428";
          const ky = 0.25 + k*0.28;
          isoBox(ctx2, rx-0.28,ky,rz-0.23, 0.56,0.14,0.04,
            shadeHex(ledCol,1.2),shadeHex(ledCol,0.8),shadeHex(ledCol,0.6));
        }
      }});
    }
  }
  rackItems.sort((a,b)=>a.depth-b.depth);
  rackItems.forEach(i=>i.fn());

  // Conference table
  isoBox(ctx2,-9.5,-0.02,-5.0, 3.0,0.14,2.0, "#0d1e38","#080f1e","#060c17");
  isoBoxEdge(ctx2,-9.5,0.12,-5.0, 3.0,0.01,2.0, "#3b82f699",0.4);
  for (const [lx,lz] of [[-9.2,-4.7],[-6.8,-4.7],[-9.2,-2.7],[-6.8,-2.7]] as [number,number][]) {
    isoBox(ctx2,lx,0,lz, 0.1,0.72,0.1, "#0a1428","#070e1f","#050b16");
  }

  // Plants
  const plantPos: [number,number][] = [
    [-10,4.5],[-10,8],[3,10.5],[-3,-2],[5,-7.5],[14,-1.5],[14,5.5],[-2,10]
  ];
  const plantItems: DrawItem[] = plantPos.map(([px,pz]) => ({
    depth: px+pz, fn: () => {
      isoBox(ctx2,px-0.15,0,pz-0.12, 0.3,0.28,0.24, "#5a2820","#3d1a14","#2e1410");
      const sway = Math.sin(t*0.8+(px+pz)*0.7)*0.03;
      const lx2 = sx(ctx2, px+sway, pz);
      const ly2 = sy(ctx2, px, 0.38, pz);
      for (let li = 0; li < 3; li++) {
        const g = 80 + li*30, alpha = 0.85-li*0.12;
        c.fillStyle = rgbStr(10, g, 20, alpha);
        c.beginPath();
        c.ellipse(lx2+sway*18, ly2-li*8, (14-li*3)*(TW2/40), (7-li)*(TH2/20), 0,0,Math.PI*2);
        c.fill();
      }
    }
  }));
  plantItems.sort((a,b)=>a.depth-b.depth);
  plantItems.forEach(i=>i.fn());

  // Desks for each agent (static skeleton — monitors NOT animated here)
  const deskItems: DrawItem[] = AGENTS_3D.map(agent => {
    const [dx,dz] = DESK_XZ[agent.id] ?? [0,0];
    const ac = AGENT_COLOR[agent.id]!;
    return { depth: dx+dz-0.05, fn: () => {
      isoBox(ctx2,dx-0.65,0,dz-0.4, 1.3,0.08,0.8, "#0d1e35","#081428","#06101f");
      for (const [dlx,dlz] of [[-0.55,-0.32],[0.55,-0.32],[-0.55,0.32],[0.55,0.32]] as [number,number][]) {
        isoBox(ctx2,dx+dlx-0.04,0,dz+dlz-0.03, 0.08,0.72,0.06, "#070e1a","#050b14","#030811");
      }
      isoBox(ctx2,dx-0.28,0.46,dz+0.28, 0.56,0.06,0.5, "#101827","#0a1020","#070c18");
      isoBox(ctx2,dx-0.28,0.52,dz+0.64, 0.56,0.5,0.06,  "#101827","#0a1020","#070c18");
      isoBox(ctx2,dx-0.03,0.08,dz-0.03, 0.06,0.28,0.06, "#080e1c","#060b16","#040910");
      isoBox(ctx2,dx-0.4, 0.36,dz-0.04, 0.8,0.52,0.05,
        shadeHex(ac,0.10),shadeHex(ac,0.07),shadeHex(ac,0.04));
      isoBox(ctx2,dx-0.27,0.09,dz+0.1,  0.54,0.02,0.22, "#0a1428","#070e1a","#050b14");
    }};
  });
  deskItems.sort((a,b)=>a.depth-b.depth);
  deskItems.forEach(i=>i.fn());
}

// ─── Dynamic agent items ──────────────────────────────────────────────────────
function buildAgents(
  ctx2: Ctx2, t: number,
  animPos: Map<string, AgentAnim>,
  statusMap: Map<string, AgentStatus>,
  selectedAgent: string | null,
  meetingSet: Set<string>,
  emotionMap: Map<string, { emoji: string; reason: string }>,
  hitBoxes: Map<string, { sx: number; sy: number; r: number }>,
  frameCount: number,
): DrawItem[] {
  const c = ctx2.c;
  const items: DrawItem[] = [];

  AGENTS_3D.forEach(agent => {
    const anim   = animPos.get(agent.id);
    const px = anim?.cx ?? DESK_XZ[agent.id]?.[0] ?? 0;
    const pz = anim?.cz ?? DESK_XZ[agent.id]?.[1] ?? 0;
    const status = statusMap.get(agent.id);
    const isWork = status?.status === "working";
    const isIdle = status?.status === "idle";
    const isErr  = status?.status === "error";
    const isSel  = agent.id === selectedAgent;
    const ac     = AGENT_COLOR[agent.id]!;
    const [cr,cg,cb] = hexToRGB(ac);
    const emotion = emotionMap.get(agent.id);
    const emoji   = emotion?.emoji ?? AGENT_EMOJI[agent.id]!;
    const phase   = (agent.id.charCodeAt(0) + agent.id.charCodeAt(1)) * 0.41;

    items.push({ depth: px + pz + 0.12, fn: () => {
      const scx = sx(ctx2, px, pz);
      const scy = sy(ctx2, px, 0,  pz);

      // ── Monitor screen (animated — drawn on desk face)
      {
        const sw = 0.72;
        const sTL = [sx(ctx2,px-sw/2,pz-0.02), sy(ctx2,px-sw/2,0.87,pz-0.02)];
        const sTR = [sx(ctx2,px+sw/2,pz-0.02), sy(ctx2,px+sw/2,0.87,pz-0.02)];
        const sBR = [sx(ctx2,px+sw/2,pz-0.02), sy(ctx2,px+sw/2,0.38,pz-0.02)];
        const sBL = [sx(ctx2,px-sw/2,pz-0.02), sy(ctx2,px-sw/2,0.38,pz-0.02)];
        c.save();
        c.beginPath();
        c.moveTo(sTL[0]!,sTL[1]!); c.lineTo(sTR[0]!,sTR[1]!);
        c.lineTo(sBR[0]!,sBR[1]!); c.lineTo(sBL[0]!,sBL[1]!);
        c.closePath(); c.clip();
        if (isWork) {
          c.fillStyle = rgbStr(cr*0.06,cg*0.06,cb*0.06);
          c.fillRect(sTL[0]!-2,sTL[1]!-2,200,200);
          const rows = 8;
          const rowH = (sBL[1]!-sTL[1]!) / rows;
          const scrollOffset = (Math.floor(t*0.7+phase)*1) % rows;
          for (let row = 0; row < rows; row++) {
            const rr = (row + scrollOffset) % rows;
            const ry = sTL[1]! + rr*rowH;
            const seed = (rr*37+agent.id.charCodeAt(0)+frameCount*0) >>> 0;
            const lineLen = 0.25 + 0.68*((seed*2654435761)>>>0)/0xffffffff;
            const bright = row % 3 === 0 ? 0.50 : 0.22;
            c.fillStyle = rgbStr(cr,cg,cb,bright);
            c.fillRect(sTL[0]!+(sTR[0]!-sTL[0]!)*0.05, ry+rowH*0.12,
              (sTR[0]!-sTL[0]!)*lineLen*0.88, rowH*0.52);
          }
          // Cursor blink (no shadow)
          if (Math.sin(t*Math.PI*2) > 0) {
            const curRow = Math.floor(t*1.2) % rows;
            const cy2 = sTL[1]! + curRow*rowH;
            c.fillStyle = rgbStr(cr,cg,cb,0.90);
            c.fillRect(sTL[0]!+(sTR[0]!-sTL[0]!)*0.08, cy2+rowH*0.1, 4, rowH*0.75);
          }
          // Screen outline (alpha only, no shadow)
          c.strokeStyle = rgbStr(cr,cg,cb,0.40); c.lineWidth=0.8;
          c.beginPath();
          c.moveTo(sTL[0]!,sTL[1]!); c.lineTo(sTR[0]!,sTR[1]!);
          c.lineTo(sBR[0]!,sBR[1]!); c.lineTo(sBL[0]!,sBL[1]!);
          c.closePath(); c.stroke();
        } else {
          c.fillStyle = rgbStr(cr*0.02,cg*0.02,cb*0.02);
          c.fillRect(sTL[0]!-2,sTL[1]!-2,200,200);
          c.fillStyle = rgbStr(cr*0.25,cg*0.25,cb*0.25,0.5);
          c.beginPath();
          c.arc((sTL[0]!+sTR[0]!)/2,(sTL[1]!+sBL[1]!)/2,2,0,Math.PI*2);
          c.fill();
        }
        c.restore();
      }

      // ── Status ring (ellipse, alpha-only — no shadow)
      {
        const pulse = isWork ? 0.45+0.55*Math.sin(t*3.8+phase)
                    : isIdle ? 0.30+0.45*Math.sin(t*1.5+phase)
                    : isErr  ? (Math.sin(t*6)>0?0.9:0.15)
                    : 0.12;
        const rR  = TW2*0.54, rRY = rR*(TH2/TW2)*0.85;

        // Ring inner glow fill (pure alpha)
        c.fillStyle = rgbStr(cr,cg,cb, 0.08*pulse);
        c.beginPath(); c.ellipse(scx,scy,rR,rRY,0,0,Math.PI*2); c.fill();

        // Ring stroke
        c.strokeStyle = rgbStr(cr,cg,cb,pulse);
        c.lineWidth = isSel ? 2.2 : 1.2;
        c.beginPath(); c.ellipse(scx,scy,rR,rRY,0,0,Math.PI*2); c.stroke();

        // Working: rotating arc (no shadow)
        if (isWork) {
          const arcS = t*1.8+phase;
          c.strokeStyle = rgbStr(cr,cg,cb,0.65);
          c.lineWidth = 2.0;
          c.beginPath();
          c.ellipse(scx,scy,rR,rRY,0,arcS,arcS+Math.PI*0.8);
          c.stroke();
        }
      }

      // ── Agent body (no shadow)
      {
        const bob = isWork ? Math.sin(t*4+phase)*2.5 : Math.sin(t*1.3+phase)*0.8;
        const bodyTop = 0.78+bob/HS, bodyH = 0.72;
        const bodyBright = isWork ? 0.30 : 0.18;
        isoBox(ctx2,
          px-0.2,bodyTop-bodyH,pz-0.18, 0.4,bodyH,0.36,
          shadeHex(ac,bodyBright),shadeHex(ac,bodyBright*0.7),shadeHex(ac,bodyBright*0.5));
        isoBoxEdge(ctx2,
          px-0.2,bodyTop-bodyH,pz-0.18, 0.4,bodyH,0.36, ac, 0.25);

        // Head
        const headY = bodyTop+0.08;
        isoBox(ctx2, px-0.19,headY,pz-0.17, 0.38,0.38,0.34,
          shadeHex(ac,0.40),shadeHex(ac,0.28),shadeHex(ac,0.20));

        // Emoji face
        const faceW = TW2*0.54;
        const fsx = sx(ctx2,px,pz);
        const fsy = sy(ctx2,px,headY+0.30,pz)-bob;
        const ec = getEmojiCanvas(emoji, ac);
        c.globalAlpha = 0.88;
        c.drawImage(ec, fsx-faceW, fsy-faceW*0.9, faceW*2, faceW*1.8);
        c.globalAlpha = 1;

        hitBoxes.set(agent.id, { sx: fsx, sy: fsy, r: faceW*1.1 });
      }

      // ── Error indicator (no shadow)
      if (isErr) {
        const ex = scx + Math.sin(t*14)*3;
        const ey = sy(ctx2,px,1.8,pz);
        c.fillStyle = `rgba(239,68,68,${Math.sin(t*5)>0?0.85:0.15})`;
        c.font = "bold 10px 'Space Mono',monospace";
        c.textAlign = "center";
        c.fillText("⚠ ERR", ex, ey);
      }
    }});
  });

  return items;
}

// ─── Zone label definitions ────────────────────────────────────────────────────
const ZONE_LABELS = [
  { name:"COMMAND CENTER",  px:52, py:26, col:"#34d399" },
  { name:"RESEARCH LAB",    px:72, py:20, col:"#a78bfa" },
  { name:"MEETING ROOM",    px:28, py:24, col:"#60a5fa" },
  { name:"OPS HUB",         px:30, py:46, col:"#fb923c" },
  { name:"CREATIVE STUDIO", px:52, py:50, col:"#f472b6" },
  { name:"INFRA BAY",       px:73, py:46, col:"#38bdf8" },
  { name:"EXECUTIVE SUITE", px:52, py:68, col:"#fde047" },
  { name:"SERVER ROOM",     px:74, py:68, col:"#fb7185" },
  { name:"BREAK ROOM",      px:27, py:70, col:"#86efac" },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export function Office3D({
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  activeThreads = [],
  agentEmotions = new Map(),
}: Office3DProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef       = useRef(0);
  const t0Ref        = useRef(performance.now());
  const frameRef     = useRef(0);

  const statusRef   = useRef(agentStatuses);
  const threadsRef  = useRef(activeThreads);
  const selectedRef = useRef(selectedAgent);
  const emotionsRef = useRef(agentEmotions);
  statusRef.current  = agentStatuses;
  threadsRef.current = activeThreads;
  selectedRef.current= selectedAgent;
  emotionsRef.current= agentEmotions;

  const animRef   = useRef<Map<string,AgentAnim>>(new Map(
    AGENTS_3D.map(a=>[a.id,{
      cx:DESK_XZ[a.id]?.[0]??0, cz:DESK_XZ[a.id]?.[1]??0,
      tx:DESK_XZ[a.id]?.[0]??0, tz:DESK_XZ[a.id]?.[1]??0,
    }])
  ));
  const mailRef   = useRef<MailParticle[]>([]);
  const hitBoxRef = useRef<Map<string,{sx:number;sy:number;r:number}>>(new Map());

  const [labels, setLabels] = useState<
    Array<{agentId:string;sx:number;sy:number;visible:boolean}>
  >([]);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Offscreen background canvas
    const bgCanvas = document.createElement("canvas");
    const bgCtx    = bgCanvas.getContext("2d")!;
    let bgOrbitX = Infinity, bgOrbitY = Infinity, bgW = 0, bgH = 0;

    const resize = () => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
      bgOrbitX = Infinity; // force BG re-render on resize
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Mail spawner
    const mailTimer = setInterval(() => {
      const working = statusRef.current.filter(s=>s.status==="working");
      if (working.length < 2) return;
      const from = working[Math.floor(Math.random()*working.length)]!;
      const to   = working[Math.floor(Math.random()*working.length)]!;
      if (from.agentId===to.agentId) return;
      if (!DESK_XZ[from.agentId]||!DESK_XZ[to.agentId]) return;
      mailRef.current.push({
        fromX:DESK_XZ[from.agentId]![0], fromZ:DESK_XZ[from.agentId]![1],
        toX:  DESK_XZ[to.agentId]![0],   toZ:  DESK_XZ[to.agentId]![1],
        color:AGENT_COLOR[from.agentId]??"#10b981",
        born: performance.now(), life:2600,
      });
    }, 2800);

    // ── 20 fps render loop ────────────────────────────────────────────────────
    const TARGET_MS = 1000 / 20;
    let lastRender = 0;

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      const now = performance.now();
      if (now - lastRender < TARGET_MS) return;
      lastRender = now;

      frameRef.current++;
      const t = (now - t0Ref.current) / 1000;
      const W = canvas.width, H = canvas.height;

      // Orbit (very slow pan)
      const orbitX = Math.sin(t*0.028)*28;
      const orbitY = Math.cos(t*0.018)*11;

      const ctx2: Ctx2 = { c: ctx, ox: W*0.52+orbitX, oy: H*0.28+orbitY };

      // ── Re-render background if orbit moved >2px or size changed ──────────
      if (
        Math.abs(orbitX-bgOrbitX)>2 || Math.abs(orbitY-bgOrbitY)>2 ||
        bgW!==W || bgH!==H
      ) {
        bgCanvas.width  = W;
        bgCanvas.height = H;
        bgW=W; bgH=H; bgOrbitX=orbitX; bgOrbitY=orbitY;
        const bgCtx2: Ctx2 = { c: bgCtx, ox: ctx2.ox, oy: ctx2.oy };
        renderBg(bgCtx2, t);
      }

      // Blit background
      ctx.drawImage(bgCanvas, 0, 0);

      // ── Update agent smooth positions ────────────────────────────────────
      const meetingSet = new Set<string>(
        threadsRef.current.filter(th=>th.active).flatMap(th=>th.participants)
      );
      const meetArr = [...meetingSet];
      animRef.current.forEach((anim,id) => {
        const inMeet = meetingSet.has(id);
        if (inMeet) {
          const idx = meetArr.indexOf(id);
          const seat = MEETING_SEATS[idx%MEETING_SEATS.length];
          if (seat){ anim.tx=seat[0]; anim.tz=seat[1]; }
        } else {
          anim.tx = DESK_XZ[id]?.[0]??0;
          anim.tz = DESK_XZ[id]?.[1]??0;
        }
        anim.cx += (anim.tx-anim.cx)*0.07;
        anim.cz += (anim.tz-anim.cz)*0.07;
      });

      // ── Build & draw dynamic agent layer ─────────────────────────────────
      const statusMap = new Map(statusRef.current.map(s=>[s.agentId,s]));
      const items = buildAgents(
        ctx2, t, animRef.current, statusMap,
        selectedRef.current, meetingSet,
        emotionsRef.current, hitBoxRef.current, frameRef.current
      );
      items.sort((a,b)=>a.depth-b.depth);
      items.forEach(i=>i.fn());

      // ── Mail particles (drawn on top) ─────────────────────────────────────
      mailRef.current = mailRef.current.filter(p => {
        const age = (now-p.born)/p.life;
        if (age>=1) return false;
        const wx = p.fromX+(p.toX-p.fromX)*age;
        const wz = p.fromZ+(p.toZ-p.fromZ)*age;
        const wy = 1.5+Math.sin(age*Math.PI)*2.0;
        const psx = sx(ctx2,wx,wz), psy = sy(ctx2,wx,wy,wz);
        const fade = 1-age*age;
        const [pr,pg,pb] = hexToRGB(p.color);
        ctx.fillStyle  = rgbStr(pr,pg,pb,0.85*fade);
        ctx.beginPath(); ctx.arc(psx,psy,4,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle= rgbStr(pr,pg,pb,0.6*fade);
        ctx.lineWidth  = 0.8; ctx.strokeRect(psx-4,psy-3,8,6);
        ctx.beginPath();
        ctx.moveTo(psx-4,psy-3); ctx.lineTo(psx,psy); ctx.lineTo(psx+4,psy-3);
        ctx.stroke();
        return true;
      });

      // ── HTML label positions (every 4 frames) ─────────────────────────────
      if (frameRef.current % 4 === 0) {
        const newLabels = AGENTS_3D.map(a => {
          const anim = animRef.current.get(a.id);
          const lsx = sx(ctx2, anim?.cx??0, anim?.cz??0);
          const lsy = sy(ctx2, anim?.cx??0, 2.0, anim?.cz??0);
          const vis = lsx>-10&&lsx<W+10&&lsy>-10&&lsy<H+50;
          return { agentId:a.id, sx:lsx, sy:lsy, visible:vis };
        });
        setLabels(newLabels);
      }
    };

    render();
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearInterval(mailTimer);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Click handler ─────────────────────────────────────────────────────────
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX-rect.left, my = e.clientY-rect.top;
    let closest="", closestD=999;
    hitBoxRef.current.forEach((hb,id)=>{
      const d = Math.hypot(mx-hb.sx, my-hb.sy);
      if (d<hb.r&&d<closestD){ closestD=d; closest=id; }
    });
    if (closest) onSelectAgent(closest);
  };

  // ── Derived stats ─────────────────────────────────────────────────────────
  const workingCnt = agentStatuses.filter(s=>s.status==="working").length;
  const idleCnt    = agentStatuses.filter(s=>s.status==="idle").length;
  const errorCnt   = agentStatuses.filter(s=>s.status==="error").length;
  const meetCnt    = activeThreads.filter(t=>t.active).length;

  const selAgent  = selectedAgent ? AGENTS_3D.find(a=>a.id===selectedAgent) : null;
  const selStatus = selectedAgent ? agentStatuses.find(s=>s.agentId===selectedAgent) : null;

  return (
    <div ref={containerRef}
      style={{ position:"relative",width:"100%",height:"100%",overflow:"hidden",
               background:"#020812",fontFamily:"'Space Mono',monospace" }}>

      <canvas ref={canvasRef} onClick={handleClick}
        style={{ position:"absolute",inset:0,cursor:"crosshair" }} />

      {/* HTML label overlay */}
      <div style={{ position:"absolute",inset:0,pointerEvents:"none",zIndex:5 }}>
        {labels.map(l => {
          if (!l.visible) return null;
          const s     = agentStatuses.find(a=>a.agentId===l.agentId);
          const color = AGENT_COLOR[l.agentId]??"#38bdf8";
          const isWork= s?.status==="working";
          const isSel = l.agentId===selectedAgent;
          return (
            <div key={l.agentId} style={{
              position:"absolute",left:`${l.sx}px`,top:`${l.sy}px`,
              transform:"translate(-50%,0)",textAlign:"center",
              zIndex:isSel?20:isWork?10:5,
            }}>
              <div style={{
                fontSize:"9px",fontWeight:"bold",letterSpacing:"0.06em",
                color:isSel?color:isWork?color:"#334155",
                textShadow:`0 0 8px ${color}66,0 1px 3px rgba(0,0,0,0.9)`,
                whiteSpace:"nowrap",
              }}>
                {AGENT_NAME[l.agentId]}
              </div>
              {isWork && s?.currentTask && (
                <div style={{
                  marginTop:"2px",background:`rgba(${hexToRgbStr(color)},0.10)`,
                  border:`1px solid rgba(${hexToRgbStr(color)},0.35)`,
                  borderRadius:"5px",padding:"1px 6px",
                  fontSize:"8px",color,whiteSpace:"nowrap",
                  maxWidth:"160px",overflow:"hidden",textOverflow:"ellipsis",
                  textShadow:"0 1px 3px rgba(0,0,0,0.9)",
                }}>
                  {s.currentTask.slice(0,32)}{s.currentTask.length>32?"…":""}
                </div>
              )}
            </div>
          );
        })}

        {ZONE_LABELS.map(z=>(
          <div key={z.name} style={{
            position:"absolute",left:`${z.px}%`,top:`${z.py}%`,
            transform:"translateX(-50%)",fontSize:"8px",color:z.col,
            opacity:0.28,fontWeight:"bold",letterSpacing:"0.14em",
            textShadow:`0 0 8px ${z.col}`,whiteSpace:"nowrap",
          }}>
            {z.name}
          </div>
        ))}
      </div>

      {/* Top HUD */}
      <div style={{
        position:"absolute",top:0,left:0,right:0,zIndex:10,
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"5px 14px",
        background:"rgba(2,8,18,0.90)",borderBottom:"1px solid rgba(16,185,129,0.15)",
        backdropFilter:"blur(6px)",
      }}>
        <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
          <span style={{ width:"6px",height:"6px",borderRadius:"50%",display:"inline-block",
            background:"#10b981",boxShadow:"0 0 8px #10b981" }} />
          <span style={{ fontSize:"10px",color:"#10b981",fontWeight:"bold",letterSpacing:"0.12em" }}>
            DLAVIE OS — AGENT OFFICE
          </span>
          <span style={{ fontSize:"8px",color:"#1e3a5f" }}>
            [ISO-3D · LIVE · {AGENTS_3D.length} AGENTS]
          </span>
        </div>
        <div style={{ display:"flex",gap:"20px" }}>
          {([
            [workingCnt,"WORKING","#10b981"],[idleCnt,"IDLE","#3b82f6"],
            [errorCnt,"ERROR","#ef4444"],[meetCnt,"MEETINGS","#8b5cf6"],
          ] as [number,string,string][]).map(([v,l,col])=>(
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontSize:"14px",fontWeight:"bold",color:col,lineHeight:1 }}>{v}</div>
              <div style={{ fontSize:"7px",color:"#334155",letterSpacing:"0.08em" }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex",gap:"10px",alignItems:"center" }}>
          {([ ["#10b981","Working"],["#3b82f6","Idle"],["#ef4444","Error"],["#475569","Offline"] ] as [string,string][]).map(([col,l])=>(
            <span key={l} style={{ display:"flex",alignItems:"center",gap:"4px",fontSize:"8px",color:"#475569" }}>
              <span style={{ width:"5px",height:"5px",borderRadius:"50%",background:col,display:"inline-block" }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Selected agent panel */}
      {selAgent && selStatus && (
        <div style={{
          position:"absolute",bottom:"36px",right:"12px",zIndex:20,width:"220px",
          background:"rgba(2,8,23,0.97)",border:`1px solid ${selAgent.color}44`,
          borderRadius:"12px",padding:"12px 14px",
          boxShadow:`0 0 24px ${selAgent.color}18`,backdropFilter:"blur(8px)",
        }}>
          <button onClick={()=>onSelectAgent(selAgent.id)} style={{
            position:"absolute",top:"8px",right:"10px",
            background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:"14px",
          }}>×</button>
          <div style={{ display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px" }}>
            <div style={{
              width:"34px",height:"34px",borderRadius:"50%",fontSize:"17px",
              background:`${selAgent.color}20`,border:`2px solid ${selAgent.color}`,
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              {agentEmotions.get(selAgent.id)?.emoji ?? selAgent.emoji}
            </div>
            <div>
              <div style={{ fontSize:"11px",fontWeight:"bold",color:selAgent.color }}>
                {AGENT_NAME[selAgent.id]}
              </div>
              <div style={{
                fontSize:"9px",textTransform:"uppercase",letterSpacing:"0.06em",
                color:selStatus.status==="working"?"#10b981"
                     :selStatus.status==="error"?"#ef4444"
                     :selStatus.status==="idle"?"#3b82f6":"#475569",
              }}>
                ● {selStatus.status}
              </div>
            </div>
          </div>
          {selStatus.currentTask && (
            <div style={{
              fontSize:"9px",color:"#94a3b8",lineHeight:1.7,
              background:"rgba(15,23,42,0.7)",border:"1px solid rgba(30,41,59,0.6)",
              borderRadius:"6px",padding:"6px 8px",
            }}>
              <div style={{ color:"#334155",fontSize:"8px",marginBottom:"3px",letterSpacing:"0.08em" }}>
                CURRENT TASK
              </div>
              {selStatus.currentTask}
            </div>
          )}
          {agentEmotions.get(selAgent.id) && (
            <div style={{
              marginTop:"8px",fontSize:"9px",color:"#64748b",
              background:"rgba(15,23,42,0.5)",borderRadius:"6px",padding:"4px 8px",
            }}>
              <span style={{ opacity:0.5,marginRight:"4px" }}>FEELING</span>
              {agentEmotions.get(selAgent.id)?.reason}
            </div>
          )}
        </div>
      )}

      {/* Bottom ticker */}
      <div style={{
        position:"absolute",bottom:0,left:0,right:0,zIndex:10,
        padding:"4px 14px",
        background:"rgba(2,8,18,0.92)",borderTop:"1px solid rgba(16,185,129,0.10)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
      }}>
        <div style={{ display:"flex",gap:"18px",alignItems:"center",overflow:"hidden" }}>
          {agentStatuses.filter(s=>s.status==="working").slice(0,5).map(s=>(
            <span key={s.agentId} style={{
              fontSize:"8px",color:AGENT_COLOR[s.agentId]??"#38bdf8",
              display:"flex",alignItems:"center",gap:"4px",whiteSpace:"nowrap",
            }}>
              <span style={{ width:"4px",height:"4px",borderRadius:"50%",display:"inline-block",
                background:AGENT_COLOR[s.agentId]??"#38bdf8" }} />
              {AGENT_NAME[s.agentId]??s.agentId}
              {s.currentTask?` · ${s.currentTask.slice(0,24)}…`:""}
            </span>
          ))}
        </div>
        <span style={{ fontSize:"8px",color:"#1e3a5f",whiteSpace:"nowrap" }}>
          Isometric 3D · click agent to inspect
        </span>
      </div>
    </div>
  );
}
