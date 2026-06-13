/**
 * OfficeRealistic.tsx — DLavie OS Two-Floor Isometric Office
 *
 * Systems:
 *  • 2-floor isometric office (Floor-1=desks, Floor-0=meeting/common)
 *  • Elevator with capacity-4 queue + door/movement animation
 *  • Per-agent state machine: at_desk → elevator → meeting → return
 *  • Rich activity animations: typing, drinking, chatting, stretching,
 *    presenting, nodding, drowsy, sleeping, phone, walking
 *  • Speech bubbles, name tags, status rings, emotional overlays
 *  • Meeting room trigger from activeThreads prop
 *
 * Isometric math (camera looks from NW, angle ~30°):
 *   screenX = (wx - wz) * TW2 + CX
 *   screenY = (wx + wz) * TH2 - wy * FLOOR_H + CY
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
  // world position (current)
  x: number; z: number; floor: 0 | 1;
  // walk target
  tx: number; tz: number; tfloor: 0 | 1;
  // desk (always floor 1)
  deskX: number; deskZ: number;
  // meeting
  seatIdx: number;   // -1 = no seat
  // animation
  phase: number;     // general oscillation timer
  walkPhase: number; // leg/arm swing
  // state
  macro: Macro;
  activity: Activity;
  actTimer: number;  // countdown ticks until next activity change
  stTimer: number;   // state transition timer
  // social
  chatPartner: string | null;
  bubble: string | null;
  bubbleTimer: number;
  // facing direction (for walk heading)
  facingAngle: number;
}

interface ElevatorSim {
  floor: 0 | 1;          // current floor (carY rounds to this)
  carY: number;          // 0.0=floor0, 1.0=floor1
  target: 0 | 1;         // destination floor
  door: number;          // 0=closed, 1=fully open
  doorState: "closed" | "opening" | "open" | "closing";
  moveState: "idle" | "loading" | "moving" | "unloading";
  timer: number;
  passengers: string[];
  queue: Array<{ agentId: string; dest: 0 | 1 }>;
}

interface AgentStatus { agentId: string; status: string; currentTask?: string | null; }
interface Thread { id: string; active: boolean; participants: string[]; topic?: string; }

export interface OfficeRealisticProps {
  agentStatuses: AgentStatus[];
  selectedAgent: string | null;
  onSelectAgent: (id: string) => void;
  activeThreads?: Thread[];
  agentEmotions?: Map<string, { emoji: string; reason: string }>;
  agentPositions?: Map<string, { state: string; target?: string }>;
  particles?: unknown;
}

// ════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════════════

const TW2 = 24;       // half isometric tile width  (tile = 48px — fits 22-wide world in ~800px)
const TH2 = 12;       // half isometric tile height (tile = 24px)
const FLOOR_H = 110;  // screen Y pixels between floor planes
const AGENT_SPD = 0.1; // world-units per tick
const ELV_X = 11, ELV_Z = 7; // elevator shaft world position
const ELV_CAP = 4;
const TICK_MS = 50;   // simulation tick (20/s)

// ════════════════════════════════════════════════════════════════════════
//  WORLD LAYOUT
// ════════════════════════════════════════════════════════════════════════

// ─── Agent desks (all on Floor 1 = upper) ───────────────────────────────
const AGENT_DEFS = [
  // LEFT WING — Zone A: Command & Research
  { id:"orchestrator",  name:"Orchestrator", emoji:"🎯", color:"#10b981", deskX: 2, deskZ: 2  },
  { id:"mandor",        name:"Mandor",       emoji:"👑", color:"#eab308", deskX: 5, deskZ: 2  },
  { id:"trainer",       name:"Trainer",      emoji:"🧠", color:"#8b5cf6", deskX: 2, deskZ: 5  },
  { id:"librarian",     name:"Librarian",    emoji:"📚", color:"#0ea5e9", deskX: 5, deskZ: 5  },
  { id:"researcher",    name:"Researcher",   emoji:"🔬", color:"#a855f7", deskX: 2, deskZ: 8  },
  { id:"analyst",       name:"Analyst",      emoji:"📊", color:"#3b82f6", deskX: 5, deskZ: 8  },
  // LEFT WING — Zone B: Ops & Security
  { id:"guardian",      name:"Guardian",     emoji:"🛡️", color:"#f59e0b", deskX: 2, deskZ:11  },
  { id:"qa",            name:"QA",           emoji:"🧪", color:"#15803d", deskX: 5, deskZ:11  },
  { id:"security",      name:"Security",     emoji:"🔒", color:"#b45309", deskX: 2, deskZ:13  },
  { id:"network",       name:"Network",      emoji:"🌐", color:"#0284c7", deskX: 5, deskZ:13  },
  // CENTRE-LEFT — Creative bridge
  { id:"curator",       name:"Curator",      emoji:"✨", color:"#ec4899", deskX: 7, deskZ: 4  },
  { id:"frontend_dev",  name:"Frontend",     emoji:"🎨", color:"#7c3aed", deskX: 7, deskZ: 7  },
  // RIGHT WING — Zone C: Engineering
  { id:"engineer",      name:"Engineer",     emoji:"⚙️", color:"#f97316", deskX:15, deskZ: 2  },
  { id:"deployer",      name:"Deployer",     emoji:"🚀", color:"#06b6d4", deskX:18, deskZ: 2  },
  { id:"backend_dev",   name:"Backend",      emoji:"⚡", color:"#dc2626", deskX:15, deskZ: 5  },
  { id:"devops",        name:"DevOps",       emoji:"🔧", color:"#059669", deskX:18, deskZ: 5  },
  // RIGHT WING — Zone D: Infrastructure
  { id:"dbadmin",       name:"DB Admin",     emoji:"🗄️", color:"#e11d48", deskX:15, deskZ: 8  },
  { id:"storage",       name:"Storage",      emoji:"💾", color:"#0891b2", deskX:18, deskZ: 8  },
  { id:"reviewer",      name:"Reviewer",     emoji:"👁️", color:"#84cc16", deskX:15, deskZ:11  },
  { id:"botmaster",     name:"Botmaster",    emoji:"🤖", color:"#14b8a6", deskX:18, deskZ:11  },
  { id:"codev",         name:"Co-Dev",       emoji:"🤝", color:"#c2410c", deskX:15, deskZ:13  },
  { id:"product",       name:"Product",      emoji:"📋", color:"#7e22ce", deskX:18, deskZ:13  },
] as const;

// Elevator queue waiting spots
const Q_SPOTS_F1: [number,number][] = [[9,6],[9,7],[10,6],[10,7]]; // near elv on F1
const Q_SPOTS_F0: [number,number][] = [[12,6],[12,7],[13,6],[13,7]]; // near elv on F0

// Meeting room seats (floor 0) — 8 seats around oval table
const MEET_CX = 18, MEET_CZ = 8;
const MEETING_SEATS: [number,number][] = [
  [18,5.5],[20.5,6.5],[22,8],[20.5,9.5],
  [18,10.5],[15.5,9.5],[14,8],[15.5,6.5],
];

// Floor zones for color coding
const ZONES_F1 = [
  { name:"Command",    color:"#10b981", x:1, z:1, w:7, d:4 },
  { name:"Research",   color:"#8b5cf6", x:1, z:4, w:7, d:5 },
  { name:"Ops Hub",    color:"#f59e0b", x:1, z:9, w:7, d:6 },
  { name:"Creative",   color:"#ec4899", x:1, z:3, w:2, d:3 },
  { name:"Engineering",color:"#f97316", x:13,z:1, w:7, d:5 },
  { name:"Infra",      color:"#0891b2", x:13,z:5, w:7, d:5 },
  { name:"Executive",  color:"#eab308", x:13,z:10,w:7, d:5 },
];
const ZONES_F0 = [
  { name:"Meeting",    color:"#3b82f6", x:13,z:3, w:11,d:11 },
  { name:"Break Room", color:"#22c55e", x: 1,z:1, w: 8,d: 7 },
  { name:"Lobby",      color:"#64748b", x: 1,z:9, w: 8,d: 6 },
  { name:"Elev Lobby", color:"#7c3aed", x: 8,z:4, w: 5,d: 7 },
];

// ════════════════════════════════════════════════════════════════════════
//  HELPER: Isometric projection
// ════════════════════════════════════════════════════════════════════════

function iso(wx: number, wz: number, wy: number, cx: number, cy: number) {
  return {
    x: (wx - wz) * TW2 + cx,
    y: (wx + wz) * TH2 - wy * FLOOR_H + cy,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  DRAWING PRIMITIVES
// ════════════════════════════════════════════════════════════════════════

function tile(c: CanvasRenderingContext2D, wx: number, wz: number, wy: number,
              col: string, cx: number, cy: number) {
  const tl = iso(wx,   wz,   wy, cx, cy);
  const tr = iso(wx+1, wz,   wy, cx, cy);
  const br = iso(wx+1, wz+1, wy, cx, cy);
  const bl = iso(wx,   wz+1, wy, cx, cy);
  c.beginPath();
  c.moveTo(tl.x, tl.y); c.lineTo(tr.x, tr.y);
  c.lineTo(br.x, br.y); c.lineTo(bl.x, bl.y);
  c.closePath();
  c.fillStyle = col; c.fill();
}

function box(
  c: CanvasRenderingContext2D,
  bx: number, bz: number, by: number,
  bw: number, bd: number, bh: number,
  topCol: string, leftCol: string, rightCol: string,
  cx: number, cy: number,
) {
  const p = (dx: number, dz: number, dy: number) => iso(bx+dx, bz+dz, by+dy, cx, cy);

  // Top face
  const tl=p(0,0,bh), tr=p(bw,0,bh), br=p(bw,bd,bh), bl=p(0,bd,bh);
  c.beginPath(); c.moveTo(tl.x,tl.y); c.lineTo(tr.x,tr.y); c.lineTo(br.x,br.y); c.lineTo(bl.x,bl.y); c.closePath();
  c.fillStyle=topCol; c.fill();

  // Left face (x+w, z .. z+d)
  const lbl=p(0,0,0), lbr=p(0,bd,0), ltr_=p(0,bd,bh), ltl=p(0,0,bh);
  c.beginPath(); c.moveTo(ltl.x,ltl.y); c.lineTo(lbl.x,lbl.y); c.lineTo(lbr.x,lbr.y); c.lineTo(ltr_.x,ltr_.y); c.closePath();
  c.fillStyle=leftCol; c.fill();

  // Right face (x .. x+w, z+d)
  const rbl=p(bw,bd,0), rbr_=p(0,bd,0), rtr=p(0,bd,bh), rtl=p(bw,bd,bh);
  c.beginPath(); c.moveTo(rtl.x,rtl.y); c.lineTo(rbl.x,rbl.y); c.lineTo(rbr_.x,rbr_.y); c.lineTo(rtr.x,rtr.y); c.closePath();
  c.fillStyle=rightCol; c.fill();

  // Outlines
  c.strokeStyle="rgba(0,0,0,0.15)"; c.lineWidth=0.5;
  c.stroke();
}

// ════════════════════════════════════════════════════════════════════════
//  SPEECH / BUBBLE LINES
// ════════════════════════════════════════════════════════════════════════

const CHAT_LINES = [
  "Need help?","On it!","Check this","PR ready","Good idea!",
  "Almost done","Deploy?","Ship it!","Fixed it!","Tests pass",
  "Code review","Great work!","Discuss?","Deadline!","Let's sync",
  "Blocked here","Update?","LGTM 👍","Ideas?","Let me check",
];

// ════════════════════════════════════════════════════════════════════════
//  AGENT CHARACTER DRAWING
// ════════════════════════════════════════════════════════════════════════

function drawHead(c: CanvasRenderingContext2D, color: string, headY: number, emoji: string, scale=1) {
  const r = 11 * scale;
  c.beginPath(); c.arc(0, headY, r, 0, Math.PI*2);
  c.fillStyle = color; c.fill();
  c.strokeStyle = "rgba(255,255,255,0.3)"; c.lineWidth=1.5; c.stroke();
  c.font = `${11*scale}px serif`; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(emoji, 0, headY);
}

function drawBody(c: CanvasRenderingContext2D, color: string, bodyY: number, w=10, h=20) {
  c.fillStyle = color + "cc";
  c.beginPath();
  c.roundRect(-w/2, bodyY, w, h, 3);
  c.fill();
}

function arm(c: CanvasRenderingContext2D, color: string, side: number, angle: number, len=12, ox=7, oy=-12) {
  c.save();
  c.translate(side*ox, oy);
  c.rotate(angle);
  c.strokeStyle = color; c.lineWidth=4; c.lineCap="round";
  c.beginPath(); c.moveTo(0,0); c.lineTo(0,len); c.stroke();
  c.restore();
}

function leg(c: CanvasRenderingContext2D, color: string, side: number, angle: number, len=13) {
  c.save();
  c.translate(side*4, 4);
  c.rotate(angle);
  c.strokeStyle = color + "99"; c.lineWidth=5; c.lineCap="round";
  c.beginPath(); c.moveTo(0,0); c.lineTo(0,len); c.stroke();
  // Foot
  c.beginPath(); c.moveTo(0,len); c.lineTo(side*4, len+3); c.stroke();
  c.restore();
}

function drawAgentChar(
  c: CanvasRenderingContext2D,
  ag: AgentSim,
  time: number,
  isSelected: boolean,
  emotionEmoji?: string,
) {
  const ph = ag.phase;
  const col = ag.color;
  const em  = ag.emoji;

  // Selection glow
  if (isSelected) {
    c.beginPath(); c.arc(0, -10, 28, 0, Math.PI*2);
    c.fillStyle = col + "30"; c.fill();
    c.strokeStyle = col; c.lineWidth=2; c.stroke();
  }

  // Shadow
  c.beginPath(); c.ellipse(0, 6, 14, 5, 0, 0, Math.PI*2);
  c.fillStyle = "rgba(0,0,0,0.25)"; c.fill();

  switch (ag.activity) {
    case "typing": {
      const bob = Math.sin(ph*5)*1;
      drawBody(c, col, -24+bob);
      drawHead(c, col, -36+bob, em);
      // Arms forward (typing position)
      arm(c, col,  1, 0.5, 14);
      arm(c, col, -1, 0.5, 14);
      // Keyboard glow
      c.fillStyle="#1e293b"; c.fillRect(-14, -4, 28, 7); c.strokeStyle=col+"40"; c.lineWidth=1; c.strokeRect(-14,-4,28,7);
      // Fingers tapping
      const tap = Math.sin(ph*8)*2;
      c.fillStyle = col+"80"; c.fillRect(-8, -2+tap, 5, 2); c.fillRect(3, -2-tap, 5, 2);
      // Legs under desk
      leg(c, col, -1, -0.3, 11);
      leg(c, col,  1, -0.3, 11);
      break;
    }

    case "drinking": {
      drawBody(c, col, -24);
      drawHead(c, col, -37, em);
      // Right arm raised with cup
      arm(c, col,  1, -0.7, 12);
      // Cup
      c.save(); c.translate(13, -22); c.rotate(-0.7);
      c.fillStyle="#475569"; c.fillRect(-3, 0, 7, 8);
      const liquid = ["#7c3aed","#dc2626","#059669","#0ea5e9"][Math.abs(Math.floor(time*0.1))%4]!;
      c.fillStyle = liquid + "80"; c.fillRect(-2,1,5,3);
      // Steam
      if (Math.sin(ph*3) > 0) {
        c.strokeStyle="rgba(255,255,255,0.4)"; c.lineWidth=1.5; c.lineCap="round";
        c.beginPath(); c.moveTo(0,0); c.quadraticCurveTo(3,-4,0,-8); c.stroke();
      }
      c.restore();
      // Left arm resting
      arm(c, col, -1, 0.2, 12);
      // Legs sitting
      leg(c, col, -1, -0.25, 11); leg(c, col, 1, -0.25, 11);
      break;
    }

    case "stretching": {
      const t = Math.min(1, (ag.actTimer < 20 ? ag.actTimer/20 : 1));
      const lift = -30 * t;
      drawBody(c, col, -22 + lift*0.1);
      drawHead(c, col, -35 + lift*0.15, em);
      // Arms stretch up
      arm(c, col,  1, -Math.PI/2 * t, 16);
      arm(c, col, -1,  Math.PI/2 * t, 16);
      // Hands reaching (circle at end)
      if (t > 0.7) {
        c.beginPath(); c.arc( 18, -22+lift, 4, 0, Math.PI*2); c.fillStyle=col+"80"; c.fill();
        c.beginPath(); c.arc(-18, -22+lift, 4, 0, Math.PI*2); c.fillStyle=col+"80"; c.fill();
      }
      leg(c, col, -1, -0.2, 12); leg(c, col, 1, -0.2, 12);
      break;
    }

    case "chatting": {
      const lean = Math.sin(ph*2)*0.1;
      c.save(); c.rotate(lean);
      drawBody(c, col, -24);
      drawHead(c, col, -37, em);
      // Gesturing arm
      arm(c, col,  1, -0.4 + Math.sin(ph*3)*0.2, 14);
      arm(c, col, -1,  0.15, 12);
      c.restore();
      leg(c, col, -1, -0.25, 11); leg(c, col, 1, -0.25, 11);
      break;
    }

    case "presenting": {
      drawBody(c, col, -24);
      drawHead(c, col, -37, em);
      // Extended arm pointing
      arm(c, col,  1, -1.2, 18);
      arm(c, col, -1,  0.2, 12);
      // Pointer dot
      c.beginPath(); c.arc(15, -38, 4, 0, Math.PI*2);
      c.fillStyle = col; c.fill();
      c.strokeStyle="#fff"; c.lineWidth=1; c.stroke();
      leg(c, col, -1,  0.15, 13); leg(c, col, 1, -0.15, 13);
      break;
    }

    case "nodding": {
      const nod = Math.sin(ph*4)*0.18;
      drawBody(c, col, -24);
      c.save(); c.rotate(nod);
      drawHead(c, col, -36, em);
      c.restore();
      arm(c, col,  1, 0.1 + nod*0.5, 13);
      arm(c, col, -1, 0.1, 13);
      leg(c, col, -1, -0.2, 11); leg(c, col, 1, -0.2, 11);
      break;
    }

    case "drowsy": {
      const droop = Math.sin(ph*0.8)*3;
      drawBody(c, col, -22);
      // Drooped head
      c.save(); c.rotate(0.25);
      drawHead(c, col, -34+droop, "😴");
      c.restore();
      // Arm supporting head
      arm(c, col,  1, -0.5, 10);
      arm(c, col, -1,  0.3, 11);
      // Zzz
      c.font="10px serif"; c.fillStyle=col+"80";
      c.fillText("z", 14, -40+droop);
      c.font="8px serif"; c.fillText("z", 18, -47+droop);
      c.font="6px serif"; c.fillText("z", 21, -53+droop);
      leg(c, col, -1, -0.2, 11); leg(c, col, 1, -0.2, 11);
      break;
    }

    case "sleeping": {
      // Leaned forward on desk
      drawBody(c, col, -20);
      c.save(); c.rotate(1.1);
      drawHead(c, col, -8, "😴");
      c.restore();
      arm(c, col,  1, 0.7, 14); arm(c, col, -1, 0.7, 14);
      const zPh = (ph*0.5)%1;
      c.font=`${9+zPh*3}px serif`; c.fillStyle=`rgba(200,200,255,${0.8-zPh*0.6})`;
      c.fillText("Zzz", 10, -15-zPh*15);
      leg(c, col, -1, -0.2, 11); leg(c, col, 1, -0.2, 11);
      break;
    }

    case "phone": {
      drawBody(c, col, -24);
      drawHead(c, col, -37, em);
      // Left arm raised holding phone
      arm(c, col, -1, -0.6, 12);
      // Phone rect
      c.save(); c.translate(-13, -24); c.rotate(-0.6);
      c.fillStyle="#1e293b"; c.fillRect(-2,-1,5,8); c.strokeStyle="#334155"; c.lineWidth=1; c.strokeRect(-2,-1,5,8);
      c.fillStyle="#0ea5e9"; c.fillRect(-1,0,3,5);
      c.restore();
      arm(c, col, 1, 0.15, 13);
      leg(c, col, -1, -0.2, 11); leg(c, col, 1, -0.2, 11);
      break;
    }

    case "walking": {
      const sw = Math.sin(ag.walkPhase);
      const bob2 = Math.abs(sw) * -3;
      c.save(); c.rotate(sw*0.04);
      drawBody(c, col, -24+bob2);
      drawHead(c, col, -37+bob2, em);
      c.restore();
      arm(c, col,  1,  sw*0.5, 13);
      arm(c, col, -1, -sw*0.5, 13);
      leg(c, col, -1, -sw*0.45, 13);
      leg(c, col,  1,  sw*0.45, 13);
      break;
    }

    case "waiting": {
      const sway = Math.sin(ph*1.2)*0.07;
      c.save(); c.rotate(sway);
      drawBody(c, col, -24);
      drawHead(c, col, -37, em);
      c.restore();
      arm(c, col,  1, 0.3 + sway, 12);
      arm(c, col, -1, 0.3 - sway, 12);
      leg(c, col, -1, 0.05, 13); leg(c, col, 1, -0.05, 13);
      break;
    }

    default: { // idle
      const sway2 = Math.sin(ph*0.9)*0.06;
      c.save(); c.rotate(sway2);
      drawBody(c, col, -24);
      drawHead(c, col, -37, em);
      c.restore();
      arm(c, col,  1, 0.15, 12);
      arm(c, col, -1, 0.15, 12);
      leg(c, col, -1, 0, 12); leg(c, col, 1, 0, 12);
    }
  }

  // Emotion overlay
  if (emotionEmoji) {
    c.font="13px serif"; c.textAlign="center";
    c.fillText(emotionEmoji, 14, -45 + Math.sin(ph)*2);
  }
}

function drawNameTag(c: CanvasRenderingContext2D, name: string, status: string, color: string, y: number) {
  const w = Math.max(50, name.length*5.5 + 10);
  c.fillStyle="rgba(2,8,22,0.88)";
  c.beginPath(); c.roundRect(-w/2, y-14, w, 22, 5); c.fill();
  c.strokeStyle=color+"60"; c.lineWidth=1; c.stroke();
  c.fillStyle=color; c.font="bold 9px 'Space Mono', monospace";
  c.textAlign="center"; c.textBaseline="middle";
  c.fillText(name, 0, y-4);
  const sc = status==="working" ? "#34d399" : status==="error" ? "#f87171" : status==="idle" ? "#fbbf24" : "#475569";
  c.fillStyle=sc; c.font="8px 'Space Mono', monospace";
  c.fillText("● "+status, 0, y+6);
}

function drawSpeechBubble(c: CanvasRenderingContext2D, text: string, phase: number) {
  const w = Math.max(60, text.length*5 + 12);
  const h = 18;
  const bx = -w/2, by = -80 + Math.sin(phase*2)*3;
  c.fillStyle="rgba(15,23,42,0.95)";
  c.beginPath(); c.roundRect(bx, by, w, h, 5); c.fill();
  c.strokeStyle="rgba(96,165,250,0.6)"; c.lineWidth=1.2; c.stroke();
  // Tail
  c.beginPath(); c.moveTo(-4, by+h); c.lineTo(4, by+h); c.lineTo(0, by+h+7); c.closePath();
  c.fillStyle="rgba(15,23,42,0.95)"; c.fill();
  c.fillStyle="#93c5fd"; c.font="8px 'Space Mono', monospace";
  c.textAlign="center"; c.textBaseline="middle";
  c.fillText(text, 0, by + h/2);
}

// ════════════════════════════════════════════════════════════════════════
//  ROOM / FURNITURE DRAWING
// ════════════════════════════════════════════════════════════════════════

function drawDesk(c: CanvasRenderingContext2D, wx: number, wz: number, color: string, cx: number, cy: number) {
  const wy = 1;
  // Desk surface
  box(c, wx-0.7, wz-0.5, wy, 1.4, 1.0, 0.15, "#7c6040", "#5a4530", "#4a3820", cx, cy);
  // Monitor stand
  box(c, wx-0.05, wz-0.1, wy+0.15, 0.1, 0.1, 0.3, "#1e293b","#111827","#111827", cx, cy);
  // Monitor screen
  box(c, wx-0.35, wz-0.05, wy+0.45, 0.7, 0.05, 0.45, color+"50", color+"30", color+"20", cx, cy);
  // Screen glow (tile overlay)
  const sp = iso(wx, wz+0.02, wy+0.47, cx, cy);
  c.beginPath(); c.arc(sp.x, sp.y, 6, 0, Math.PI*2);
  c.fillStyle=color+"40"; c.fill();
  // Chair
  box(c, wx-0.3, wz+0.5, wy, 0.6, 0.6, 0.07, "#1e293b","#111827","#111827", cx, cy);
  box(c, wx-0.25, wz+0.5, wy+0.07, 0.5, 0.05, 0.45,"#1e293b","#111827","#111827",cx,cy);
}

function drawMeetingTable(c: CanvasRenderingContext2D, cx: number, cy: number, hasMeeting: boolean, ph: number) {
  const mx = MEET_CX, mz = MEET_CZ, wy = 0;
  // Oval table (approximate with boxes)
  const glow = hasMeeting ? 0.5+Math.sin(ph*2)*0.3 : 0;
  if (glow > 0) {
    const cp = iso(mx, mz, wy+0.4, cx, cy);
    const gr = c.createRadialGradient(cp.x, cp.y, 5, cp.x, cp.y, 80);
    gr.addColorStop(0, `rgba(59,130,246,${glow*0.4})`);
    gr.addColorStop(1, "transparent");
    c.fillStyle=gr; c.beginPath(); c.ellipse(cp.x, cp.y, 90, 50, 0, 0, Math.PI*2); c.fill();
  }
  // Table legs
  for (const [dx, dz] of [[-1.2,-1.2],[-1.2,1.2],[1.2,-1.2],[1.2,1.2]]) {
    box(c, mx+dx-0.07, mz+dz-0.07, wy, 0.14, 0.14, 0.38, "#4a3820","#3a2810","#3a2810",cx,cy);
  }
  // Table top
  box(c, mx-1.6, mz-1.8, wy+0.38, 3.2, 3.6, 0.12, "#6d4f2a", "#5a3f1e", "#4a3010", cx, cy);
  // Laptops/papers on table
  for (let i = 0; i < 6; i++) {
    const ang = (i/6)*Math.PI*2;
    const tx = mx + Math.cos(ang)*1.1;
    const tz = mz + Math.sin(ang)*1.4;
    box(c, tx-0.2, tz-0.15, wy+0.5, 0.4, 0.3, 0.02, "#1e293b","#111827","#111827", cx, cy);
  }
  // Meeting label
  if (hasMeeting) {
    const lp = iso(mx, mz, wy+0.65, cx, cy);
    c.fillStyle="rgba(2,8,22,0.9)"; c.strokeStyle="#3b82f6"; c.lineWidth=1.5;
    c.beginPath(); c.roundRect(lp.x-55, lp.y-14, 110, 22, 5); c.fill(); c.stroke();
    c.fillStyle="#93c5fd"; c.font="bold 9px 'Space Mono', monospace";
    c.textAlign="center"; c.textBaseline="middle";
    c.fillText("🤝 MEETING IN PROGRESS", lp.x, lp.y-3);
  }
}

function drawElevator(
  c: CanvasRenderingContext2D,
  elv: ElevatorSim,
  time: number,
  cx: number, cy: number,
) {
  const ex = ELV_X, ez = ELV_Z;

  // ─ Shaft (tall box spanning both floors) ─
  const shaftCol = "#0f1729";
  const shaftColL = "#0a1020";
  const shaftColR = "#070d18";
  box(c, ex-0.6, ez-0.6, 0, 1.2, 1.2, 0.4, shaftCol, shaftColL, shaftColR, cx, cy);
  box(c, ex-0.5, ez-0.5, 0.4, 1.0, 1.0, 3.5, shaftCol, shaftColL, shaftColR, cx, cy);
  // Rail lines on shaft
  for (let ry = 0; ry < 3.5; ry += 0.4) {
    const rp = iso(ex+0.5, ez-0.5, ry+0.4, cx, cy);
    c.beginPath(); c.arc(rp.x, rp.y, 2, 0, Math.PI*2);
    c.fillStyle="#1e3a5f"; c.fill();
  }

  // ─ Car ─
  const carBaseY = elv.carY * 3.0; // convert 0-1 floor to world Y
  const carGlow  = elv.door > 0.3 ? 0.7 + Math.sin(time*4)*0.15 : 0.2;
  box(c, ex-0.45, ez-0.45, carBaseY+0.4, 0.9, 0.9, 0.7,
    `rgba(30,50,80,${0.95})`,
    `rgba(15,30,60,${0.95})`,
    `rgba(10,20,50,${0.95})`,
    cx, cy);
  // Car floor indicator light
  const carTop = iso(ex, ez-0.2, carBaseY+1.1, cx, cy);
  const floorNum = elv.carY > 0.5 ? "2F" : "1F";
  c.fillStyle=`rgba(59,130,246,${carGlow})`;
  c.beginPath(); c.arc(carTop.x, carTop.y, 8, 0, Math.PI*2); c.fill();
  c.fillStyle="#fff"; c.font="bold 7px monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(floorNum, carTop.x, carTop.y);

  // ─ Doors ─
  const doorOpen = elv.door; // 0=closed, 1=open
  const dw = 0.45 * (1 - doorOpen);
  if (dw > 0.02) {
    // Left door
    box(c, ex-0.45, ez-0.45, carBaseY+0.4, dw, 0.05, 0.68,
      "#1e3a5f","#0f2040","#0a1828", cx, cy);
    // Right door
    box(c, ex-0.45+0.9-dw, ez-0.45, carBaseY+0.4, dw, 0.05, 0.68,
      "#1e3a5f","#0f2040","#0a1828", cx, cy);
  }
  // Door glow when open
  if (doorOpen > 0.5) {
    const dp = iso(ex, ez-0.5, carBaseY+0.75, cx, cy);
    c.fillStyle=`rgba(59,130,246,${(doorOpen-0.5)*0.5})`;
    c.beginPath(); c.ellipse(dp.x, dp.y, 30, 15, 0, 0, Math.PI*2); c.fill();
  }

  // ─ Floor buttons panel (decoration) ─
  for (const fy of [0, 1]) {
    const btnP = iso(ex-0.5, ez-0.52, 0.6 + fy*2.5, cx, cy);
    const active = Math.abs(elv.carY - fy) < 0.2;
    c.fillStyle = active ? "#3b82f6" : "#1e293b";
    c.beginPath(); c.arc(btnP.x, btnP.y, 5, 0, Math.PI*2); c.fill();
    c.fillStyle="#94a3b8"; c.font="6px monospace"; c.textAlign="center";
    c.textBaseline="middle"; c.fillText(fy === 1 ? "2" : "1", btnP.x, btnP.y);
  }

  // ─ Queue display on shaft ─
  const queueP = iso(ex+0.55, ez-0.6, 3.6, cx, cy);
  if (elv.queue.length > 0) {
    c.fillStyle="#eab308"; c.font="bold 8px monospace"; c.textAlign="center";
    c.fillText(`Q:${elv.queue.length}`, queueP.x, queueP.y);
  }

  // ─ Moving animation: arrow ─
  if (elv.moveState === "moving") {
    const arrP = iso(ex+0.55, ez-0.4, carBaseY+0.8, cx, cy);
    const dir  = elv.target === 1 ? -8 : 8;
    c.strokeStyle="#3b82f6"; c.lineWidth=2; c.lineCap="round";
    c.beginPath(); c.moveTo(arrP.x, arrP.y+4); c.lineTo(arrP.x, arrP.y+4+dir); c.stroke();
    c.beginPath(); c.moveTo(arrP.x-4, arrP.y+4+dir/2); c.lineTo(arrP.x, arrP.y+4+dir); c.lineTo(arrP.x+4, arrP.y+4+dir/2); c.stroke();
  }
}

function drawBreakRoom(c: CanvasRenderingContext2D, cx: number, cy: number) {
  const wy = 0;
  // Coffee machine
  box(c, 2, 1.5, wy, 0.7, 0.5, 0.9, "#1e293b","#111827","#0f172a", cx, cy);
  // Coffee machine screen
  const scrP = iso(2.35, 1.5, wy+0.6, cx, cy);
  c.fillStyle="#0ea5e9"; c.beginPath(); c.arc(scrP.x, scrP.y, 5, 0, Math.PI*2); c.fill();
  // Sofa left
  box(c, 1.2, 3, wy, 3, 1, 0.35, "#1e3a5f","#0f2040","#0a1828", cx, cy);
  box(c, 1.2, 3, wy+0.35, 0.3, 1, 0.5, "#1e3a5f","#0f2040","#0a1828", cx, cy);
  // Sofa right
  box(c, 1.2, 4.5, wy, 3, 1, 0.35, "#1e3a5f","#0f2040","#0a1828", cx, cy);
  // Coffee table
  box(c, 2.5, 3.7, wy, 1, 0.8, 0.1, "#7c6040","#5a4530","#4a3820", cx, cy);
  // Mugs on table
  const mColors = ["#dc2626","#0ea5e9","#10b981"];
  for (let i=0; i<3; i++) {
    box(c, 2.7+i*0.28, 3.9, wy+0.1, 0.15, 0.15, 0.15, mColors[i]!, mColors[i]!+"80", mColors[i]!+"60", cx, cy);
  }
  // Plant
  box(c, 5.5, 1.5, wy, 0.4, 0.4, 0.4, "#422006","#2d1604","#231203", cx, cy);
  const plantP = iso(5.7, 1.7, wy+0.4, cx, cy);
  c.beginPath(); c.arc(plantP.x, plantP.y, 10, 0, Math.PI*2);
  c.fillStyle="#15803d"; c.fill();
  c.beginPath(); c.arc(plantP.x+5, plantP.y-3, 7, 0, Math.PI*2);
  c.fillStyle="#166534"; c.fill();
  // Label
  const brP = iso(3, 4, wy+0.05, cx, cy);
  c.fillStyle="#22c55e50"; c.font="bold 9px monospace"; c.textAlign="center";
  c.fillText("☕ Break Room", brP.x, brP.y);
}

function drawLobby(c: CanvasRenderingContext2D, cx: number, cy: number) {
  const wy = 0;
  // Reception desk
  box(c, 2, 9, wy, 3, 0.7, 0.6, "#7c6040","#5a4530","#4a3820", cx, cy);
  // Computer on desk
  box(c, 2.5, 9.05, wy+0.6, 0.6, 0.05, 0.5, "#1e293b","#111827","#111827",cx,cy);
  // Waiting chairs
  for (let i=0; i<4; i++) {
    box(c, 1.5+i*0.9, 10.5, wy, 0.7, 0.7, 0.1, "#1e293b","#111827","#111827",cx,cy);
  }
  // Welcome sign
  const signP = iso(3.5, 8.9, wy+0.7, cx, cy);
  c.fillStyle="#eab308"; c.font="bold 9px monospace"; c.textAlign="center";
  c.fillText("🏢 DLavie OS HQ", signP.x, signP.y);
}

// ════════════════════════════════════════════════════════════════════════
//  FLOOR RENDERING
// ════════════════════════════════════════════════════════════════════════

function renderFloor(
  c: CanvasRenderingContext2D,
  wy: 0|1,
  zones: typeof ZONES_F0,
  cx: number, cy: number,
) {
  const bounds = { x0:0, z0:0, x1:24, z1:16 };
  // Base tiles
  for (let wx=bounds.x0; wx<bounds.x1; wx++) {
    for (let wz=bounds.z0; wz<bounds.z1; wz++) {
      const shade = (wx+wz) % 2 === 0 ? "#0b1625" : "#0d1a2d";
      tile(c, wx, wz, wy, shade, cx, cy);
    }
  }
  // Zone overlays
  for (const z of zones) {
    const alpha = 0.12;
    const [r,g,b] = hexToRGB(z.color);
    for (let wx=z.x; wx<z.x+z.w; wx++) {
      for (let wz=z.z; wz<z.z+z.d; wz++) {
        tile(c, wx, wz, wy, `rgba(${r},${g},${b},${alpha})`, cx, cy);
      }
    }
    // Zone border
    const sp = iso(z.x+z.w/2, z.z+z.d/2, wy+0.01, cx, cy);
    c.fillStyle=z.color+"80"; c.font="bold 8px 'Space Mono',monospace"; c.textAlign="center";
    c.fillText(z.name.toUpperCase(), sp.x, sp.y+4);
  }
  // Floor label
  const lp = iso(12, -0.5, wy, cx, cy);
  c.fillStyle="#1e3a5f"; c.font="bold 10px 'Space Mono',monospace"; c.textAlign="center";
  c.fillText(wy===1 ? "— FLOOR 2 · WORKSTATIONS —" : "— FLOOR 1 · COMMON AREAS —", lp.x, lp.y-20);
}

function hexToRGB(hex: string): [number,number,number] {
  const h = hex.replace("#","");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

// ════════════════════════════════════════════════════════════════════════
//  SIMULATION LOGIC
// ════════════════════════════════════════════════════════════════════════

function makeAgents(): Map<string, AgentSim> {
  const m = new Map<string, AgentSim>();
  for (const d of AGENT_DEFS) {
    m.set(d.id, {
      id: d.id, name: d.name, emoji: d.emoji, color: d.color,
      x: d.deskX + (Math.random()-0.5)*0.3,
      z: d.deskZ + (Math.random()-0.5)*0.3,
      floor: 1,
      tx: d.deskX, tz: d.deskZ, tfloor: 1,
      deskX: d.deskX, deskZ: d.deskZ,
      seatIdx: -1,
      phase: Math.random()*Math.PI*2,
      walkPhase: Math.random()*Math.PI*2,
      macro: "at_desk",
      activity: Math.random()<0.5 ? "typing" : "idle",
      actTimer: Math.floor(Math.random()*150+50),
      stTimer: 0,
      chatPartner: null,
      bubble: null, bubbleTimer: 0,
      facingAngle: 0,
    });
  }
  return m;
}

function tickSim(
  agents: Map<string, AgentSim>,
  elv: ElevatorSim,
  meetingSet: Set<string>,
  tick: number,
) {
  // ── Elevator state machine ──────────────────────────────────────────
  elv.timer = Math.max(0, elv.timer - 1);

  if (elv.moveState === "idle") {
    // Check queue
    const onFloor = elv.queue.filter(q => {
      const ag = agents.get(q.agentId);
      return ag && ag.floor === elv.floor && ag.macro === "queuing";
    });
    if (onFloor.length > 0 && elv.timer === 0) {
      elv.moveState = "loading";
      elv.doorState = "opening";
      elv.timer = 40;
    }
  }

  if (elv.moveState === "loading") {
    // Animate door opening
    if (elv.doorState === "opening") {
      elv.door = Math.min(1, elv.door + 0.06);
      if (elv.door >= 1) elv.doorState = "open";
    }
    if (elv.doorState === "open" && elv.timer === 0) {
      // Board all eligible agents (same floor, in queue)
      const toBoard = elv.queue
        .filter(q => {
          const ag = agents.get(q.agentId);
          if (!ag) return false;
          return ag.floor === elv.floor && ag.macro === "queuing";
        })
        .slice(0, ELV_CAP - elv.passengers.length);

      for (const qe of toBoard) {
        const ag = agents.get(qe.agentId);
        if (!ag) continue;
        elv.passengers.push(qe.agentId);
        elv.queue = elv.queue.filter(q => q.agentId !== qe.agentId);
        ag.macro = "in_elevator";
        ag.activity = "waiting";
        ag.x = ELV_X; ag.z = ELV_Z;
      }

      // Determine target floor
      if (elv.passengers.length > 0) {
        // Check where they want to go (opposite of current)
        const wantFloor0 = elv.passengers.filter(pid => {
          const ag = agents.get(pid);
          return ag && (ag.macro === "in_elevator") && meetingSet.has(pid);
        }).length;
        elv.target = wantFloor0 > 0 ? 0 : 1;
        elv.moveState = "moving";
        elv.doorState = "closing";
      } else {
        elv.moveState = "idle";
        elv.doorState = "closing";
      }
    }
  }

  if (elv.doorState === "closing") {
    elv.door = Math.max(0, elv.door - 0.08);
    if (elv.door <= 0) elv.doorState = "closed";
  }

  if (elv.moveState === "moving") {
    const diff = elv.target - elv.carY;
    if (Math.abs(diff) < 0.015) {
      elv.carY = elv.target;
      elv.floor = elv.target;
      elv.moveState = "unloading";
      elv.doorState = "opening";
      elv.timer = 50;
      // Update passengers' floor
      for (const pid of elv.passengers) {
        const ag = agents.get(pid);
        if (ag) { ag.floor = elv.target; ag.x = ELV_X; ag.z = ELV_Z; }
      }
    } else {
      elv.carY += Math.sign(diff) * 0.018;
      // Passengers travel with elevator
      for (const pid of elv.passengers) {
        const ag = agents.get(pid);
        if (ag) {
          // Visually they're inside the elevator, keep at ELV_X/Z
          ag.x = ELV_X; ag.z = ELV_Z;
          ag.floor = elv.carY > 0.5 ? 1 : 0;
        }
      }
    }
  }

  if (elv.moveState === "unloading") {
    if (elv.doorState === "opening") {
      elv.door = Math.min(1, elv.door + 0.06);
      if (elv.door >= 1) elv.doorState = "open";
    }
    if (elv.doorState === "open" && elv.timer === 0) {
      // Release passengers
      for (const pid of [...elv.passengers]) {
        const ag = agents.get(pid);
        if (!ag) continue;
        ag.floor = elv.floor;
        if (elv.floor === 0) {
          // Going to meeting room
          const qsp = Q_SPOTS_F0[elv.passengers.indexOf(pid) % Q_SPOTS_F0.length]!;
          ag.tx = qsp[0]; ag.tz = qsp[1]; ag.tfloor = 0;
          ag.macro = "walk_from_elv";
        } else {
          // Going back to desk
          ag.tx = ag.deskX; ag.tz = ag.deskZ; ag.tfloor = 1;
          ag.macro = "walk_to_desk";
        }
      }
      elv.passengers = [];
      elv.moveState = "idle";
      elv.doorState = "closing";
      elv.timer = 20;
    }
  }

  // ── Per-agent logic ───────────────────────────────────────────────
  for (const ag of agents.values()) {
    ag.phase     += 0.04;
    ag.walkPhase += 0.0;

    const isWalking = Math.hypot(ag.tx - ag.x, ag.tz - ag.z) > 0.12
                   && ag.floor === ag.tfloor;

    if (isWalking) {
      const dx = ag.tx - ag.x, dz = ag.tz - ag.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(AGENT_SPD, dist);
      ag.x += (dx/dist)*step;
      ag.z += (dz/dist)*step;
      ag.walkPhase += 0.18;
      ag.activity = "walking";
      ag.facingAngle = Math.atan2(dz, dx);
    } else if (ag.tfloor !== ag.floor && ag.macro !== "in_elevator") {
      // Waiting for elevator on wrong floor — set target to elevator
      ag.tx = ELV_X; ag.tz = ELV_Z;
    }

    // Activity timer (desk activities)
    ag.actTimer = Math.max(0, ag.actTimer - 1);
    if (ag.actTimer === 0 && (ag.macro === "at_desk" || ag.macro === "in_meeting")) {
      pickActivity(ag, agents, ag.macro);
    }

    // Speech bubble timer
    if (ag.bubbleTimer > 0) {
      ag.bubbleTimer--;
      if (ag.bubbleTimer === 0) ag.bubble = null;
    }
    // Random chat line while chatting
    if (ag.activity === "chatting" && Math.random() < 0.008) {
      ag.bubble = CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]!;
      ag.bubbleTimer = 100;
    }

    // Macro state machine
    switch (ag.macro) {
      case "at_desk": {
        ag.tx = ag.deskX; ag.tz = ag.deskZ; ag.tfloor = 1;
        if (!isWalking) ag.x = ag.deskX, ag.z = ag.deskZ;

        // Should go to meeting?
        if (meetingSet.has(ag.id) && ag.seatIdx === -1) {
          const usedSeats = new Set([...agents.values()].map(a=>a.seatIdx).filter(s=>s>=0));
          const seat = MEETING_SEATS.findIndex((_,i)=>!usedSeats.has(i));
          if (seat >= 0) {
            ag.seatIdx = seat;
            // Walk to elevator queue spot
            const used = new Set([...agents.values()]
              .filter(a => (a.macro==="walk_to_elv"||a.macro==="queuing") && a.floor===1)
              .map(a=>`${a.tx},${a.tz}`));
            const sp = Q_SPOTS_F1.find(([sx,sz])=>!used.has(`${sx},${sz}`));
            ag.tx = sp?.[0] ?? ELV_X-1; ag.tz = sp?.[1] ?? ELV_Z; ag.tfloor = 1;
            ag.macro = "walk_to_elv";
            ag.activity = "walking";
          }
        }
        break;
      }

      case "walk_to_elv": {
        if (!isWalking && ag.floor === 1) {
          ag.macro = "queuing";
          ag.x = ag.tx; ag.z = ag.tz;
          if (!elv.queue.find(q=>q.agentId===ag.id)) {
            elv.queue.push({ agentId:ag.id, dest:0 });
          }
        }
        break;
      }

      case "queuing": {
        ag.activity = "waiting";
        break;
      }

      case "in_elevator": {
        // Handled by elevator
        ag.activity = "waiting";
        break;
      }

      case "walk_from_elv": {
        if (!isWalking && ag.floor === 0) {
          if (ag.seatIdx >= 0 && ag.seatIdx < MEETING_SEATS.length) {
            const seat = MEETING_SEATS[ag.seatIdx]!;
            ag.tx = seat[0]; ag.tz = seat[1]; ag.tfloor = 0;
            ag.macro = "walk_to_meeting";
          } else {
            ag.macro = "walk_to_desk";
          }
        }
        break;
      }

      case "walk_to_meeting": {
        if (!isWalking && ag.floor === 0) {
          ag.macro = "in_meeting";
          ag.activity = "nodding";
          ag.x = ag.tx; ag.z = ag.tz;
          ag.actTimer = 60;
        }
        break;
      }

      case "in_meeting": {
        if (!meetingSet.has(ag.id)) {
          ag.seatIdx = -1;
          ag.macro = "walk_to_elv_return";
          const used = new Set([...agents.values()]
            .filter(a=>(a.macro==="walk_to_elv_return"||a.macro==="queuing_return")&&a.floor===0)
            .map(a=>`${a.tx},${a.tz}`));
          const sp = Q_SPOTS_F0.find(([sx,sz])=>!used.has(`${sx},${sz}`));
          ag.tx = sp?.[0] ?? ELV_X+1; ag.tz = sp?.[1] ?? ELV_Z; ag.tfloor = 0;
        }
        break;
      }

      case "walk_to_elv_return": {
        if (!isWalking && ag.floor === 0) {
          ag.macro = "queuing_return";
          ag.x = ag.tx; ag.z = ag.tz;
          if (!elv.queue.find(q=>q.agentId===ag.id)) {
            elv.queue.push({ agentId:ag.id, dest:1 });
          }
        }
        break;
      }

      case "queuing_return": {
        ag.activity = "waiting";
        break;
      }

      case "in_elevator_return": {
        ag.activity = "waiting";
        break;
      }

      case "walk_to_desk": {
        if (!isWalking && ag.floor === 1) {
          ag.macro = "at_desk";
          ag.activity = "idle";
          ag.actTimer = 30;
          ag.x = ag.deskX; ag.z = ag.deskZ;
        }
        break;
      }
    }
  }
}

function pickActivity(ag: AgentSim, agents: Map<string, AgentSim>, macro: Macro) {
  const roll = Math.random();
  if (macro === "at_desk") {
    if      (roll < 0.42) { ag.activity="typing";    ag.actTimer=100+Math.random()*160; }
    else if (roll < 0.55) { ag.activity="drinking";  ag.actTimer=40+Math.random()*50; }
    else if (roll < 0.64) { ag.activity="idle";      ag.actTimer=30+Math.random()*60; }
    else if (roll < 0.72) { ag.activity="stretching";ag.actTimer=40; }
    else if (roll < 0.80) { ag.activity="phone";     ag.actTimer=50+Math.random()*80; }
    else if (roll < 0.88) {
      ag.activity="chatting"; ag.actTimer=60+Math.random()*80;
      const nearby = [...agents.values()].filter(a=>a.id!==ag.id&&a.macro==="at_desk"&&Math.abs(a.deskX-ag.deskX)<4&&Math.abs(a.deskZ-ag.deskZ)<4);
      ag.chatPartner = nearby[0]?.id ?? null;
    }
    else if (roll < 0.94) { ag.activity="drowsy";    ag.actTimer=60; }
    else                  { ag.activity="sleeping";  ag.actTimer=80; }
  } else if (macro === "in_meeting") {
    if      (roll < 0.40) { ag.activity="nodding";   ag.actTimer=50+Math.random()*80; }
    else if (roll < 0.60) { ag.activity="chatting";  ag.actTimer=50+Math.random()*70;
      ag.bubble=CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]!; ag.bubbleTimer=90;
    }
    else if (roll < 0.75) { ag.activity="presenting";ag.actTimer=50; }
    else if (roll < 0.88) { ag.activity="typing";    ag.actTimer=40+Math.random()*60; }
    else                  { ag.activity="idle";      ag.actTimer=30+Math.random()*50; }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function OfficeRealistic({
  agentStatuses,
  selectedAgent,
  onSelectAgent,
  activeThreads = [],
  agentEmotions = new Map(),
}: OfficeRealisticProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<Map<string, AgentSim>>(makeAgents());
  const elvRef    = useRef<ElevatorSim>({
    floor:1, carY:1, target:1, door:0,
    doorState:"closed", moveState:"idle",
    timer:0, passengers:[], queue:[],
  });
  const timeRef   = useRef(0);
  const tickRef   = useRef(0);
  const rafRef    = useRef(0);
  const statusMap = useRef(new Map<string,string>());

  // Props refs (avoids stale closure in animation loop)
  const propsRef = useRef({ activeThreads, agentEmotions, agentStatuses, selectedAgent });
  propsRef.current = { activeThreads, agentEmotions, agentStatuses, selectedAgent };

  // Simulation tick
  useEffect(() => {
    const id = setInterval(() => {
      const { activeThreads: th } = propsRef.current;
      const meetingSet = new Set<string>();
      th.filter(t=>t.active).forEach(t=>t.participants.forEach(p=>meetingSet.add(p)));
      tickRef.current++;
      tickSim(agentsRef.current, elvRef.current, meetingSet, tickRef.current);

      // Update status map
      statusMap.current.clear();
      propsRef.current.agentStatuses.forEach(s => statusMap.current.set(s.agentId, s.status));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let running = true;

    function render() {
      if (!running) return;
      const c = canvas!.getContext("2d");
      if (!c) { rafRef.current = requestAnimationFrame(render); return; }
      const W = canvas!.width, H = canvas!.height;
      timeRef.current += 0.016;
      const time = timeRef.current;

      // Center both floors in the viewport simultaneously.
      // isoX range: (wx_max-wz_min)*TW2=21*TW2  to  (wx_min-wz_max)*TW2=-14*TW2
      //   → screen center offset = (21-14)/2 = 3.5 * TW2
      // isoY range (floor0 far) = 37*TH2,  (floor1 near) = 2*TH2 - FLOOR_H
      //   → vertical center = (37*TH2 + 2*TH2 - FLOOR_H) / 2
      const CX = W * 0.5 - TW2 * 3.5;
      const CY = H * 0.5 - (37 * TH2 + 2 * TH2 - FLOOR_H) / 2;

      // Clear
      c.fillStyle = "#020810";
      c.fillRect(0, 0, W, H);

      // ── Floor 0 (ground) ──
      renderFloor(c, 0, ZONES_F0, CX, CY);
      drawBreakRoom(c, CX, CY);
      drawLobby(c, CX, CY);

      // ── Floor 1 (upper) ──
      renderFloor(c, 1, ZONES_F1, CX, CY);
      // Desks on floor 1
      for (const d of AGENT_DEFS) {
        drawDesk(c, d.deskX, d.deskZ, d.color, CX, CY);
      }

      // ── Elevator shaft ──
      drawElevator(c, elvRef.current, time, CX, CY);

      // ── Meeting table (floor 0) ──
      const { activeThreads: th } = propsRef.current;
      const hasMeeting = th.some(t=>t.active);
      drawMeetingTable(c, CX, CY, hasMeeting, time);

      // ── Meeting chair indicators ──
      for (const [sx, sz] of MEETING_SEATS) {
        box(c, sx-0.3, sz-0.3, 0, 0.6, 0.6, 0.07, "#1e293b","#111827","#111827", CX, CY);
      }

      // ── Agents (sorted by depth) ──
      const { agentEmotions: emo, selectedAgent: sel } = propsRef.current;
      const agentList = [...agentsRef.current.values()];
      // Sort: lower floor first, then by wx+wz
      agentList.sort((a, b) => {
        if (a.floor !== b.floor) return a.floor - b.floor;
        return (a.x + a.z) - (b.x + b.z);
      });

      for (const ag of agentList) {
        const sp = iso(ag.x, ag.z, ag.floor + (ag.macro==="in_elevator" ? elvRef.current.carY - ag.floor : 0), CX, CY);
        const status = statusMap.current.get(ag.id) ?? "offline";
        const emotion = emo.get(ag.id);

        c.save();
        c.translate(sp.x, sp.y);

        drawAgentChar(c, ag, time, sel===ag.id, emotion?.emoji);
        drawNameTag(c, ag.name, status, ag.color, -55);

        if (ag.bubble) {
          drawSpeechBubble(c, ag.bubble, ag.phase);
        }

        // Queue number badge
        const qPos = elvRef.current.queue.findIndex(q=>q.agentId===ag.id);
        if (qPos >= 0) {
          c.fillStyle="#eab308"; c.font="bold 9px monospace"; c.textAlign="center";
          c.fillText(`Q${qPos+1}`, 18, -45);
        }

        c.restore();
      }

      // ── Elevator queue arrows (visual guide) ──
      const queueOnF1 = agentsRef.current.values.length > 0 &&
        [...agentsRef.current.values()].some(a=>a.macro==="queuing"&&a.floor===1);
      if (queueOnF1) {
        const arrP = iso(ELV_X-0.3, ELV_Z-1, 1, CX, CY);
        c.fillStyle="#eab308"; c.font="12px serif"; c.textAlign="center";
        c.fillText("⬇ Elevator", arrP.x, arrP.y);
      }

      // ── HUD ──
      const workCount = [...agentsRef.current.values()].filter(a=>a.macro!=="at_desk").length;
      const meetCount = [...agentsRef.current.values()].filter(a=>a.macro==="in_meeting").length;
      const elvQ      = elvRef.current.queue.length;

      c.fillStyle="rgba(2,8,22,0.8)"; c.strokeStyle="#1e3a5f"; c.lineWidth=1;
      c.beginPath(); c.roundRect(8, 8, 180, 70, 6); c.fill(); c.stroke();
      c.fillStyle="#334155"; c.font="9px 'Space Mono',monospace"; c.textAlign="left"; c.textBaseline="top";
      c.fillText("DLAVIE OS  OFFICE SIM", 16, 15);
      c.fillStyle="#34d399"; c.fillText(`● ${workCount} agents mobile`, 16, 28);
      c.fillStyle="#60a5fa"; c.fillText(`🤝 ${meetCount} in meeting`, 16, 40);
      c.fillStyle="#eab308"; c.fillText(`🛗 Elevator: ${elvRef.current.moveState} · Q:${elvQ}`, 16, 52);
      c.fillStyle="#475569"; c.fillText(`Floor ${elvRef.current.carY>0.5?"2":"1"} · ${elvRef.current.doorState}`, 16, 64);

      // Active meeting topic
      const activeTopic = th.find(t=>t.active)?.topic;
      if (activeTopic) {
        c.fillStyle="rgba(2,8,22,0.85)"; c.strokeStyle="#3b82f6";
        c.beginPath(); c.roundRect(W-280, 8, 272, 28, 5); c.fill(); c.stroke();
        c.fillStyle="#93c5fd"; c.font="9px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
        c.fillText("📋 " + activeTopic.slice(0, 36), W-144, 22);
      }

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      const r = canvas.parentElement?.getBoundingClientRect();
      if (r) { canvas.width = r.width; canvas.height = r.height; }
    });
    const r = canvas.parentElement?.getBoundingClientRect();
    if (r) { canvas.width = r.width; canvas.height = r.height; }
    obs.observe(canvas.parentElement ?? canvas);
    return () => obs.disconnect();
  }, []);

  // Click to select agent
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const CX = canvas.width * 0.5;
    const CY = canvas.height * 0.68;

    let best: string | null = null;
    let bestDist = 40;
    for (const ag of agentsRef.current.values()) {
      const sp = iso(ag.x, ag.z, ag.floor, CX, CY);
      const d = Math.hypot(sp.x - mx, sp.y - my - (-30));
      if (d < bestDist) { bestDist = d; best = ag.id; }
    }
    if (best) onSelectAgent(best);
  }, [onSelectAgent]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ width:"100%", height:"100%", display:"block", cursor:"pointer", background:"#020810" }}
    />
  );
}

export default OfficeRealistic;
