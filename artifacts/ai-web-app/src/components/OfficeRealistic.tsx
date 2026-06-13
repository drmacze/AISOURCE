/**
 * OfficeRealistic.tsx — DLavie OS  ·  3D Isometric Office (Canvas 2D)
 *
 * Rendering approach:
 *  • World-space isometric projection for floors/furniture (box() helper)
 *  • Pixel-space 3D characters at their iso-projected screen position
 *  • Sphere gradient head  +  3-face box body  → volumetric look without WebGL
 *  • Atmospheric depth fog (far objects fade to warm cream)
 *  • Ambient-occlusion ground shadow under every object
 *  • Warm realistic palette: cream floors, oak desks, charcoal chairs
 *
 * Camera:
 *  • Mouse drag → pan    Mouse wheel → zoom
 *  • Touch drag  → pan   Pinch-to-zoom → zoom
 *
 * Simulation (50 ms tick):
 *  • Per-agent state machine → elevator queue → meeting room → return
 *  • 10 activity animations: typing, drinking, chatting, stretching,
 *    presenting, nodding, drowsy, sleeping, phone, idle
 */

import { useEffect, useRef, useCallback } from "react";

// ════════════════════════════════════════════════════════════════════════
//  TYPES
// ════════════════════════════════════════════════════════════════════════

type Activity =
  | "typing" | "drinking" | "chatting" | "stretching"
  | "presenting" | "nodding" | "drowsy" | "sleeping"
  | "phone" | "idle" | "walking" | "waiting";

type Macro =
  | "at_desk" | "walk_to_elv" | "queuing"
  | "in_elevator" | "walk_from_elv"
  | "walk_to_meeting" | "in_meeting"
  | "walk_to_elv_return" | "queuing_return"
  | "in_elevator_return" | "walk_to_desk";

interface AgentSim {
  id: string; name: string; emoji: string; color: string;
  x: number; z: number; floor: 0 | 1;
  tx: number; tz: number; tfloor: 0 | 1;
  deskX: number; deskZ: number;
  seatIdx: number;
  phase: number; walkPhase: number;
  macro: Macro; activity: Activity;
  actTimer: number; stTimer: number;
  chatPartner: string | null;
  bubble: string | null; bubbleTimer: number;
  facingAngle: number;
}

interface ElevatorSim {
  floor: 0 | 1; carY: number; target: 0 | 1;
  door: number; doorState: "closed"|"opening"|"open"|"closing";
  moveState: "idle"|"loading"|"moving"|"unloading";
  timer: number; passengers: string[];
  queue: Array<{ agentId: string; dest: 0|1 }>;
}

interface AgentStatus { agentId: string; status: string; currentTask?: string|null; }
interface Thread { id: string; active: boolean; participants: string[]; topic?: string; }

export interface OfficeRealisticProps {
  agentStatuses:   AgentStatus[];
  selectedAgent:   string | null;
  onSelectAgent:   (id: string) => void;
  activeThreads?:  Thread[];
  agentEmotions?:  Map<string, { emoji: string; reason: string }>;
  agentPositions?: Map<string, { state: string; target?: string }>;
  particles?:      unknown;
}

// ════════════════════════════════════════════════════════════════════════
//  ISOMETRIC CONSTANTS
// ════════════════════════════════════════════════════════════════════════

const TW2 = 24;        // half-tile width  (tile = 48 px)
const TH2 = 12;        // half-tile height (tile = 24 px)
const FLOOR_H = 110;   // screen pixels per world-Y unit
const AGENT_SPD = 0.09;
const ELV_X = 11, ELV_Z = 7;
const ELV_CAP = 4;
const TICK_MS = 50;

// ════════════════════════════════════════════════════════════════════════
//  WARM REALISTIC PALETTE
// ════════════════════════════════════════════════════════════════════════

const PAL = {
  floorA:    "#ddd5c9",   // warm cream tile A
  floorB:    "#d4cbc0",   // warm cream tile B
  floorShadow:"rgba(80,60,40,0.08)",
  wallTop:   "#c8c0b4",   // beige wall top
  wallLeft:  "#b0a898",
  wallRight: "#9a9080",
  deskTop:   "#b08448",   // warm oak top
  deskLeft:  "#8a6432",
  deskRight: "#6e4e22",
  chairTop:  "#4a6272",   // blue-grey chair seat
  chairLeft: "#334a5a",
  chairRight:"#243848",
  monTop:    "#1e2a34",
  monLeft:   "#141e28",
  monRight:  "#0e1820",
  tableTop:  "#7c5c34",   // dark oak table
  tableLeft: "#5c4224",
  tableRight:"#4a3218",
  elvTop:    "#9aaabb",   // silver elevator
  elvLeft:   "#7a8a9a",
  elvRight:  "#5a6a7a",
  elvCar:    "#6a7a8a",
  breakSofa: "#3d5872",
  carpet0:   "#c4bdb0",   // meeting room carpet
  carpet1:   "#bdb5a8",
  plantGreen:"#4a7a40",
  sky:       "#1a1614",   // background
  fog:       [220, 210, 200] as [number,number,number],
};

// Zone overlays for Floor 2 (desks)
const ZONES_F1 = [
  { name:"Command",    color:"#7a6030", x:1, z:1, w:7, d:3  },
  { name:"Research",   color:"#5a4a7a", x:1, z:4, w:7, d:5  },
  { name:"Ops Hub",    color:"#7a5020", x:1, z:9, w:7, d:6  },
  { name:"Creative",   color:"#6a3050", x:6, z:3, w:3, d:5  },
  { name:"Engineering",color:"#5a4020", x:13,z:1, w:7, d:4  },
  { name:"Infra",      color:"#204060", x:13,z:5, w:7, d:4  },
  { name:"Executive",  color:"#304060", x:13,z:9, w:7, d:6  },
];

// Zone overlays for Floor 0 (ground)
const ZONES_F0 = [
  { name:"Meeting",    color:"#303858", x:13,z:3, w:11,d:11 },
  { name:"Break Room", color:"#2a4a30", x: 1,z:1, w: 8,d: 7 },
  { name:"Lobby",      color:"#303848", x: 1,z:9, w: 8,d: 6 },
  { name:"Elev Lobby", color:"#3a3060", x: 8,z:4, w: 5,d: 7 },
];

// ════════════════════════════════════════════════════════════════════════
//  WORLD LAYOUT (all 22 agents on Floor 1 = upper)
// ════════════════════════════════════════════════════════════════════════

const AGENT_DEFS = [
  { id:"orchestrator",  name:"Orchestrator", emoji:"🎯", color:"#5a9a70", deskX: 2, deskZ: 2  },
  { id:"mandor",        name:"Mandor",       emoji:"👑", color:"#b89010", deskX: 5, deskZ: 2  },
  { id:"trainer",       name:"Trainer",      emoji:"🧠", color:"#7060b0", deskX: 2, deskZ: 5  },
  { id:"librarian",     name:"Librarian",    emoji:"📚", color:"#2880a0", deskX: 5, deskZ: 5  },
  { id:"researcher",    name:"Researcher",   emoji:"🔬", color:"#8048a0", deskX: 2, deskZ: 8  },
  { id:"analyst",       name:"Analyst",      emoji:"📊", color:"#3060a0", deskX: 5, deskZ: 8  },
  { id:"guardian",      name:"Guardian",     emoji:"🛡️", color:"#c07820", deskX: 2, deskZ:11  },
  { id:"qa",            name:"QA",           emoji:"🧪", color:"#206840", deskX: 5, deskZ:11  },
  { id:"security",      name:"Security",     emoji:"🔒", color:"#904820", deskX: 2, deskZ:13  },
  { id:"network",       name:"Network",      emoji:"🌐", color:"#186090", deskX: 5, deskZ:13  },
  { id:"curator",       name:"Curator",      emoji:"✨", color:"#a02860", deskX: 7, deskZ: 4  },
  { id:"frontend_dev",  name:"Frontend",     emoji:"🎨", color:"#5830a0", deskX: 7, deskZ: 7  },
  { id:"engineer",      name:"Engineer",     emoji:"⚙️", color:"#c05010", deskX:15, deskZ: 2  },
  { id:"deployer",      name:"Deployer",     emoji:"🚀", color:"#108090", deskX:18, deskZ: 2  },
  { id:"backend_dev",   name:"Backend",      emoji:"⚡", color:"#a01818", deskX:15, deskZ: 5  },
  { id:"devops",        name:"DevOps",       emoji:"🔧", color:"#107850", deskX:18, deskZ: 5  },
  { id:"dbadmin",       name:"DB Admin",     emoji:"🗄️", color:"#a01030", deskX:15, deskZ: 8  },
  { id:"storage",       name:"Storage",      emoji:"💾", color:"#106880", deskX:18, deskZ: 8  },
  { id:"reviewer",      name:"Reviewer",     emoji:"👁️", color:"#608010", deskX:15, deskZ:11  },
  { id:"botmaster",     name:"Botmaster",    emoji:"🤖", color:"#108070", deskX:18, deskZ:11  },
  { id:"codev",         name:"Co-Dev",       emoji:"🤝", color:"#902010", deskX:15, deskZ:13  },
  { id:"product",       name:"Product",      emoji:"📋", color:"#602090", deskX:18, deskZ:13  },
] as const;

const Q_SPOTS_F1: [number,number][] = [[9,6],[9,7],[10,6],[10,7]];
const Q_SPOTS_F0: [number,number][] = [[12,6],[12,7],[13,6],[13,7]];
const MEET_CX = 18, MEET_CZ = 8;
const MEETING_SEATS: [number,number][] = [
  [18,5.5],[20.5,6.5],[22,8],[20.5,9.5],
  [18,10.5],[15.5,9.5],[14,8],[15.5,6.5],
];

const CHAT_LINES = [
  "Need help?","On it!","Check this","PR ready","Good idea!",
  "Almost done","Deploy?","Ship it!","Fixed it!","Tests pass",
  "Code review","Great work!","Discuss?","Deadline!","Let's sync",
  "Blocked!","Update?","LGTM 👍","Ideas?","Let me check",
];

// ════════════════════════════════════════════════════════════════════════
//  ISOMETRIC PROJECTION
// ════════════════════════════════════════════════════════════════════════

function iso(wx: number, wz: number, wy: number, cx: number, cy: number) {
  return {
    x: (wx - wz) * TW2 + cx,
    y: (wx + wz) * TH2 - wy * FLOOR_H + cy,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  COLOR UTILS
// ════════════════════════════════════════════════════════════════════════

function hexToRGB(hex: string): [number,number,number] {
  const h = hex.replace("#","");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function fogColor(baseHex: string, depth: number): string {
  const [r,g,b] = hexToRGB(baseHex);
  const [fr,fg,fb] = PAL.fog;
  const f = Math.min(0.45, depth * 0.018);
  return `rgb(${(r*(1-f)+fr*f)|0},${(g*(1-f)+fg*f)|0},${(b*(1-f)+fb*f)|0})`;
}

function tint(hex: string, lightness: number): string {
  const [r,g,b] = hexToRGB(hex);
  return `rgb(${Math.min(255,r*lightness)|0},${Math.min(255,g*lightness)|0},${Math.min(255,b*lightness)|0})`;
}

// ════════════════════════════════════════════════════════════════════════
//  3D BOX PRIMITIVE (isometric, world-space)
// ════════════════════════════════════════════════════════════════════════

function box(
  c: CanvasRenderingContext2D,
  bx: number, bz: number, by: number,
  bw: number, bd: number, bh: number,
  topCol: string, leftCol: string, rightCol: string,
  cx: number, cy: number,
  depth = 0,
) {
  // Atmospheric fog applied per face
  const fog = depth > 0;
  const fTop   = fog ? fogColor(topCol,   depth) : topCol;
  const fLeft  = fog ? fogColor(leftCol,  depth) : leftCol;
  const fRight = fog ? fogColor(rightCol, depth) : rightCol;

  const p = (dx: number, dz: number, dy: number) => iso(bx+dx, bz+dz, by+dy, cx, cy);

  // Top face
  const tl=p(0,0,bh), tr=p(bw,0,bh), br=p(bw,bd,bh), bl=p(0,bd,bh);
  c.beginPath(); c.moveTo(tl.x,tl.y); c.lineTo(tr.x,tr.y); c.lineTo(br.x,br.y); c.lineTo(bl.x,bl.y); c.closePath();
  c.fillStyle=fTop; c.fill();

  // Left face
  const ll0=p(0,0,0), ll1=p(0,0,bh), ll2=p(0,bd,bh), ll3=p(0,bd,0);
  c.beginPath(); c.moveTo(ll1.x,ll1.y); c.lineTo(ll0.x,ll0.y); c.lineTo(ll3.x,ll3.y); c.lineTo(ll2.x,ll2.y); c.closePath();
  c.fillStyle=fLeft; c.fill();

  // Right face
  const rr0=p(bw,bd,0), rr1=p(0,bd,0), rr2=p(0,bd,bh), rr3=p(bw,bd,bh);
  c.beginPath(); c.moveTo(rr3.x,rr3.y); c.lineTo(rr0.x,rr0.y); c.lineTo(rr1.x,rr1.y); c.lineTo(rr2.x,rr2.y); c.closePath();
  c.fillStyle=fRight; c.fill();

  c.strokeStyle="rgba(0,0,0,0.06)"; c.lineWidth=0.4; c.stroke();
}

// ════════════════════════════════════════════════════════════════════════
//  TILE (top-face only)
// ════════════════════════════════════════════════════════════════════════

function tile(c: CanvasRenderingContext2D, wx: number, wz: number, wy: number,
              col: string, cx: number, cy: number) {
  const tl = iso(wx,   wz,   wy, cx, cy);
  const tr = iso(wx+1, wz,   wy, cx, cy);
  const br = iso(wx+1, wz+1, wy, cx, cy);
  const bl = iso(wx,   wz+1, wy, cx, cy);
  c.beginPath(); c.moveTo(tl.x,tl.y); c.lineTo(tr.x,tr.y); c.lineTo(br.x,br.y); c.lineTo(bl.x,bl.y); c.closePath();
  c.fillStyle=col; c.fill();
  c.strokeStyle="rgba(0,0,0,0.05)"; c.lineWidth=0.3; c.stroke();
}

// ════════════════════════════════════════════════════════════════════════
//  3D CHARACTER DRAWING  (pixel-space, volumetric)
// ════════════════════════════════════════════════════════════════════════

/**
 * Draw an isometric box in PIXEL space (not world-unit space).
 * sx/sy = screen position of top-center of box top-face.
 * pw/pd = pixel half-dimensions of top rhombus (like TW2/TH2 for world tiles).
 * ph = pixel height of side faces.
 */
function pixBox(
  c: CanvasRenderingContext2D,
  sx: number, sy: number,
  pw: number, pd: number, ph: number,
  top: string, left: string, right: string,
) {
  // Top rhombus
  c.beginPath();
  c.moveTo(sx,    sy - pd);        // N
  c.lineTo(sx+pw, sy);             // E
  c.lineTo(sx,    sy + pd);        // S
  c.lineTo(sx-pw, sy);             // W
  c.closePath(); c.fillStyle=top; c.fill();

  // Left face (SW side going down)
  c.beginPath();
  c.moveTo(sx-pw, sy);
  c.lineTo(sx,    sy + pd);
  c.lineTo(sx,    sy + pd + ph);
  c.lineTo(sx-pw, sy + ph);
  c.closePath(); c.fillStyle=left; c.fill();

  // Right face (SE side going down)
  c.beginPath();
  c.moveTo(sx,    sy + pd);
  c.lineTo(sx+pw, sy);
  c.lineTo(sx+pw, sy + ph);
  c.lineTo(sx,    sy + pd + ph);
  c.closePath(); c.fillStyle=right; c.fill();

  c.strokeStyle="rgba(0,0,0,0.10)"; c.lineWidth=0.5; c.stroke();
}

/** Draw a shaded 3D sphere (gradient) at pixel position */
function pixSphere(
  c: CanvasRenderingContext2D,
  sx: number, sy: number, r: number, baseColor: string,
  emoji: string,
) {
  const [rb,gb,bb] = hexToRGB(baseColor);
  // Shadow flattened ellipse
  c.beginPath(); c.ellipse(sx, sy+r*0.9, r*0.85, r*0.35, 0, 0, Math.PI*2);
  c.fillStyle="rgba(0,0,0,0.22)"; c.fill();

  // Base sphere
  c.beginPath(); c.arc(sx, sy, r, 0, Math.PI*2);
  c.fillStyle=baseColor; c.fill();

  // Shading gradient (light from top-left)
  const g = c.createRadialGradient(sx-r*0.32, sy-r*0.32, r*0.05, sx, sy, r);
  g.addColorStop(0, `rgba(255,255,255,0.52)`);
  g.addColorStop(0.45, `rgba(${rb},${gb},${bb},0)`);
  g.addColorStop(1,    `rgba(0,0,0,0.42)`);
  c.fillStyle=g; c.beginPath(); c.arc(sx, sy, r, 0, Math.PI*2); c.fill();

  // Specular highlight
  const hl = c.createRadialGradient(sx-r*0.38, sy-r*0.4, 0, sx-r*0.25, sy-r*0.28, r*0.45);
  hl.addColorStop(0, "rgba(255,255,255,0.72)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle=hl; c.beginPath(); c.arc(sx, sy, r, 0, Math.PI*2); c.fill();

  // Emoji face
  c.font=`${(r*1.1)|0}px serif`; c.textAlign="center"; c.textBaseline="middle";
  c.globalAlpha=0.88; c.fillText(emoji, sx+2, sy+1); c.globalAlpha=1;
}

function drawAgent3D(
  c: CanvasRenderingContext2D,
  ag: AgentSim,
  cx: number, cy: number,
  isSelected: boolean,
  emote?: string,
) {
  // Screen base position (floor level at agent's world pos)
  const sp = iso(ag.x, ag.z, ag.floor, cx, cy);
  const sx = sp.x, sy = sp.y;
  const col = ag.color;

  const [r,g,b] = hexToRGB(col);
  // Face colors (top 115%, left 75%, right 55%)
  const fc = { t:`rgb(${Math.min(255,r*1.12)|0},${Math.min(255,g*1.12)|0},${Math.min(255,b*1.12)|0})` as string,
               l:`rgb(${(r*0.75)|0},${(g*0.75)|0},${(b*0.75)|0})` as string,
               r:`rgb(${(r*0.52)|0},${(g*0.52)|0},${(b*0.52)|0})` as string };

  const ph = ag.phase;
  const wph = ag.walkPhase;

  // Ground shadow
  c.beginPath(); c.ellipse(sx, sy+2, 18, 7, 0, 0, Math.PI*2);
  c.fillStyle="rgba(50,30,10,0.22)"; c.fill();

  // Selection ring
  if (isSelected) {
    c.beginPath(); c.ellipse(sx, sy+2, 24, 9, 0, 0, Math.PI*2);
    c.strokeStyle=col+"90"; c.lineWidth=2.5; c.stroke();
    c.fillStyle=col+"15"; c.fill();
  }

  // ── Isometric character in PIXEL space ──────────────────────────────
  // Pixel dimensions (tuned for TW2=24 scale)
  const BW=16, BD=10, LEG_H=10, BODY_H=14, HEAD_R=12;
  // Component Y positions (sy = floor, going up = smaller y)
  const legTop  = sy - LEG_H;
  const bodyBot = legTop;
  const bodyTop = bodyBot - BODY_H;
  const headCY  = bodyTop - HEAD_R - 1;

  switch (ag.activity) {
    case "walking": {
      const sw = Math.sin(wph);
      const legLift = Math.abs(sw) * 4;
      // Left leg (SW)
      pixBox(c, sx-5, legTop + legLift, BW*0.45, BD*0.45, LEG_H - legLift, fc.t, fc.l, fc.r);
      // Right leg (SE, opposite swing)
      pixBox(c, sx+5, legTop + (4-legLift), BW*0.45, BD*0.45, LEG_H-(4-legLift), fc.t, fc.l, fc.r);
      // Body
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Arms swing opposite legs
      const armL = bodyTop + BODY_H*0.3 + sw * 4;
      const armR = bodyTop + BODY_H*0.3 - sw * 4;
      pixBox(c, sx-BW*0.48, armL, BW*0.28, BD*0.28, 9, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.48, armR, BW*0.28, BD*0.28, 9, fc.t, fc.l, fc.r);
      // Head bobs
      pixSphere(c, sx, headCY + Math.abs(sw)*1.5, HEAD_R, col, ag.emoji);
      break;
    }

    case "typing": {
      const bob = Math.sin(ph*6)*1.2;
      // Legs (sitting, shorter)
      pixBox(c, sx-5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      // Body leaning forward slightly
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Arms forward (on keyboard) — extend in -z direction (deeper into screen)
      pixBox(c, sx-BW*0.38, bodyTop+BODY_H*0.5+bob, BW*0.28, BD*1.1, 6, fc.l, fc.l, fc.r);
      pixBox(c, sx+BW*0.38, bodyTop+BODY_H*0.5-bob, BW*0.28, BD*1.1, 6, fc.l, fc.l, fc.r);
      // Tiny keyboard block
      pixBox(c, sx, legTop-6, BW*0.9, BD*1.6, 3, "#2a3440", "#1a2430", "#101820");
      pixSphere(c, sx, headCY+bob*0.5, HEAD_R, col, ag.emoji);
      break;
    }

    case "drinking": {
      pixBox(c, sx-5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Left arm resting
      pixBox(c, sx-BW*0.45, bodyTop+BODY_H*0.4, BW*0.25, BD*0.25, 9, fc.t, fc.l, fc.r);
      // Right arm raised holding cup
      const armRaise = 14 + Math.sin(ph*1.5)*2;
      pixBox(c, sx+BW*0.45, bodyTop-armRaise*0.3, BW*0.25, BD*0.25, 12, fc.t, fc.l, fc.r);
      // Cup (ceramic mug)
      pixBox(c, sx+BW*0.45+2, bodyTop-armRaise+4, BW*0.22, BD*0.22, 8, "#c8a080","#a07858","#7a5838");
      // Steam
      if (Math.sin(ph*2.5) > 0) {
        c.strokeStyle="rgba(220,200,180,0.5)"; c.lineWidth=1.2; c.lineCap="round";
        c.beginPath(); c.moveTo(sx+BW*0.45+5, bodyTop-armRaise); c.quadraticCurveTo(sx+BW*0.45+9, bodyTop-armRaise-8, sx+BW*0.45+5, bodyTop-armRaise-16); c.stroke();
      }
      pixSphere(c, sx, headCY-2, HEAD_R, col, ag.emoji);
      break;
    }

    case "stretching": {
      const t = Math.min(1, (50 - ag.actTimer) / 20);
      const lift = t * 18;
      pixBox(c, sx-5, legTop, BW*0.4, BD*0.4, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop, BW*0.4, BD*0.4, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Arms raised high
      pixBox(c, sx-BW*0.55, bodyTop - lift, BW*0.25, BD*0.25, BODY_H*0.6+lift, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.55, bodyTop - lift, BW*0.25, BD*0.25, BODY_H*0.6+lift, fc.t, fc.l, fc.r);
      // Hands at top
      if (t > 0.7) {
        c.beginPath(); c.arc(sx-BW*0.55, bodyTop-lift-3, 5, 0, Math.PI*2); c.fillStyle=col; c.fill();
        c.beginPath(); c.arc(sx+BW*0.55, bodyTop-lift-3, 5, 0, Math.PI*2); c.fillStyle=col; c.fill();
      }
      pixSphere(c, sx, headCY-lift*0.4, HEAD_R, col, ag.emoji);
      break;
    }

    case "chatting": {
      const lean = Math.sin(ph*1.8)*3;
      pixBox(c, sx-5+lean, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5+lean, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+lean, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Gesturing arm
      const gesture = Math.sin(ph*2.5)*6;
      pixBox(c, sx+BW*0.48+lean, bodyTop+BODY_H*0.3+gesture, BW*0.28, BD*0.28, 10, fc.t, fc.l, fc.r);
      pixBox(c, sx-BW*0.45+lean, bodyTop+BODY_H*0.5, BW*0.28, BD*0.28, 9, fc.t, fc.l, fc.r);
      pixSphere(c, sx+lean, headCY, HEAD_R, col, ag.emoji);
      break;
    }

    case "presenting": {
      pixBox(c, sx-5, legTop, BW*0.4, BD*0.4, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop, BW*0.4, BD*0.4, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Extended arm pointing
      pixBox(c, sx+BW*0.55, bodyTop+BODY_H*0.2, BW*0.25, BD*0.25, 6, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.8,  bodyTop+BODY_H*0.2+2, BW*0.22, BD*0.22, 5, fc.t, fc.l, fc.r);
      // Pointer dot
      c.beginPath(); c.arc(sx+BW*1.1, bodyTop+BODY_H*0.3+4, 4, 0, Math.PI*2); c.fillStyle=col; c.fill();
      c.strokeStyle="#fff"; c.lineWidth=0.8; c.stroke();
      // Other arm resting
      pixBox(c, sx-BW*0.48, bodyTop+BODY_H*0.4, BW*0.28, BD*0.28, 9, fc.t, fc.l, fc.r);
      pixSphere(c, sx, headCY, HEAD_R, col, ag.emoji);
      break;
    }

    case "nodding": {
      const nod = Math.sin(ph*4)*3;
      pixBox(c, sx-5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      pixBox(c, sx-BW*0.46, bodyTop+BODY_H*0.4, BW*0.28, BD*0.28, 9, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.46, bodyTop+BODY_H*0.4+nod*0.5, BW*0.28, BD*0.28, 9, fc.t, fc.l, fc.r);
      pixSphere(c, sx, headCY + nod, HEAD_R, col, ag.emoji);
      break;
    }

    case "drowsy": {
      const droop = Math.sin(ph*0.7)*4;
      pixBox(c, sx-5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop+2, BW*0.52, BD*0.52, BODY_H-2, fc.t, fc.l, fc.r);
      // Arm supporting head
      pixBox(c, sx+BW*0.46, bodyTop+BODY_H*0.2, BW*0.25, BD*0.25, 10+droop, fc.t, fc.l, fc.r);
      pixBox(c, sx-BW*0.46, bodyTop+BODY_H*0.5, BW*0.25, BD*0.25, 8, fc.t, fc.l, fc.r);
      pixSphere(c, sx+4, headCY+droop+3, HEAD_R, col, "😴");
      // Z z z
      c.fillStyle=col+"88"; c.font="10px sans-serif"; c.textAlign="center";
      const zt = (ph * 0.4) % 1;
      c.globalAlpha = Math.max(0, 1-zt*2.5);
      c.fillText("z", sx+HEAD_R, headCY-HEAD_R - zt*14);
      c.globalAlpha=1;
      break;
    }

    case "sleeping": {
      // Slumped forward on desk
      pixBox(c, sx-5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop+5, BW*0.5, BD*0.5, BODY_H-5, fc.t, fc.l, fc.r);
      pixBox(c, sx-BW*0.46, bodyTop+BODY_H*0.5, BW*0.25, BD*0.25, 7, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.46, bodyTop+BODY_H*0.5, BW*0.25, BD*0.25, 7, fc.t, fc.l, fc.r);
      // Head resting forward (oval flattened)
      c.beginPath(); c.ellipse(sx, bodyTop+2, HEAD_R*0.9, HEAD_R*0.5, 0, 0, Math.PI*2);
      c.fillStyle=col; c.fill();
      const gs = c.createRadialGradient(sx-4, bodyTop-2, 1, sx, bodyTop+2, HEAD_R*0.9);
      gs.addColorStop(0,"rgba(255,255,255,0.45)"); gs.addColorStop(1,"rgba(0,0,0,0.35)");
      c.fillStyle=gs; c.fill();
      c.font="10px serif"; c.fillText("😴", sx+1, bodyTop+4);
      const zt2 = (ph*0.35)%1;
      c.globalAlpha=Math.max(0,1-zt2*2);
      c.font="11px sans-serif"; c.fillStyle=col+"99";
      c.fillText("Zzz", sx+HEAD_R+4, bodyTop-2-zt2*12);
      c.globalAlpha=1;
      break;
    }

    case "phone": {
      pixBox(c, sx-5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop+3, BW*0.4, BD*0.4, LEG_H-3, fc.t, fc.l, fc.r);
      pixBox(c, sx, bodyTop, BW*0.55, BD*0.55, BODY_H, fc.t, fc.l, fc.r);
      // Left arm up holding phone
      const phAnim = Math.sin(ph*3)*2;
      pixBox(c, sx-BW*0.5, bodyTop+BODY_H*0.1+phAnim, BW*0.25, BD*0.25, 12, fc.t, fc.l, fc.r);
      // Phone rectangle
      c.fillStyle="#1a2230"; c.fillRect(sx-BW*0.72, bodyTop-4+phAnim, 7, 11);
      c.fillStyle="#2060a0"; c.fillRect(sx-BW*0.7, bodyTop-2+phAnim, 5, 7);
      // Right arm resting
      pixBox(c, sx+BW*0.46, bodyTop+BODY_H*0.5, BW*0.25, BD*0.25, 9, fc.t, fc.l, fc.r);
      pixSphere(c, sx, headCY, HEAD_R, col, ag.emoji);
      break;
    }

    case "waiting": {
      const sway = Math.sin(ph*1.1)*2;
      pixBox(c, sx-5+sway, legTop, BW*0.42, BD*0.42, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx+5+sway, legTop, BW*0.42, BD*0.42, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx+sway, bodyTop, BW*0.56, BD*0.56, BODY_H, fc.t, fc.l, fc.r);
      pixBox(c, sx-BW*0.48+sway, bodyTop+BODY_H*0.38, BW*0.27, BD*0.27, 10, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.48+sway, bodyTop+BODY_H*0.38, BW*0.27, BD*0.27, 10, fc.t, fc.l, fc.r);
      pixSphere(c, sx+sway, headCY, HEAD_R, col, ag.emoji);
      break;
    }

    default: { // idle
      const idleSway = Math.sin(ph*0.85)*1.5;
      pixBox(c, sx-5, legTop, BW*0.42, BD*0.42, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx+5, legTop, BW*0.42, BD*0.42, LEG_H, fc.t, fc.l, fc.r);
      pixBox(c, sx+idleSway, bodyTop, BW*0.56, BD*0.56, BODY_H, fc.t, fc.l, fc.r);
      pixBox(c, sx-BW*0.48, bodyTop+BODY_H*0.35, BW*0.27, BD*0.27, 10, fc.t, fc.l, fc.r);
      pixBox(c, sx+BW*0.48, bodyTop+BODY_H*0.35, BW*0.27, BD*0.27, 10, fc.t, fc.l, fc.r);
      pixSphere(c, sx+idleSway, headCY, HEAD_R, col, ag.emoji);
    }
  }

  // Emotion overlay
  if (emote) {
    c.font="13px serif"; c.textAlign="center"; c.textBaseline="bottom";
    c.fillText(emote, sx+HEAD_R+4, headCY-HEAD_R-4+Math.sin(ph)*3);
  }
}

// ════════════════════════════════════════════════════════════════════════
//  LABELS & BUBBLES
// ════════════════════════════════════════════════════════════════════════

function drawNameTag(c: CanvasRenderingContext2D, name: string, status: string, color: string, sx: number, sy: number) {
  const w = Math.max(52, name.length*5.2+12);
  const by = sy - 72;
  c.fillStyle="rgba(10,14,20,0.88)";
  c.beginPath(); c.roundRect(sx-w/2, by, w, 20, 4); c.fill();
  c.strokeStyle=color+"50"; c.lineWidth=0.8; c.stroke();
  c.fillStyle=color; c.font="bold 8px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(name, sx, by+7);
  const sc = status==="working"?"#6db88a":status==="error"?"#c07070":"#8a8070";
  c.fillStyle=sc; c.font="7px 'Space Mono',monospace"; c.fillText("● "+status, sx, by+15);
}

function drawSpeechBubble(c: CanvasRenderingContext2D, text: string, sx: number, sy: number, phase: number) {
  const w = Math.max(52, text.length*4.8+12);
  const bx = sx - w/2, by = sy - 92 + Math.sin(phase*1.8)*2;
  c.fillStyle="rgba(20,28,38,0.94)";
  c.beginPath(); c.roundRect(bx, by, w, 16, 4); c.fill();
  c.strokeStyle="rgba(100,150,200,0.5)"; c.lineWidth=0.8; c.stroke();
  // Tail
  c.beginPath(); c.moveTo(sx-3, by+16); c.lineTo(sx+3, by+16); c.lineTo(sx, by+22); c.closePath();
  c.fillStyle="rgba(20,28,38,0.94)"; c.fill();
  c.fillStyle="#a8c8e0"; c.font="7px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(text, sx, by+8);
}

// ════════════════════════════════════════════════════════════════════════
//  FURNITURE
// ════════════════════════════════════════════════════════════════════════

function drawDesk(c: CanvasRenderingContext2D, wx: number, wz: number, color: string, cx: number, cy: number) {
  const wy = 1, depth = wx + wz;
  // Chair (behind desk)
  box(c, wx-0.3, wz+0.5, wy, 0.6, 0.6, 0.07, PAL.chairTop, PAL.chairLeft, PAL.chairRight, cx, cy, depth);
  box(c, wx-0.25, wz+0.5, wy+0.07, 0.5, 0.05, 0.42, PAL.chairTop, PAL.chairLeft, PAL.chairRight, cx, cy, depth);
  // Desk surface
  box(c, wx-0.7, wz-0.5, wy, 1.4, 1.0, 0.12, PAL.deskTop, PAL.deskLeft, PAL.deskRight, cx, cy, depth);
  // Monitor stand
  box(c, wx-0.04, wz-0.08, wy+0.12, 0.08, 0.08, 0.28, "#3a3830", "#2a2820", "#1a1810", cx, cy, depth);
  // Monitor screen (agent color tint)
  const [mr,mg,mb] = hexToRGB(color);
  const screenT = `rgba(${mr*0.15|0},${mg*0.25|0},${mb*0.3|0},0.95)`;
  box(c, wx-0.3, wz-0.04, wy+0.40, 0.6, 0.04, 0.38, screenT, PAL.monLeft, PAL.monRight, cx, cy, depth);
  // Screen glow
  const gp = iso(wx, wz, wy+0.60, cx, cy);
  const gg = c.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, 14);
  gg.addColorStop(0, color+"55"); gg.addColorStop(1, "transparent");
  c.fillStyle=gg; c.beginPath(); c.ellipse(gp.x, gp.y, 14, 7, 0, 0, Math.PI*2); c.fill();
}

function drawElevator(c: CanvasRenderingContext2D, elv: ElevatorSim, time: number, cx: number, cy: number) {
  const ex=ELV_X, ez=ELV_Z;
  // Shaft walls
  box(c, ex-0.55, ez-0.55, 0, 1.1, 1.1, 0.3, "#1a2030","#101820","#080f18", cx, cy);
  box(c, ex-0.50, ez-0.50, 0.3, 1.0, 1.0, 3.4, "#12202e","#0a1420","#060e18", cx, cy);
  // Guide rails
  for (let ry=0.3; ry<3.7; ry+=0.5) {
    const rp = iso(ex+0.45, ez-0.5, ry, cx, cy);
    c.beginPath(); c.arc(rp.x, rp.y, 2.5, 0, Math.PI*2);
    c.fillStyle="#2a3a4a"; c.fill();
  }

  // Car
  const carY = elv.carY * 3.0;
  box(c, ex-0.42, ez-0.42, carY+0.3, 0.84, 0.84, 0.65,
    PAL.elvTop, PAL.elvLeft, PAL.elvRight, cx, cy);
  // Car interior
  box(c, ex-0.36, ez-0.36, carY+0.3, 0.72, 0.72, 0.62, "#0e1825", "#0a1220", "#06101a", cx, cy);
  // Ceiling light
  const litP = iso(ex, ez-0.1, carY+0.95, cx, cy);
  const lit = elv.door > 0.4 ? 0.8+Math.sin(time*6)*0.1 : 0.25;
  c.fillStyle=`rgba(200,220,240,${lit})`;
  c.beginPath(); c.ellipse(litP.x, litP.y, 7, 4, 0, 0, Math.PI*2); c.fill();

  // Doors
  const dw = 0.42 * (1 - elv.door);
  if (dw > 0.02) {
    box(c, ex-0.42, ez-0.42, carY+0.3, dw, 0.05, 0.62, "#2a4060","#1a3050","#0f2040", cx, cy);
    box(c, ex-0.42+0.84-dw, ez-0.42, carY+0.3, dw, 0.05, 0.62, "#2a4060","#1a3050","#0f2040", cx, cy);
  }

  // Floor indicator
  const indP = iso(ex+0.5, ez-0.55, 2.8, cx, cy);
  c.fillStyle="#0a1825"; c.beginPath(); c.roundRect(indP.x-14, indP.y-8, 28, 16, 3); c.fill();
  c.strokeStyle="#2a4a6a"; c.lineWidth=0.8; c.stroke();
  c.fillStyle = elv.moveState==="moving" ? "#e0c060" : "#60b080";
  c.font="bold 8px monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(elv.carY>0.5?"▲ 2F":"▼ 1F", indP.x, indP.y);

  // Queue badge
  if (elv.queue.length > 0) {
    const qp = iso(ex+0.52, ez-0.6, 3.5, cx, cy);
    c.fillStyle="#c08000"; c.beginPath(); c.arc(qp.x, qp.y, 8, 0, Math.PI*2); c.fill();
    c.fillStyle="#fff"; c.font="bold 8px monospace"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText(String(elv.queue.length), qp.x, qp.y);
  }
}

function drawMeetingRoom(c: CanvasRenderingContext2D, hasMeeting: boolean, ph: number, cx: number, cy: number) {
  const mx=MEET_CX, mz=MEET_CZ, wy=0;
  // Table legs
  for (const [dx,dz] of [[-1.4,-1.6],[-1.4,1.6],[1.4,-1.6],[1.4,1.6]]) {
    box(c, mx+dx-0.06, mz+dz-0.06, wy, 0.12, 0.12, 0.38, "#3a2810","#2a1808","#1e1004", cx, cy, mx+mz);
  }
  // Table top
  box(c, mx-1.6, mz-1.8, wy+0.38, 3.2, 3.6, 0.12, PAL.tableTop, PAL.tableLeft, PAL.tableRight, cx, cy, mx+mz);
  // Laptops on table
  for (let i=0;i<6;i++) {
    const ang=(i/6)*Math.PI*2;
    const tx=mx+Math.cos(ang)*1.1, tz=mz+Math.sin(ang)*1.4;
    box(c, tx-0.2, tz-0.15, wy+0.5, 0.4, 0.3, 0.02, "#1a2230","#101828","#0a1020", cx, cy, tx+tz);
  }
  // Meeting glow
  if (hasMeeting) {
    const gp = iso(mx, mz, wy+0.5, cx, cy);
    const glow = 0.4+Math.sin(ph*2)*0.2;
    const gr = c.createRadialGradient(gp.x, gp.y, 5, gp.x, gp.y, 80);
    gr.addColorStop(0, `rgba(80,120,200,${glow*0.35})`);
    gr.addColorStop(1, "transparent");
    c.fillStyle=gr; c.beginPath(); c.ellipse(gp.x, gp.y, 90, 45, 0, 0, Math.PI*2); c.fill();
    // Label
    c.fillStyle="rgba(8,14,24,0.9)"; c.strokeStyle="rgba(80,120,200,0.6)"; c.lineWidth=1;
    c.beginPath(); c.roundRect(gp.x-62, gp.y-14, 124, 20, 4); c.fill(); c.stroke();
    c.fillStyle="#8ab4e8"; c.font="bold 8px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText("🤝 MEETING IN PROGRESS", gp.x, gp.y-4);
  }
}

function drawBreakRoom(c: CanvasRenderingContext2D, cx: number, cy: number) {
  const wy=0;
  // Coffee machine
  box(c, 2, 1.5, wy, 0.7, 0.5, 0.85, "#2a3040","#1a2030","#101828", cx, cy, 5);
  // Sofa L
  box(c, 1.2, 2.8, wy, 2.8, 1.0, 0.32, PAL.breakSofa, "#2a3e50","#1e2e40", cx, cy, 8);
  box(c, 1.2, 2.8, wy+0.32, 0.28, 1.0, 0.45, PAL.breakSofa, "#2a3e50","#1e2e40", cx, cy, 8);
  // Coffee table
  box(c, 2.6, 3.6, wy, 1.1, 0.9, 0.1, PAL.tableTop, PAL.tableLeft, PAL.tableRight, cx, cy, 9);
  // Plant
  box(c, 5.4, 1.5, wy, 0.4, 0.4, 0.38, "#3a2006","#2a1404","#1c0e02", cx, cy, 7);
  const pP=iso(5.6, 1.7, wy+0.38, cx, cy);
  c.beginPath(); c.arc(pP.x, pP.y, 11, 0, Math.PI*2); c.fillStyle=PAL.plantGreen; c.fill();
  const gg=c.createRadialGradient(pP.x-3, pP.y-3, 0, pP.x, pP.y, 11);
  gg.addColorStop(0,"rgba(255,255,255,0.25)"); gg.addColorStop(1,"rgba(0,0,0,0.30)");
  c.fillStyle=gg; c.fill();
}

function drawLobby(c: CanvasRenderingContext2D, cx: number, cy: number) {
  const wy=0;
  box(c, 2, 9, wy, 3, 0.7, 0.55, PAL.deskTop, PAL.deskLeft, PAL.deskRight, cx, cy, 13);
  box(c, 2.5, 9.05, wy+0.55, 0.55, 0.04, 0.42, PAL.monTop, PAL.monLeft, PAL.monRight, cx, cy, 13);
  for (let i=0;i<3;i++) {
    box(c, 1.5+i*0.95, 10.5, wy, 0.72, 0.72, 0.08, PAL.chairTop, PAL.chairLeft, PAL.chairRight, cx, cy, 14);
  }
}

// ════════════════════════════════════════════════════════════════════════
//  FLOOR RENDERING
// ════════════════════════════════════════════════════════════════════════

function renderFloor(c: CanvasRenderingContext2D, wy: 0|1, zones: typeof ZONES_F0, cx: number, cy: number) {
  // Base tiles
  for (let wx=0;wx<24;wx++) for (let wz=0;wz<16;wz++) {
    const col = fogColor((wx+wz)%2===0 ? PAL.floorA : PAL.floorB, wx+wz);
    tile(c, wx, wz, wy, col, cx, cy);
  }
  // Zone overlays
  for (const z of zones) {
    const [r,g,b] = hexToRGB(z.color);
    for (let wx=z.x;wx<z.x+z.w;wx++) for (let wz=z.z;wz<z.z+z.d;wz++) {
      tile(c, wx, wz, wy, `rgba(${r},${g},${b},0.14)`, cx, cy);
    }
    // Zone label
    const lp = iso(z.x+z.w/2, z.z+z.d/2, wy+0.01, cx, cy);
    c.fillStyle=z.color+"90"; c.font="bold 7px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText(z.name.toUpperCase(), lp.x, lp.y+4);
  }
  // Walls (boundary)
  const wallH=0.5;
  for (let wx=0;wx<24;wx++) {
    box(c, wx, 0, wy, 1, 0.04, wallH, PAL.wallTop, PAL.wallLeft, PAL.wallRight, cx, cy, wx);
    box(c, wx, 15, wy, 1, 0.04, wallH, PAL.wallTop, PAL.wallLeft, PAL.wallRight, cx, cy, wx+30);
  }
  for (let wz=0;wz<16;wz++) {
    box(c, 0, wz, wy, 0.04, 1, wallH, PAL.wallTop, PAL.wallLeft, PAL.wallRight, cx, cy, wz);
    box(c, 23, wz, wy, 0.04, 1, wallH, PAL.wallTop, PAL.wallLeft, PAL.wallRight, cx, cy, wz+46);
  }
  // Floor label
  const lp2 = iso(12, -1, wy, cx, cy);
  c.fillStyle="rgba(180,170,158,0.55)"; c.font="bold 9px 'Space Mono',monospace"; c.textAlign="center";
  c.fillText(wy===1?"— FLOOR 2 · WORKSTATIONS —":"— FLOOR 1 · COMMON AREAS —", lp2.x, lp2.y-18);
}

// ════════════════════════════════════════════════════════════════════════
//  SIMULATION
// ════════════════════════════════════════════════════════════════════════

function makeAgents(): Map<string, AgentSim> {
  const m = new Map<string, AgentSim>();
  for (const d of AGENT_DEFS) {
    m.set(d.id, {
      id:d.id, name:d.name, emoji:d.emoji, color:d.color,
      x:d.deskX+(Math.random()-0.5)*0.2, z:d.deskZ+(Math.random()-0.5)*0.2, floor:1,
      tx:d.deskX, tz:d.deskZ, tfloor:1,
      deskX:d.deskX, deskZ:d.deskZ, seatIdx:-1,
      phase:Math.random()*Math.PI*2, walkPhase:Math.random()*Math.PI*2,
      macro:"at_desk", activity:"typing",
      actTimer:Math.floor(Math.random()*180+40), stTimer:0,
      chatPartner:null, bubble:null, bubbleTimer:0, facingAngle:0,
    });
  }
  return m;
}

function pickActivity(ag: AgentSim, agents: Map<string, AgentSim>, macro: Macro) {
  const r = Math.random();
  if (macro === "at_desk") {
    if      (r<0.40) { ag.activity="typing";    ag.actTimer=100+Math.random()*150; }
    else if (r<0.52) { ag.activity="drinking";  ag.actTimer=40+Math.random()*50; }
    else if (r<0.62) { ag.activity="idle";      ag.actTimer=30+Math.random()*60; }
    else if (r<0.70) { ag.activity="stretching";ag.actTimer=45; }
    else if (r<0.78) { ag.activity="phone";     ag.actTimer=50+Math.random()*80; }
    else if (r<0.87) {
      ag.activity="chatting"; ag.actTimer=60+Math.random()*80;
      const near=[...agents.values()].filter(a=>a.id!==ag.id&&a.macro==="at_desk"&&Math.abs(a.deskX-ag.deskX)<5&&Math.abs(a.deskZ-ag.deskZ)<5);
      ag.chatPartner=near[0]?.id??null;
    }
    else if (r<0.94) { ag.activity="drowsy";    ag.actTimer=60; }
    else             { ag.activity="sleeping";  ag.actTimer=90; }
  } else if (macro === "in_meeting") {
    if      (r<0.38) { ag.activity="nodding";   ag.actTimer=50+Math.random()*80; }
    else if (r<0.56) { ag.activity="chatting";  ag.actTimer=50+Math.random()*70;
      ag.bubble=CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]!; ag.bubbleTimer=90;
    }
    else if (r<0.72) { ag.activity="presenting";ag.actTimer=50; }
    else if (r<0.86) { ag.activity="typing";    ag.actTimer=40+Math.random()*60; }
    else             { ag.activity="idle";      ag.actTimer=30+Math.random()*50; }
  }
}

function tickSim(agents: Map<string,AgentSim>, elv: ElevatorSim, meetingSet: Set<string>) {
  // ─ Elevator ─────────────────────────────────────────────────────────
  elv.timer=Math.max(0,elv.timer-1);

  if (elv.moveState==="idle") {
    const onFloor=elv.queue.filter(q=>{ const a=agents.get(q.agentId); return a&&a.floor===elv.floor&&a.macro==="queuing"; });
    if (onFloor.length>0&&elv.timer===0) { elv.moveState="loading"; elv.doorState="opening"; elv.timer=40; }
  }

  if (elv.moveState==="loading") {
    if (elv.doorState==="opening") { elv.door=Math.min(1,elv.door+0.06); if(elv.door>=1) elv.doorState="open"; }
    if (elv.doorState==="open"&&elv.timer===0) {
      const toBoard=elv.queue.filter(q=>{ const a=agents.get(q.agentId); return a&&a.floor===elv.floor&&a.macro==="queuing"; }).slice(0,ELV_CAP-elv.passengers.length);
      for(const qe of toBoard){
        const a=agents.get(qe.agentId); if(!a) continue;
        elv.passengers.push(qe.agentId); elv.queue=elv.queue.filter(q=>q.agentId!==qe.agentId);
        a.macro="in_elevator"; a.activity="waiting"; a.x=ELV_X; a.z=ELV_Z;
      }
      elv.target=elv.floor===1?0:1; elv.moveState="moving"; elv.doorState="closing";
    }
  }
  if (elv.doorState==="closing") { elv.door=Math.max(0,elv.door-0.08); if(elv.door<=0) elv.doorState="closed"; }

  if (elv.moveState==="moving") {
    const diff=elv.target-elv.carY;
    if (Math.abs(diff)<0.015) {
      elv.carY=elv.target; elv.floor=elv.target;
      elv.moveState="unloading"; elv.doorState="opening"; elv.timer=50;
      for(const pid of elv.passengers){ const a=agents.get(pid); if(a){ a.floor=elv.target; a.x=ELV_X; a.z=ELV_Z; } }
    } else {
      elv.carY+=Math.sign(diff)*0.018;
      for(const pid of elv.passengers){ const a=agents.get(pid); if(a){ a.x=ELV_X; a.z=ELV_Z; a.floor=elv.carY>0.5?1:0; } }
    }
  }

  if (elv.moveState==="unloading") {
    if(elv.doorState==="opening"){ elv.door=Math.min(1,elv.door+0.06); if(elv.door>=1) elv.doorState="open"; }
    if(elv.doorState==="open"&&elv.timer===0){
      for(const pid of [...elv.passengers]){
        const a=agents.get(pid); if(!a) continue;
        a.floor=elv.floor;
        if(elv.floor===0){ const s=Q_SPOTS_F0[elv.passengers.indexOf(pid)%Q_SPOTS_F0.length]!; a.tx=s[0]; a.tz=s[1]; a.tfloor=0; a.macro="walk_from_elv"; }
        else{ a.tx=a.deskX; a.tz=a.deskZ; a.tfloor=1; a.macro="walk_to_desk"; }
      }
      elv.passengers=[]; elv.moveState="idle"; elv.doorState="closing"; elv.timer=20;
    }
  }

  // ─ Agents ────────────────────────────────────────────────────────────
  for (const ag of agents.values()) {
    ag.phase+=0.04;
    const moving=Math.hypot(ag.tx-ag.x,ag.tz-ag.z)>0.1&&ag.floor===ag.tfloor;
    if(moving){
      const dx=ag.tx-ag.x, dz=ag.tz-ag.z, dist=Math.hypot(dx,dz), step=Math.min(AGENT_SPD,dist);
      ag.x+=(dx/dist)*step; ag.z+=(dz/dist)*step; ag.walkPhase+=0.18; ag.activity="walking";
    }
    ag.actTimer=Math.max(0,ag.actTimer-1);
    if(ag.actTimer===0&&(ag.macro==="at_desk"||ag.macro==="in_meeting")) pickActivity(ag,agents,ag.macro);
    if(ag.bubbleTimer>0){ ag.bubbleTimer--; if(ag.bubbleTimer===0) ag.bubble=null; }
    if(ag.activity==="chatting"&&Math.random()<0.007){ ag.bubble=CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]!; ag.bubbleTimer=100; }

    switch(ag.macro){
      case "at_desk": {
        ag.tx=ag.deskX; ag.tz=ag.deskZ; ag.tfloor=1;
        if(!moving){ ag.x=ag.deskX; ag.z=ag.deskZ; }
        if(meetingSet.has(ag.id)&&ag.seatIdx===-1){
          const used=new Set([...agents.values()].map(a=>a.seatIdx).filter(s=>s>=0));
          const seat=MEETING_SEATS.findIndex((_,i)=>!used.has(i));
          if(seat>=0){
            ag.seatIdx=seat;
            const usedQ=new Set([...agents.values()].filter(a=>(a.macro==="walk_to_elv"||a.macro==="queuing")&&a.floor===1).map(a=>`${a.tx},${a.tz}`));
            const sp=Q_SPOTS_F1.find(([sx,sz])=>!usedQ.has(`${sx},${sz}`));
            ag.tx=sp?.[0]??ELV_X-1; ag.tz=sp?.[1]??ELV_Z; ag.tfloor=1; ag.macro="walk_to_elv";
          }
        }
        break;
      }
      case "walk_to_elv": {
        if(!moving&&ag.floor===1){ ag.macro="queuing"; ag.x=ag.tx; ag.z=ag.tz; if(!elv.queue.find(q=>q.agentId===ag.id)) elv.queue.push({agentId:ag.id,dest:0}); }
        break;
      }
      case "queuing": ag.activity="waiting"; break;
      case "in_elevator": ag.activity="waiting"; break;
      case "walk_from_elv": {
        if(!moving&&ag.floor===0){ if(ag.seatIdx>=0){ const s=MEETING_SEATS[ag.seatIdx]!; ag.tx=s[0]; ag.tz=s[1]; ag.tfloor=0; ag.macro="walk_to_meeting"; } else ag.macro="walk_to_desk"; }
        break;
      }
      case "walk_to_meeting": {
        if(!moving&&ag.floor===0){ ag.macro="in_meeting"; ag.activity="nodding"; ag.x=ag.tx; ag.z=ag.tz; ag.actTimer=60; }
        break;
      }
      case "in_meeting": {
        if(!meetingSet.has(ag.id)){
          ag.seatIdx=-1; ag.macro="walk_to_elv_return";
          const usedQ=new Set([...agents.values()].filter(a=>(a.macro==="walk_to_elv_return"||a.macro==="queuing_return")&&a.floor===0).map(a=>`${a.tx},${a.tz}`));
          const sp=Q_SPOTS_F0.find(([sx,sz])=>!usedQ.has(`${sx},${sz}`));
          ag.tx=sp?.[0]??ELV_X+1; ag.tz=sp?.[1]??ELV_Z; ag.tfloor=0;
        }
        break;
      }
      case "walk_to_elv_return": {
        if(!moving&&ag.floor===0){ ag.macro="queuing_return"; ag.x=ag.tx; ag.z=ag.tz; if(!elv.queue.find(q=>q.agentId===ag.id)) elv.queue.push({agentId:ag.id,dest:1}); }
        break;
      }
      case "queuing_return": ag.activity="waiting"; break;
      case "in_elevator_return": ag.activity="waiting"; break;
      case "walk_to_desk": {
        if(!moving&&ag.floor===1){ ag.macro="at_desk"; ag.activity="idle"; ag.actTimer=30; ag.x=ag.deskX; ag.z=ag.deskZ; }
        break;
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function OfficeRealistic({
  agentStatuses, selectedAgent, onSelectAgent,
  activeThreads=[], agentEmotions=new Map(),
}: OfficeRealisticProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef(makeAgents());
  const elvRef    = useRef<ElevatorSim>({ floor:1, carY:1, target:1, door:0, doorState:"closed", moveState:"idle", timer:0, passengers:[], queue:[] });
  const timeRef   = useRef(0);
  const tickRef   = useRef(0);
  const statusMap = useRef(new Map<string,string>());
  const propsRef  = useRef({ activeThreads, agentEmotions, agentStatuses, selectedAgent });
  propsRef.current = { activeThreads, agentEmotions, agentStatuses, selectedAgent };

  // Camera state
  const cam = useRef({ zoom:1, panX:0, panY:0, drag:false, lx:0, ly:0, pinchDist:0 });

  // Minimap bounds (updated each frame, used for hit-test)
  const mmBounds = useRef({ x:0, y:0, w:0, h:0, floorSplit:0, tileW:0, tileH:0 });

  // Simulation tick
  useEffect(() => {
    const id = setInterval(() => {
      const meetingSet = new Set<string>();
      propsRef.current.activeThreads.filter(t=>t.active).forEach(t=>t.participants.forEach(p=>meetingSet.add(p)));
      tickRef.current++;
      tickSim(agentsRef.current, elvRef.current, meetingSet);
      statusMap.current.clear();
      propsRef.current.agentStatuses.forEach(s=>statusMap.current.set(s.agentId, s.status));
    }, TICK_MS);
    return ()=>clearInterval(id);
  }, []);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current; if(!canvas) return;
    let running = true;

    function render() {
      if(!running) return;
      const c = canvas!.getContext("2d"); if(!c){ requestAnimationFrame(render); return; }
      const W=canvas!.width, H=canvas!.height;
      timeRef.current+=0.016;
      const time=timeRef.current;

      // Scene origin (both floors centered)
      const CX0 = W*0.5 - TW2*3.5;
      const CY0 = H*0.5 - (37*TH2 + 2*TH2 - FLOOR_H)/2;

      // Apply camera zoom+pan
      c.fillStyle=PAL.sky; c.fillRect(0,0,W,H);
      c.save();
      c.translate(W/2+cam.current.panX, H/2+cam.current.panY);
      c.scale(cam.current.zoom, cam.current.zoom);
      c.translate(-W/2, -H/2);

      // Adjusted origins
      const CX = CX0, CY = CY0;

      // ─ Floor 0 ──────────────────────────────────────────────────────
      renderFloor(c, 0, ZONES_F0, CX, CY);
      drawBreakRoom(c, CX, CY);
      drawLobby(c, CX, CY);
      // Meeting seats
      for(const [sx,sz] of MEETING_SEATS) box(c, sx-0.28, sz-0.28, 0, 0.56, 0.56, 0.06, PAL.chairTop, PAL.chairLeft, PAL.chairRight, CX, CY, sx+sz);

      // ─ Floor 1 ──────────────────────────────────────────────────────
      renderFloor(c, 1, ZONES_F1, CX, CY);
      for(const d of AGENT_DEFS) drawDesk(c, d.deskX, d.deskZ, d.color, CX, CY);

      // ─ Elevator shaft (spans both floors) ───────────────────────────
      drawElevator(c, elvRef.current, time, CX, CY);

      // ─ Meeting table ────────────────────────────────────────────────
      const hasMeeting = propsRef.current.activeThreads.some(t=>t.active);
      drawMeetingRoom(c, hasMeeting, time, CX, CY);

      // ─ Agents (depth sorted) ────────────────────────────────────────
      const { agentEmotions:emo, selectedAgent:sel } = propsRef.current;
      const agList=[...agentsRef.current.values()];
      agList.sort((a,b)=> a.floor!==b.floor ? a.floor-b.floor : (a.x+a.z)-(b.x+b.z));

      for(const ag of agList){
        const inElv=ag.macro==="in_elevator"||ag.macro==="in_elevator_return";
        const drawWy=inElv ? elvRef.current.carY : ag.floor;
        // Small jitter on elevator when moving
        const jitterX=inElv&&elvRef.current.moveState==="moving"?(Math.random()-0.5)*0.06:0;
        const drawX=ag.x+jitterX, drawZ=ag.z;
        // Temporarily patch agent position for drawing
        const origX=ag.x, origZ=ag.z, origFloor=ag.floor;
        ag.x=drawX; ag.z=drawZ;
        // Compute screen position with elevator Y
        const sp0=iso(ag.x, ag.z, 0, CX, CY);
        const sp1=iso(ag.x, ag.z, 1, CX, CY);
        const elvY=elvRef.current.carY;
        // Interpolated screen pos for in-elevator agents
        const spFinal={ x:sp0.x+(sp1.x-sp0.x)*elvY, y:sp0.y+(sp1.y-sp0.y)*elvY };
        // Restore and draw
        ag.x=origX; ag.z=origZ; ag.floor=origFloor;

        c.save();
        if(inElv) c.translate(spFinal.x - iso(ag.x,ag.z,ag.floor,CX,CY).x, spFinal.y - iso(ag.x,ag.z,ag.floor,CX,CY).y);
        drawAgent3D(c, ag, CX, CY, sel===ag.id, emo.get(ag.id)?.emoji);
        const sp=iso(ag.x, ag.z, ag.floor, CX, CY);
        const spDraw={x:sp.x+(inElv?spFinal.x-sp.x:0), y:sp.y+(inElv?spFinal.y-sp.y:0)};
        drawNameTag(c, ag.name, statusMap.current.get(ag.id)??"offline", ag.color, sp.x, sp.y);
        if(ag.bubble) drawSpeechBubble(c, ag.bubble, sp.x, sp.y, ag.phase);
        c.restore();

        // Queue badge
        const qPos=elvRef.current.queue.findIndex(q=>q.agentId===ag.id);
        if(qPos>=0){
          c.save();
          const lp=iso(ag.x,ag.z,ag.floor,CX,CY);
          c.fillStyle="#c08000"; c.font="bold 8px monospace"; c.textAlign="center"; c.textBaseline="middle";
          c.fillText(`Q${qPos+1}`, lp.x+18, lp.y-50);
          c.restore();
        }
      }

      // ─ HUD ──────────────────────────────────────────────────────────
      c.restore(); // end camera transform

      const mobileCount=[...agentsRef.current.values()].filter(a=>a.macro!=="at_desk").length;
      const meetCount  =[...agentsRef.current.values()].filter(a=>a.macro==="in_meeting").length;
      const elvQ=elvRef.current.queue.length;

      c.fillStyle="rgba(10,14,20,0.82)"; c.strokeStyle="#2a3a4a"; c.lineWidth=1;
      c.beginPath(); c.roundRect(10,10,175,72,6); c.fill(); c.stroke();
      c.font="8px 'Space Mono',monospace"; c.textBaseline="top"; c.textAlign="left";
      c.fillStyle="#6a8aa0"; c.fillText("DLAVIE OS  OFFICE", 18,18);
      c.fillStyle="#6db88a"; c.fillText(`● ${mobileCount} agents mobile`, 18,30);
      c.fillStyle="#7090c0"; c.fillText(`🤝 ${meetCount} in meeting`, 18,42);
      c.fillStyle="#c09040"; c.fillText(`🛗 Elev: ${elvRef.current.moveState}  Q:${elvQ}`, 18,54);
      c.fillStyle="#485868"; c.fillText(`F${elvRef.current.carY>0.5?"2":"1"} · ${elvRef.current.doorState}`, 18,66);

      // Controls hint (shown until first interaction)
      c.fillStyle="rgba(10,14,20,0.72)"; c.strokeStyle="#2a3a4a";
      c.beginPath(); c.roundRect(10, H-50, 185, 40, 6); c.fill(); c.stroke();
      c.fillStyle="#486070"; c.font="7px 'Space Mono',monospace";
      c.fillText("✋ Drag − pan  ·  🤏 Pinch − zoom", 18, H-40);
      c.fillText("🖱 Drag − pan  ·  Scroll − zoom", 18, H-30);

      // Active meeting topic
      const topic=propsRef.current.activeThreads.find(t=>t.active)?.topic;
      if(topic){
        c.fillStyle="rgba(10,14,20,0.85)"; c.strokeStyle="#2a4060";
        c.beginPath(); c.roundRect(W-275,10,265,26,5); c.fill(); c.stroke();
        c.fillStyle="#7090b0"; c.font="8px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
        c.fillText("📋 "+topic.slice(0,38), W-142, 23);
      }

      // ─ MINIMAP ────────────────────────────────────────────────────────
      // Top-down flat view: Floor 2 (upper half) / Floor 1 (lower half)
      // World spans wx 0-23, wz 0-15
      const MM_W=152, MM_H=114;
      const MM_X=W-MM_W-12, MM_Y=H-MM_H-52;
      const FLOOR_SPLIT=MM_H*0.5; // y-split inside minimap
      const T_W=MM_W/24, T_H=FLOOR_SPLIT/16; // pixels per tile

      // Save for hit-test
      mmBounds.current={x:MM_X,y:MM_Y,w:MM_W,h:MM_H,floorSplit:FLOOR_SPLIT,tileW:T_W,tileH:T_H};

      // Outer frame
      c.fillStyle="rgba(6,10,16,0.92)"; c.strokeStyle="#2c3d50"; c.lineWidth=1.2;
      c.beginPath(); c.roundRect(MM_X-4,MM_Y-16,MM_W+8,MM_H+24,7); c.fill(); c.stroke();

      // Title bar
      c.fillStyle="#304050"; c.font="bold 7px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
      c.fillText("◉ MINIMAP", MM_X+MM_W/2, MM_Y-8);

      // Floor 2 background
      c.fillStyle="#18222e";
      c.beginPath(); c.roundRect(MM_X,MM_Y,MM_W,FLOOR_SPLIT-1,3); c.fill();
      // Floor 1 background
      c.fillStyle="#121c26";
      c.beginPath(); c.roundRect(MM_X,MM_Y+FLOOR_SPLIT+1,MM_W,FLOOR_SPLIT-1,3); c.fill();

      // Floor divider line
      c.strokeStyle="#2c3d50"; c.lineWidth=0.8;
      c.beginPath(); c.moveTo(MM_X,MM_Y+FLOOR_SPLIT); c.lineTo(MM_X+MM_W,MM_Y+FLOOR_SPLIT); c.stroke();

      // Zone patches — Floor 2
      for(const z of ZONES_F1){
        const [zr,zg,zb]=hexToRGB(z.color);
        c.fillStyle=`rgba(${zr},${zg},${zb},0.28)`;
        c.fillRect(MM_X+z.x*T_W, MM_Y+z.z*T_H, z.w*T_W, z.d*T_H);
      }
      // Zone patches — Floor 1
      for(const z of ZONES_F0){
        const [zr,zg,zb]=hexToRGB(z.color);
        c.fillStyle=`rgba(${zr},${zg},${zb},0.28)`;
        c.fillRect(MM_X+z.x*T_W, MM_Y+FLOOR_SPLIT+z.z*T_H, z.w*T_W, z.d*T_H);
      }

      // Elevator marker (both floors)
      c.fillStyle="#5a7a9a";
      c.beginPath(); c.arc(MM_X+ELV_X*T_W, MM_Y+ELV_Z*T_H, 3.5, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(MM_X+ELV_X*T_W, MM_Y+FLOOR_SPLIT+ELV_Z*T_H, 3.5, 0, Math.PI*2); c.fill();
      // Elevator car position
      const elvCarMY=MM_Y+ELV_Z*T_H + (FLOOR_SPLIT*0.8)*(1-elvRef.current.carY);
      c.strokeStyle="#8ab0d0"; c.lineWidth=1;
      c.beginPath(); c.arc(MM_X+ELV_X*T_W, elvCarMY, 4.5, 0, Math.PI*2); c.stroke();

      // Meeting table outline on Floor 1 section
      c.strokeStyle="#5a4030"; c.lineWidth=1;
      c.beginPath(); c.roundRect(
        MM_X+(MEET_CX-1.6)*T_W, MM_Y+FLOOR_SPLIT+(MEET_CZ-1.8)*T_H,
        3.2*T_W, 3.6*T_H, 2); c.stroke();

      // Agent dots
      for(const ag of agentsRef.current.values()){
        const dotX=MM_X+ag.x*T_W;
        const dotY=ag.floor===1
          ? MM_Y+ag.z*T_H
          : MM_Y+FLOOR_SPLIT+ag.z*T_H;
        const isSel=ag.id===propsRef.current.selectedAgent;
        // Dot
        c.beginPath(); c.arc(dotX, dotY, isSel?4:2.6, 0, Math.PI*2);
        c.fillStyle=ag.color; c.fill();
        c.strokeStyle=isSel?"#fff":"rgba(0,0,0,0.5)"; c.lineWidth=isSel?1.2:0.5; c.stroke();
        // Pulse ring for selected
        if(isSel){
          const pulse=0.4+Math.abs(Math.sin(time*3))*0.6;
          c.beginPath(); c.arc(dotX, dotY, 7, 0, Math.PI*2);
          c.strokeStyle=ag.color+Math.floor(pulse*255).toString(16).padStart(2,"0");
          c.lineWidth=1; c.stroke();
        }
        // Movement trail arrow for walking agents
        if(ag.activity==="walking"&&Math.hypot(ag.tx-ag.x,ag.tz-ag.z)>0.5){
          const tdx=ag.tx-ag.x, tdz=ag.tz-ag.z;
          const tlen=Math.hypot(tdx,tdz);
          const arrX=dotX+(tdx/tlen)*5, arrY=dotY+(tdz/tlen)*5;
          c.strokeStyle=ag.color+"80"; c.lineWidth=0.8;
          c.beginPath(); c.moveTo(dotX,dotY); c.lineTo(arrX,arrY); c.stroke();
        }
      }

      // Floor labels
      c.font="6px 'Space Mono',monospace"; c.textBaseline="top"; c.textAlign="right";
      c.fillStyle="#486070"; c.fillText("F2",MM_X+MM_W-2,MM_Y+2);
      c.fillStyle="#406058"; c.fillText("F1",MM_X+MM_W-2,MM_Y+FLOOR_SPLIT+2);

      // Viewport rectangle (shows what portion of the world is visible)
      // Invert: the canvas centre in world-isometric coords
      // We draw the rect on the F2 layer (most action there)
      {
        const CX_=CX0, CY_=CY0;
        // Visible world region at current zoom:
        // screenX = (wx-wz)*TW2 + CX_ → wx-wz = (screenX - CX_)/TW2
        // For screen edges (after pan/zoom):
        const left  = ((0 - W/2 - cam.current.panX)/cam.current.zoom + W/2 - CX_)/TW2;
        const right = ((W - W/2 - cam.current.panX)/cam.current.zoom + W/2 - CX_)/TW2;
        const top_  = ((0 - H/2 - cam.current.panY)/cam.current.zoom + H/2 - CY_)/TH2;
        const bot   = ((H - H/2 - cam.current.panY)/cam.current.zoom + H/2 - CY_)/TH2;
        // Map (wx-wz) and (wx+wz) extremes to minimap pixel coords
        // Approximate by using (wx+wz)/2 and (wx-wz)/2
        const mmLeft  =MM_X+Math.max(0,(left+top_)/2*T_W);
        const mmRight =MM_X+Math.min(MM_W,(right+bot)/2*T_W);
        const mmTop2  =MM_Y+Math.max(0,(top_-right)/2*T_H);  // approx
        const mmBot2  =MM_Y+Math.min(FLOOR_SPLIT,(bot-left)/2*T_H);
        if(mmRight>mmLeft&&mmBot2>mmTop2){
          c.strokeStyle="rgba(200,220,255,0.55)"; c.lineWidth=1.2;
          c.setLineDash([3,2]);
          c.strokeRect(mmLeft, mmTop2, mmRight-mmLeft, mmBot2-mmTop2);
          c.setLineDash([]);
        }
      }

      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
    return ()=>{ running=false; };
  }, []);

  // Canvas resize
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const obs=new ResizeObserver(()=>{
      const r=canvas.parentElement?.getBoundingClientRect();
      if(r){ canvas.width=r.width; canvas.height=r.height; }
    });
    const r=canvas.parentElement?.getBoundingClientRect();
    if(r){ canvas.width=r.width; canvas.height=r.height; }
    obs.observe(canvas.parentElement??canvas);
    return()=>obs.disconnect();
  }, []);

  // ── Interaction helpers (must be declared before handlers that use them) ──

  // Navigate camera to a world position
  const navigateTo = useCallback((wx: number, wz: number, floor: 0|1) => {
    const canvas=canvasRef.current; if(!canvas) return;
    const W=canvas.width, H=canvas.height;
    const CX0=W*0.5-TW2*3.5;
    const CY0=H*0.5-(37*TH2+2*TH2-FLOOR_H)/2;
    const sp=iso(wx, wz, floor, CX0, CY0);
    cam.current.panX=W/2-sp.x;
    cam.current.panY=H/2-sp.y;
  }, []);

  // Hit-test minimap; if hit, navigate and return true
  const tryMinimapNav = useCallback((px: number, py: number): boolean => {
    const mm=mmBounds.current;
    if(px<mm.x||px>mm.x+mm.w||py<mm.y||py>mm.y+mm.h) return false;
    const lx=px-mm.x, ly=py-mm.y;
    const wx=lx/mm.tileW;
    const isF1=ly<mm.floorSplit;
    const wz=isF1?(ly/mm.tileH):((ly-mm.floorSplit)/mm.tileH);
    navigateTo(wx, wz, isF1?1:0);
    return true;
  }, [navigateTo]);

  // ── Interaction handlers ─────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    cam.current.drag=true; cam.current.lx=e.clientX; cam.current.ly=e.clientY;
  }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if(!cam.current.drag) return;
    cam.current.panX+=e.clientX-cam.current.lx; cam.current.lx=e.clientX;
    cam.current.panY+=e.clientY-cam.current.ly; cam.current.ly=e.clientY;
  }, []);
  const handleMouseUp = useCallback(()=>{ cam.current.drag=false; }, []);
  const handleWheel = useCallback((e: React.WheelEvent)=>{
    e.preventDefault();
    cam.current.zoom=Math.max(0.4, Math.min(4, cam.current.zoom*(1-e.deltaY*0.0012)));
  }, []);

  // Touch
  const handleTouchStart = useCallback((e: React.TouchEvent)=>{
    e.preventDefault();
    if(e.touches.length===1){
      const canvas=canvasRef.current; if(!canvas) return;
      const rect=canvas.getBoundingClientRect();
      const px=e.touches[0]!.clientX-rect.left;
      const py=e.touches[0]!.clientY-rect.top;
      if(tryMinimapNav(px, py)) return; // minimap tap → navigate, don't drag
      cam.current.drag=true;
      cam.current.lx=e.touches[0]!.clientX;
      cam.current.ly=e.touches[0]!.clientY;
    } else if(e.touches.length===2){
      cam.current.drag=false;
      const dx=e.touches[0]!.clientX-e.touches[1]!.clientX;
      const dy=e.touches[0]!.clientY-e.touches[1]!.clientY;
      cam.current.pinchDist=Math.hypot(dx,dy);
    }
  }, [tryMinimapNav]);
  const handleTouchMove = useCallback((e: React.TouchEvent)=>{
    e.preventDefault();
    if(e.touches.length===1&&cam.current.drag){
      cam.current.panX+=e.touches[0]!.clientX-cam.current.lx; cam.current.lx=e.touches[0]!.clientX;
      cam.current.panY+=e.touches[0]!.clientY-cam.current.ly; cam.current.ly=e.touches[0]!.clientY;
    } else if(e.touches.length===2){
      const dx=e.touches[0]!.clientX-e.touches[1]!.clientX;
      const dy=e.touches[0]!.clientY-e.touches[1]!.clientY;
      const dist=Math.hypot(dx,dy);
      if(cam.current.pinchDist>0) cam.current.zoom=Math.max(0.4,Math.min(4,cam.current.zoom*dist/cam.current.pinchDist));
      cam.current.pinchDist=dist;
    }
  }, []);
  const handleTouchEnd = useCallback(()=>{ cam.current.drag=false; cam.current.pinchDist=0; }, []);

  // Click → minimap nav or agent select
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    if(Math.hypot(e.movementX,e.movementY)>4) return;
    const rect=canvas.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    if(tryMinimapNav(px, py)) return;
    const cx0=canvas.width*0.5-TW2*3.5;
    const cy0=canvas.height*0.5-(37*TH2+2*TH2-FLOOR_H)/2;
    const mx=(px-canvas.width/2-cam.current.panX)/cam.current.zoom+canvas.width/2;
    const my=(py-canvas.height/2-cam.current.panY)/cam.current.zoom+canvas.height/2;
    let best:string|null=null, bestD=40;
    for(const ag of agentsRef.current.values()){
      const sp=iso(ag.x,ag.z,ag.floor,cx0,cy0);
      const d=Math.hypot(sp.x-mx, sp.y-my+35);
      if(d<bestD){ bestD=d; best=ag.id; }
    }
    if(best) onSelectAgent(best);
  }, [onSelectAgent, tryMinimapNav]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        width:"100%", height:"100%", display:"block",
        cursor: cam.current.drag ? "grabbing" : "grab",
        touchAction:"none", userSelect:"none",
        background:PAL.sky,
      }}
    />
  );
}

export default OfficeRealistic;
