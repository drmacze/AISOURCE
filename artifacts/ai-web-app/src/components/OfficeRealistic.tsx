/**
 * OfficeRealistic.tsx — DLavie OS · Isometric Office Game (v2)
 *
 * Hotel-management-game style cross-section view:
 *  • 2 floors visible simultaneously (cross-section cutaway)
 *  • Vibrant colorful zone carpets + thick structural walls
 *  • Proper humanoid characters: skin · hair · shirt · pants · shoes
 *  • 20+ prop types: desks, whiteboards, plants, coffee, servers, sofas…
 *  • Complete state machine: elevator · meetings · breaks · walking
 *  • Pan/zoom/touch/click · minimap navigation
 */

import { useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════

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

interface Appearance {
  skin: string; hair: string; shirt: string; pants: string;
}

interface AgentSim {
  id: string; name: string; emoji: string; color: string;
  appear: Appearance;
  x: number; z: number; floor: 0 | 1;
  tx: number; tz: number; tfloor: 0 | 1;
  deskX: number; deskZ: number;
  seatIdx: number;
  phase: number; walkPhase: number;
  macro: Macro; activity: Activity;
  actTimer: number; stTimer: number;
  chatPartner: string | null;
  bubble: string | null; bubbleTimer: number;
}

interface ElevatorSim {
  floor: 0 | 1; carY: number; target: 0 | 1;
  door: number; doorState: "closed" | "opening" | "open" | "closing";
  moveState: "idle" | "loading" | "moving" | "unloading";
  timer: number; passengers: string[];
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

// ═══════════════════════════════════════════════════════════════════════
//  ISOMETRIC CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

const TW2 = 28;       // half tile width  → tile = 56px wide
const TH2 = 14;       // half tile height → tile = 28px tall
const FLOOR_H = 96;   // screen pixels per floor height unit
const AGENT_SPD = 0.08;
const ELV_X = 11; const ELV_Z = 7;
const ELV_CAP = 4;
const TICK_MS = 48;

// ═══════════════════════════════════════════════════════════════════════
//  VIBRANT GAME PALETTE  (hotel-management-game style)
// ═══════════════════════════════════════════════════════════════════════

const PAL = {
  // Floors
  floorA:     "#e8dfd0",
  floorB:     "#ddd4c4",
  // Zone carpet colors (vivid)
  carpetCmd:  "#4a7cdc",   // command — blue
  carpetRes:  "#5cb85c",   // research — green
  carpetEng:  "#e67e22",   // engineering — orange
  carpetInfra:"#9b59b6",   // infra — purple
  carpetExec: "#e91e63",   // executive — pink
  carpetMeet: "#00bcd4",   // meeting — cyan
  carpetBreak:"#8bc34a",   // break room — lime
  carpetLobby:"#ff9800",   // lobby — amber
  carpetSrv:  "#607d8b",   // server — steel
  // Walls / structure
  wallFace:   "#c9bfb0",
  wallLeft:   "#b0a494",
  wallRight:  "#9a8e82",
  structFront:"#5a5048",
  structLeft: "#3e3630",
  structRight:"#2e2820",
  // Furniture
  deskTop:    "#c49a54",
  deskLeft:   "#a07838",
  deskRight:  "#7a5a26",
  chairSeat:  "#3a5f8a",
  chairBack:  "#2a4f7a",
  chairSide:  "#1a3f6a",
  monFrame:   "#1a2230",
  monScreen:  "#0d1a2a",
  tableTop:   "#8b5e3c",
  tableLeft:  "#6a4628",
  tableRight: "#4e3018",
  sofaTop:    "#4a6da0",
  sofaFront:  "#3a5d90",
  sofaSide:   "#2a4d80",
  plantPot:   "#7a4828",
  plantGreen: "#2e8b40",
  plantDark:  "#1e6b28",
  sky:        "#1c1a2e",
  // Cross-section wall strips
  strip1:     "#7c6e5a",
  strip0:     "#6a5e4e",
};

// ═══════════════════════════════════════════════════════════════════════
//  AGENT APPEARANCES (skin · hair · shirt · pants)
// ═══════════════════════════════════════════════════════════════════════

const APPEARANCES: Record<string, Appearance> = {
  orchestrator: { skin:"#f5c5a3", hair:"#1a0a00", shirt:"#2060d8", pants:"#1a2a60" },
  mandor:       { skin:"#c07840", hair:"#0a0500", shirt:"#d4930a", pants:"#3a2804" },
  trainer:      { skin:"#f0d0b0", hair:"#4a2808", shirt:"#7a48c8", pants:"#2a1450" },
  librarian:    { skin:"#e8b48a", hair:"#180802", shirt:"#18a0d4", pants:"#0a3048" },
  researcher:   { skin:"#d49060", hair:"#601808", shirt:"#9040c4", pants:"#280a3c" },
  analyst:      { skin:"#f5e0c8", hair:"#382008", shirt:"#2058c4", pants:"#12204a" },
  guardian:     { skin:"#c07038", hair:"#100506", shirt:"#e05818", pants:"#3a1406" },
  qa:           { skin:"#e8d0a8", hair:"#5a3818", shirt:"#18b850", pants:"#083820" },
  security:     { skin:"#f0c8a0", hair:"#080808", shirt:"#902010", pants:"#280808" },
  network:      { skin:"#d0a878", hair:"#2a1808", shirt:"#1880b8", pants:"#082838" },
  curator:      { skin:"#f5c0d0", hair:"#8a1848", shirt:"#e01880", pants:"#280818" },
  frontend_dev: { skin:"#e8d0b0", hair:"#6a3018", shirt:"#5020a8", pants:"#180840" },
  engineer:     { skin:"#c87840", hair:"#0a0800", shirt:"#c04010", pants:"#380c04" },
  deployer:     { skin:"#f0d8c0", hair:"#101406", shirt:"#108090", pants:"#042030" },
  backend_dev:  { skin:"#d09060", hair:"#4a0808", shirt:"#b81020", pants:"#340408" },
  devops:       { skin:"#f5c8a0", hair:"#180c06", shirt:"#107840", pants:"#062818" },
  dbadmin:      { skin:"#e8c0a0", hair:"#300606", shirt:"#a00828", pants:"#280408" },
  storage:      { skin:"#d0b890", hair:"#281c08", shirt:"#106070", pants:"#042028" },
  reviewer:     { skin:"#f0d8b0", hair:"#504010", shirt:"#607010", pants:"#1c2804" },
  botmaster:    { skin:"#b8e8e0", hair:"#083020", shirt:"#089870", pants:"#042820" },
  codev:        { skin:"#f0c0a0", hair:"#580808", shirt:"#901810", pants:"#280604" },
  product:      { skin:"#e8d0f0", hair:"#400858", shirt:"#600888", pants:"#1a0428" },
};

// ═══════════════════════════════════════════════════════════════════════
//  WORLD LAYOUT
// ═══════════════════════════════════════════════════════════════════════

const AGENT_DEFS = [
  // Floor 1 — Left wing (Command & Research)
  { id:"orchestrator", name:"Orchestrator", emoji:"🎯", color:"#3a80e0", deskX:2,  deskZ:2  },
  { id:"mandor",       name:"Mandor",       emoji:"👑", color:"#d4930a", deskX:5,  deskZ:2  },
  { id:"guardian",     name:"Guardian",     emoji:"🛡️", color:"#e05818", deskX:2,  deskZ:5  },
  { id:"qa",           name:"QA",           emoji:"🧪", color:"#18b850", deskX:5,  deskZ:5  },
  { id:"trainer",      name:"Trainer",      emoji:"🧠", color:"#7a48c8", deskX:2,  deskZ:8  },
  { id:"librarian",    name:"Librarian",    emoji:"📚", color:"#18a0d4", deskX:5,  deskZ:8  },
  { id:"researcher",   name:"Researcher",   emoji:"🔬", color:"#9040c4", deskX:2,  deskZ:11 },
  { id:"analyst",      name:"Analyst",      emoji:"📊", color:"#2058c4", deskX:5,  deskZ:11 },
  // Floor 1 — Creative / Curator zone
  { id:"curator",      name:"Curator",      emoji:"✨", color:"#e01880", deskX:7,  deskZ:4  },
  { id:"frontend_dev", name:"Frontend",     emoji:"🎨", color:"#5020a8", deskX:7,  deskZ:7  },
  // Floor 1 — Right wing (Engineering & Infra)
  { id:"engineer",     name:"Engineer",     emoji:"⚙️", color:"#c04010", deskX:14, deskZ:2  },
  { id:"deployer",     name:"Deployer",     emoji:"🚀", color:"#108090", deskX:17, deskZ:2  },
  { id:"backend_dev",  name:"Backend",      emoji:"⚡", color:"#b81020", deskX:14, deskZ:5  },
  { id:"devops",       name:"DevOps",       emoji:"🔧", color:"#107840", deskX:17, deskZ:5  },
  { id:"dbadmin",      name:"DB Admin",     emoji:"🗄️", color:"#a00828", deskX:14, deskZ:8  },
  { id:"storage",      name:"Storage",      emoji:"💾", color:"#106070", deskX:17, deskZ:8  },
  { id:"reviewer",     name:"Reviewer",     emoji:"👁️", color:"#607010", deskX:14, deskZ:11 },
  { id:"botmaster",    name:"Botmaster",    emoji:"🤖", color:"#089870", deskX:17, deskZ:11 },
  { id:"security",     name:"Security",     emoji:"🔒", color:"#902010", deskX:14, deskZ:13 },
  { id:"network",      name:"Network",      emoji:"🌐", color:"#1880b8", deskX:17, deskZ:13 },
  { id:"codev",        name:"Co-Dev",       emoji:"🤝", color:"#901810", deskX:20, deskZ:6  },
  { id:"product",      name:"Product",      emoji:"📋", color:"#600888", deskX:20, deskZ:10 },
] as const;

// Floor 1 zone defs
const ZONES_F1 = [
  { name:"Command",    carpet:PAL.carpetCmd,   x:1,  z:1,  w:7,  d:4  },
  { name:"Research",   carpet:PAL.carpetRes,   x:1,  z:5,  w:7,  d:8  },
  { name:"Creative",   carpet:PAL.carpetExec,  x:7,  z:3,  w:4,  d:7  },
  { name:"Engineering",carpet:PAL.carpetEng,   x:12, z:1,  w:7,  d:5  },
  { name:"Infra",      carpet:PAL.carpetInfra, x:12, z:6,  w:7,  d:7  },
  { name:"Executive",  carpet:PAL.carpetExec,  x:12, z:12, w:10, d:4  },
  { name:"Lounge",     carpet:PAL.carpetBreak, x:19, z:1,  w:3,  d:11 },
];

// Floor 0 zone defs
const ZONES_F0 = [
  { name:"Meeting Hall", carpet:PAL.carpetMeet,  x:1,  z:1,  w:10, d:10 },
  { name:"Break Room",   carpet:PAL.carpetBreak, x:1,  z:11, w:10, d:5  },
  { name:"Lobby",        carpet:PAL.carpetLobby, x:11, z:1,  w:8,  d:8  },
  { name:"Server Room",  carpet:PAL.carpetSrv,   x:11, z:9,  w:11, d:7  },
];

const Q_SPOTS_F1: [number, number][] = [[9,6],[9,7],[10,6],[10,7]];
const Q_SPOTS_F0: [number, number][] = [[12,6],[12,7],[13,6],[13,7]];
const MEET_CX = 5; const MEET_CZ = 5;
const MEETING_SEATS: [number, number][] = [
  [3.5,3.5],[5,3],[6.5,3.5],[7.5,5],[7,6.5],[5.5,7.5],[4,7],[3,5.5],
];

const CHAT_LINES = [
  "Need help?","On it!","Check this","PR ready","Good idea!",
  "Almost done","Deploy?","Ship it!","Fixed it!","Tests pass",
  "Code review","Great work!","Discuss?","Deadline!","Let's sync",
  "Blocked!","Update?","LGTM 👍","Ideas?","Let me check",
];

// ═══════════════════════════════════════════════════════════════════════
//  ISOMETRIC PROJECTION
// ═══════════════════════════════════════════════════════════════════════

function iso(wx: number, wz: number, wy: number, cx: number, cy: number) {
  return {
    x: (wx - wz) * TW2 + cx,
    y: (wx + wz) * TH2 - wy * FLOOR_H + cy,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  COLOR UTILS
// ═══════════════════════════════════════════════════════════════════════

function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function lighter(hex: string, f: number): string {
  const [r,g,b] = hexToRGB(hex);
  return `rgb(${Math.min(255,r*f)|0},${Math.min(255,g*f)|0},${Math.min(255,b*f)|0})`;
}
function darker(hex: string, f: number): string { return lighter(hex, f); }
function alphaHex(hex: string, a: number): string {
  const [r,g,b] = hexToRGB(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ═══════════════════════════════════════════════════════════════════════
//  ISOMETRIC BOX PRIMITIVE  (with bold outline)
// ═══════════════════════════════════════════════════════════════════════

function box(
  c: CanvasRenderingContext2D,
  bx: number, bz: number, by: number,
  bw: number, bd: number, bh: number,
  topCol: string, leftCol: string, rightCol: string,
  cx: number, cy: number,
  outlineAlpha = 0.18,
) {
  const p = (dx: number, dz: number, dy: number) => iso(bx+dx, bz+dz, by+dy, cx, cy);

  // Top face
  const tl=p(0,0,bh), tr=p(bw,0,bh), br=p(bw,bd,bh), bl=p(0,bd,bh);
  c.beginPath(); c.moveTo(tl.x,tl.y); c.lineTo(tr.x,tr.y); c.lineTo(br.x,br.y); c.lineTo(bl.x,bl.y); c.closePath();
  c.fillStyle=topCol; c.fill();
  c.strokeStyle=`rgba(0,0,0,${outlineAlpha})`; c.lineWidth=0.6; c.stroke();

  // Left face
  const ll0=p(0,0,0), ll1=p(0,0,bh), ll2=p(0,bd,bh), ll3=p(0,bd,0);
  c.beginPath(); c.moveTo(ll1.x,ll1.y); c.lineTo(ll0.x,ll0.y); c.lineTo(ll3.x,ll3.y); c.lineTo(ll2.x,ll2.y); c.closePath();
  c.fillStyle=leftCol; c.fill();
  c.strokeStyle=`rgba(0,0,0,${outlineAlpha})`; c.lineWidth=0.6; c.stroke();

  // Right face (front)
  const rr0=p(bw,bd,0), rr1=p(0,bd,0), rr2=p(0,bd,bh), rr3=p(bw,bd,bh);
  c.beginPath(); c.moveTo(rr3.x,rr3.y); c.lineTo(rr0.x,rr0.y); c.lineTo(rr1.x,rr1.y); c.lineTo(rr2.x,rr2.y); c.closePath();
  c.fillStyle=rightCol; c.fill();
  c.strokeStyle=`rgba(0,0,0,${outlineAlpha})`; c.lineWidth=0.6; c.stroke();
}

// Flat tile (top face only)
function tile(c: CanvasRenderingContext2D, wx: number, wz: number, wy: number,
              col: string, cx: number, cy: number) {
  const tl=iso(wx,wz,wy,cx,cy), tr=iso(wx+1,wz,wy,cx,cy);
  const br=iso(wx+1,wz+1,wy,cx,cy), bl=iso(wx,wz+1,wy,cx,cy);
  c.beginPath(); c.moveTo(tl.x,tl.y); c.lineTo(tr.x,tr.y); c.lineTo(br.x,br.y); c.lineTo(bl.x,bl.y); c.closePath();
  c.fillStyle=col; c.fill();
}

// Pixel-space isometric box (for characters, drawn in screen space)
function pixBox(
  c: CanvasRenderingContext2D,
  sx: number, sy: number,
  pw: number, pd: number, ph: number,
  top: string, left: string, right: string,
  outline = 0.25,
) {
  // Top rhombus
  c.beginPath();
  c.moveTo(sx,   sy-pd); c.lineTo(sx+pw, sy);
  c.lineTo(sx,   sy+pd); c.lineTo(sx-pw, sy); c.closePath();
  c.fillStyle=top; c.fill();
  if (outline>0){ c.strokeStyle=`rgba(0,0,0,${outline})`; c.lineWidth=0.5; c.stroke(); }

  // Left face
  c.beginPath();
  c.moveTo(sx-pw,sy); c.lineTo(sx,sy+pd); c.lineTo(sx,sy+pd+ph); c.lineTo(sx-pw,sy+ph); c.closePath();
  c.fillStyle=left; c.fill();
  if (outline>0){ c.strokeStyle=`rgba(0,0,0,${outline})`; c.stroke(); }

  // Right face
  c.beginPath();
  c.moveTo(sx,sy+pd); c.lineTo(sx+pw,sy); c.lineTo(sx+pw,sy+ph); c.lineTo(sx,sy+pd+ph); c.closePath();
  c.fillStyle=right; c.fill();
  if (outline>0){ c.strokeStyle=`rgba(0,0,0,${outline})`; c.stroke(); }
}

// ═══════════════════════════════════════════════════════════════════════
//  HUMANOID CHARACTER DRAWING
//
//  sy = screen Y at floor level (feet contact point)
//  All parts drawn bottom→up from sy
// ═══════════════════════════════════════════════════════════════════════

function drawHumanoid(
  c: CanvasRenderingContext2D,
  sx: number, sy: number,
  appear: Appearance,
  activity: Activity,
  phase: number,
  walkPhase: number,
  selected: boolean,
  emote?: string,
) {
  // Dimensions (screen pixels)
  const SH=3, LH=11, TH=14, AH=10, HH=13;
  const SW=7, LW=6, TW=13, AW=6;
  const HD=6; // pixBox depth half

  // Derived y-levels (from floor up)
  const shoeY  = sy  - SH;       // shoe base
  const legY   = shoeY - LH;     // leg base
  const torsoY = legY - TH;      // torso base
  const armY   = torsoY + 2;     // arm attach
  const neckY  = torsoY - 3;     // neck
  const headCY = neckY - HH;     // head center

  // Derived colors
  const skinL  = darker(appear.skin, 0.82);
  const hairL  = darker(appear.hair, 0.7);
  const shirtL = darker(appear.shirt, 0.72);
  const shirtR = darker(appear.shirt, 0.55);
  const pantsL = darker(appear.pants, 0.72);
  const pantsR = darker(appear.pants, 0.55);
  const shoeC  = "#1a1820"; const shoeL = "#100f16"; const shoeR = "#0a0810";

  // Ground shadow
  c.save();
  c.globalAlpha = 0.28;
  c.beginPath(); c.ellipse(sx, sy+1, 15, 5, 0, 0, Math.PI*2);
  c.fillStyle="#000"; c.fill();
  c.restore();

  // Selection glow ring
  if (selected) {
    c.save();
    c.globalAlpha = 0.7;
    c.strokeStyle = appear.shirt;
    c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(sx, sy+1, 20, 7, 0, 0, Math.PI*2);
    c.stroke();
    c.restore();
  }

  // ── ACTIVITY-SPECIFIC POSE ─────────────────────────────────────────────
  const sw = Math.sin(walkPhase);
  const bw = Math.sin(phase * 1.4) * 1.2;

  if (activity === "walking") {
    const ls = sw * 5, rs = -sw * 5;
    // Shoes
    pixBox(c, sx-5, shoeY+ls, SW*0.5, HD*0.6, SH, shoeC, shoeL, shoeR);
    pixBox(c, sx+5, shoeY+rs, SW*0.5, HD*0.6, SH, shoeC, shoeL, shoeR);
    // Legs
    pixBox(c, sx-5, legY+ls, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+rs, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    // Torso
    pixBox(c, sx, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    // Arms (opposite swing)
    pixBox(c, sx-TW*0.55, armY-sw*4, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx+TW*0.55, armY+sw*4, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
  } else if (activity === "typing") {
    // Sitting pose
    pixBox(c, sx-5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY+bw, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    // Arms reaching forward (keyboard)
    pixBox(c, sx-TW*0.45, armY+bw, AW*0.5, HD*1.2, AH-2, shirtL, shirtL, shirtR);
    pixBox(c, sx+TW*0.45, armY-bw, AW*0.5, HD*1.2, AH-2, shirtL, shirtL, shirtR);
    // Keyboard prop
    pixBox(c, sx, legY-5, TW*0.7, HD*1.4, 2, "#202838", "#141e2c", "#0c1420");
  } else if (activity === "drinking") {
    pixBox(c, sx-5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    // Left arm resting
    pixBox(c, sx-TW*0.48, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    // Right arm raised with cup
    const raise = 10 + Math.sin(phase*1.2)*2;
    pixBox(c, sx+TW*0.48, armY-raise*0.5, AW*0.5, HD*0.4, AH+raise*0.3, lighter(appear.shirt,1.05), shirtL, shirtR);
    // Mug
    pixBox(c, sx+TW*0.48+3, armY-raise+4, 5, 4, 7, "#d4a070", "#a07848", "#7a5830");
    // Steam
    if (Math.sin(phase*2)>0) {
      c.strokeStyle="rgba(220,210,200,0.5)"; c.lineWidth=1; c.lineCap="round";
      c.beginPath(); c.moveTo(sx+TW*0.48+5, armY-raise); c.quadraticCurveTo(sx+TW*0.48+9, armY-raise-6, sx+TW*0.48+5, armY-raise-12); c.stroke();
    }
  } else if (activity === "stretching") {
    const t = Math.min(1, (50-phase*8)/20); const lift = t*16;
    pixBox(c, sx-5, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    pixBox(c, sx-TW*0.58, torsoY-lift, AW*0.5, HD*0.4, TH*0.6+lift, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx+TW*0.58, torsoY-lift, AW*0.5, HD*0.4, TH*0.6+lift, lighter(appear.shirt,1.05), shirtL, shirtR);
  } else if (activity === "chatting") {
    const lean = Math.sin(phase*1.8)*3;
    pixBox(c, sx-5+lean, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5+lean, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+lean, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    const gest = Math.sin(phase*2.5)*7;
    pixBox(c, sx+TW*0.5+lean, armY+gest, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx-TW*0.5+lean, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
  } else if (activity === "presenting") {
    pixBox(c, sx-5, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    pixBox(c, sx+TW*0.58, torsoY+TH*0.15, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx+TW*0.9, torsoY+TH*0.2+3, AW*0.4, HD*0.35, AH*0.7, lighter(appear.shirt,1.05), shirtL, shirtR);
    c.beginPath(); c.arc(sx+TW*1.15, torsoY+TH*0.3+6, 4, 0, Math.PI*2); c.fillStyle=appear.shirt; c.fill();
    c.strokeStyle="#fff"; c.lineWidth=0.8; c.stroke();
    pixBox(c, sx-TW*0.5, armY+4, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
  } else if (activity === "nodding") {
    const nod = Math.sin(phase*4)*4;
    pixBox(c, sx-5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    pixBox(c, sx-TW*0.5, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx+TW*0.5, armY+3+nod*0.4, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    // Override head nod below
    c.translate(0, nod);
  } else if (activity === "drowsy") {
    const droop = Math.sin(phase*0.6)*5;
    pixBox(c, sx-5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY+2, TW*0.48, HD*0.55, TH-2, lighter(appear.shirt,1.08), shirtL, shirtR);
    pixBox(c, sx+TW*0.48, armY+droop*0.3, AW*0.5, HD*0.4, AH+droop, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx-TW*0.48, armY+4, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    // Zzz float
    const zt = (phase*0.3)%1;
    c.save();
    c.globalAlpha = Math.max(0, 1-zt*2.5);
    c.fillStyle = alphaHex(appear.shirt, 0.85);
    c.font = "9px sans-serif"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText("z", sx+HH+4, headCY-HH-zt*14);
    c.restore();
  } else if (activity === "sleeping") {
    pixBox(c, sx-5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY+5, TW*0.46, HD*0.52, TH-5, lighter(appear.shirt,1.08), shirtL, shirtR);
    // Head slumped on desk
    c.beginPath(); c.ellipse(sx, torsoY+2, HH*0.88, HH*0.48, 0.15, 0, Math.PI*2);
    c.fillStyle=appear.skin; c.fill();
    c.strokeStyle=`rgba(0,0,0,0.2)`; c.lineWidth=0.6; c.stroke();
    // Hair stripe on slumped head
    c.beginPath(); c.ellipse(sx-2, torsoY-1, HH*0.75, HH*0.25, 0.15, 0, Math.PI*2);
    c.fillStyle=appear.hair; c.fill();
    // Zzz
    const zt2=(phase*0.28)%1;
    c.save(); c.globalAlpha=Math.max(0,1-zt2*2);
    c.fillStyle=alphaHex(appear.shirt, 0.8); c.font="10px sans-serif"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText("Zzz", sx+HH+6, torsoY-4-zt2*12); c.restore();
    return; // Skip standard head draw
  } else if (activity === "phone") {
    pixBox(c, sx-5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY+4, LW*0.5, HD*0.5, LH-4, appear.pants, pantsL, pantsR);
    pixBox(c, sx, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    const pAnim = Math.sin(phase*3)*2;
    pixBox(c, sx-TW*0.52, armY-2+pAnim, AW*0.5, HD*0.4, AH+3, lighter(appear.shirt,1.05), shirtL, shirtR);
    // Phone icon
    c.fillStyle="#12203a"; c.fillRect(sx-TW*0.62-2, armY-pAnim-5, 7, 10);
    c.fillStyle="#1a80e0"; c.fillRect(sx-TW*0.62-1, armY-pAnim-4, 5, 7);
    pixBox(c, sx+TW*0.5, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
  } else if (activity === "waiting") {
    const sway = Math.sin(phase*1.1)*2;
    pixBox(c, sx-5+sway, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5+sway, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+sway, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    pixBox(c, sx-TW*0.5+sway, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx+TW*0.5+sway, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
  } else {
    // idle / default
    const idleSway = Math.sin(phase*0.9)*1.5;
    pixBox(c, sx-5, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+5, legY, LW*0.5, HD*0.5, LH, appear.pants, pantsL, pantsR);
    pixBox(c, sx+idleSway, torsoY, TW*0.5, HD*0.6, TH, lighter(appear.shirt,1.08), shirtL, shirtR);
    pixBox(c, sx-TW*0.5+idleSway, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
    pixBox(c, sx+TW*0.5+idleSway, armY+3, AW*0.5, HD*0.4, AH, lighter(appear.shirt,1.05), shirtL, shirtR);
  }

  // Shoes (drawn for all non-special activities above)
  if (activity !== "sleeping") {
    pixBox(c, sx-5, shoeY, SW*0.5, HD*0.65, SH, shoeC, shoeL, shoeR);
    pixBox(c, sx+5, shoeY, SW*0.5, HD*0.65, SH, shoeC, shoeL, shoeR);
  }

  // ── HEAD (skin) ────────────────────────────────────────────────────
  if (activity !== "sleeping") {
    // Neck
    c.fillStyle = skinL;
    c.fillRect(sx-3, neckY, 6, 3);

    // Head sphere
    const headGrad = c.createRadialGradient(sx-HH*0.3, headCY-HH*0.3, 1, sx, headCY, HH);
    headGrad.addColorStop(0, lighter(appear.skin, 1.15));
    headGrad.addColorStop(1, skinL);
    c.beginPath(); c.arc(sx, headCY, HH, 0, Math.PI*2);
    c.fillStyle = headGrad; c.fill();
    c.strokeStyle = `rgba(0,0,0,0.25)`; c.lineWidth = 0.8; c.stroke();

    // Hair (top cap — draw over upper half of head)
    c.beginPath(); c.ellipse(sx, headCY-2, HH*0.92, HH*0.62, 0, Math.PI, 0);
    c.fillStyle = appear.hair; c.fill();
    // Hair side bits
    c.beginPath(); c.arc(sx-HH*0.82, headCY, HH*0.28, -0.6, 1.2); c.fillStyle=appear.hair; c.fill();
    c.beginPath(); c.arc(sx+HH*0.82, headCY, HH*0.28, Math.PI-1.2, Math.PI+0.6); c.fillStyle=appear.hair; c.fill();

    // Eyes
    const eyeY = headCY + 2;
    c.fillStyle = "#1a1020";
    c.beginPath(); c.ellipse(sx-4, eyeY, 1.8, 2, 0, 0, Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(sx+4, eyeY, 1.8, 2, 0, 0, Math.PI*2); c.fill();
    // Eye highlights
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.beginPath(); c.arc(sx-3.2, eyeY-0.8, 0.8, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(sx+4.8, eyeY-0.8, 0.8, 0, Math.PI*2); c.fill();

    // Mouth (smile for active, neutral for drowsy)
    c.strokeStyle = activity==="drowsy" ? "#8a6050" : "#a06050";
    c.lineWidth = 0.9; c.lineCap = "round";
    if (activity === "drowsy") {
      c.beginPath(); c.moveTo(sx-3, eyeY+5); c.lineTo(sx+3, eyeY+5); c.stroke();
    } else {
      c.beginPath(); c.arc(sx, eyeY+3, 3.5, 0.1, Math.PI-0.1); c.stroke();
    }

    // Emotion bubble
    if (emote) {
      c.font="13px serif"; c.textAlign="center"; c.textBaseline="bottom";
      const floatY = Math.sin(phase)*3;
      c.fillText(emote, sx+HH+4, headCY-HH-4+floatY);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SPEECH BUBBLE
// ═══════════════════════════════════════════════════════════════════════

function drawSpeechBubble(c: CanvasRenderingContext2D, text: string, sx: number, sy: number, phase: number) {
  const w = Math.max(58, text.length * 4.9 + 16);
  const bx = sx - w/2;
  const by = sy - 102 + Math.sin(phase*1.8)*2;
  // Bubble
  c.fillStyle = "rgba(255,255,255,0.97)";
  c.strokeStyle = "#b0c8e8";
  c.lineWidth = 1.2;
  c.beginPath(); c.roundRect(bx, by, w, 18, 5); c.fill(); c.stroke();
  // Tail
  c.beginPath(); c.moveTo(sx-4, by+18); c.lineTo(sx+4, by+18); c.lineTo(sx, by+25); c.closePath();
  c.fillStyle="rgba(255,255,255,0.97)"; c.fill();
  c.strokeStyle="#b0c8e8"; c.lineWidth=1; c.stroke();
  // Text
  c.fillStyle = "#2a3848"; c.font="bold 7.5px 'Space Mono',monospace";
  c.textAlign="center"; c.textBaseline="middle"; c.fillText(text, sx, by+9);
}

// ═══════════════════════════════════════════════════════════════════════
//  NAME TAG
// ═══════════════════════════════════════════════════════════════════════

function drawNameTag(c: CanvasRenderingContext2D, name: string, status: string, color: string, sx: number, sy: number) {
  const w = Math.max(54, name.length * 5.2 + 14);
  const by = sy - 82;
  c.fillStyle = "rgba(8,10,18,0.92)";
  c.strokeStyle = color + "60";
  c.lineWidth = 1;
  c.beginPath(); c.roundRect(sx-w/2, by, w, 22, 5); c.fill(); c.stroke();
  c.fillStyle = color;
  c.font = "bold 8px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(name, sx, by+7);
  const sc = status==="working"?"#6dcc8a":status==="error"?"#e07070":"#a0907a";
  c.fillStyle=sc; c.font="7px 'Space Mono',monospace"; c.fillText("● "+status, sx, by+16);
}

// ═══════════════════════════════════════════════════════════════════════
//  PROPS & FURNITURE
// ═══════════════════════════════════════════════════════════════════════

// Desk + monitor + chair
function drawDesk(c: CanvasRenderingContext2D, wx: number, wz: number, color: string, cx: number, cy: number) {
  const wy=1, dep=wx+wz;
  // Chair seat
  box(c, wx-0.32, wz+0.5, wy, 0.64, 0.64, 0.06, PAL.chairSeat, PAL.chairBack, PAL.chairSide, cx, cy);
  // Chair back
  box(c, wx-0.28, wz+0.5, wy+0.06, 0.56, 0.05, 0.44, PAL.chairSeat, PAL.chairBack, PAL.chairSide, cx, cy);
  // Desk
  box(c, wx-0.72, wz-0.52, wy, 1.44, 1.04, 0.1, PAL.deskTop, PAL.deskLeft, PAL.deskRight, cx, cy, dep);
  // Desk legs
  for (const [dx,dz] of [[-0.68,-0.48],[-0.68,0.44],[0.64,-0.48],[0.64,0.44]]) {
    box(c, wx+dx, wz+dz, wy-0.28, 0.07, 0.07, 0.28, "#604018","#402808","#2a1804", cx, cy, dep);
  }
  // Monitor stand
  box(c, wx-0.05, wz-0.1, wy+0.1, 0.1, 0.1, 0.3, "#303830","#202820","#101810", cx, cy, dep);
  // Monitor base
  box(c, wx-0.2, wz-0.18, wy+0.1, 0.4, 0.18, 0.04, "#282e28","#181e18","#0e1410", cx, cy, dep);
  // Monitor screen (agent color tinted)
  const [mr,mg,mb] = hexToRGB(color);
  const scTop = `rgb(${(mr*0.12)|0},${(mg*0.22)|0},${(mb*0.28)|0})`;
  box(c, wx-0.32, wz-0.06, wy+0.40, 0.64, 0.05, 0.42, scTop, PAL.monFrame, PAL.monFrame, cx, cy, dep);
  // Screen glow
  const gp = iso(wx, wz-0.03, wy+0.62, cx, cy);
  const gg = c.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, 16);
  gg.addColorStop(0, alphaHex(color, 0.38)); gg.addColorStop(1, "transparent");
  c.fillStyle=gg; c.beginPath(); c.ellipse(gp.x, gp.y, 16, 8, 0, 0, Math.PI*2); c.fill();
  // Keyboard
  box(c, wx-0.28, wz+0.05, wy+0.1, 0.56, 0.22, 0.02, "#1c2230","#101828","#0a1020", cx, cy, dep);
  // Mouse
  box(c, wx+0.38, wz+0.06, wy+0.1, 0.1, 0.14, 0.025, "#282e3a","#181c28","#0e1218", cx, cy, dep);
  // Pen cup
  box(c, wx+0.52, wz-0.46, wy+0.1, 0.16, 0.16, 0.18, "#9a7848","#7a5828","#5a4018", cx, cy, dep);
}

// Bookshelf (wall-mounted style)
function drawBookshelf(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number) {
  // Frame
  box(c, wx-0.06, wz-0.06, wy, 1.12, 0.28, 1.2, "#5a3818","#3a2008","#2a1408", cx, cy);
  // Books (varied colors)
  const bookColors = ["#c04040","#40a060","#4060c0","#c0a030","#c06040","#8040c0","#40a0c0"];
  for (let i=0; i<6; i++) {
    const bx2=wx+i*0.16-0.04;
    const bc=bookColors[i%bookColors.length]!;
    box(c, bx2, wz-0.02, wy+0.06, 0.13, 0.18, 1.0, lighter(bc,1.1), bc, darker(bc,0.72), cx, cy);
  }
  // Middle shelf
  box(c, wx-0.02, wz-0.02, wy+0.6, 1.04, 0.22, 0.04, "#7a4a28","#5a3218","#3a2010", cx, cy);
  // Lower row books
  for (let i=0; i<5; i++) {
    const bx2=wx+i*0.18;
    const bc=bookColors[(i+3)%bookColors.length]!;
    box(c, bx2, wz-0.02, wy+0.06, 0.15, 0.18, 0.46, lighter(bc,1.1), bc, darker(bc,0.72), cx, cy);
  }
}

// Potted plant (tropical)
function drawPlant(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number, size=1.0) {
  // Pot
  box(c, wx-0.22*size, wz-0.22*size, wy, 0.44*size, 0.44*size, 0.38*size, PAL.plantPot, "#5a3018","#3a1c08", cx, cy);
  // Soil
  box(c, wx-0.2*size, wz-0.2*size, wy+0.38*size, 0.4*size, 0.4*size, 0.04*size, "#2a1a08","#1a1008","#100a04", cx, cy);
  // Stem
  const sp = iso(wx, wz, wy+0.42*size, cx, cy);
  // Leaves (radiating blobs)
  for (let i=0; i<5; i++) {
    const ang = (i/5)*Math.PI*2;
    const lx = sp.x + Math.cos(ang)*16*size;
    const ly = sp.y + Math.sin(ang)*8*size - 12*size;
    c.beginPath(); c.ellipse(lx, ly, 11*size, 7*size, ang, 0, Math.PI*2);
    c.fillStyle = i%2===0 ? PAL.plantGreen : PAL.plantDark; c.fill();
    c.strokeStyle="rgba(0,0,0,0.2)"; c.lineWidth=0.5; c.stroke();
  }
  // Top leaf cluster
  c.beginPath(); c.arc(sp.x, sp.y-14*size, 10*size, 0, Math.PI*2);
  c.fillStyle=PAL.plantGreen; c.fill();
  c.strokeStyle="rgba(0,0,0,0.2)"; c.lineWidth=0.5; c.stroke();
}

// Whiteboard
function drawWhiteboard(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number) {
  // Stand legs
  box(c, wx-0.04, wz-0.02, wy, 0.08, 0.08, 0.5, "#4a4848","#303030","#202020", cx, cy);
  // Board frame
  box(c, wx-0.7, wz-0.06, wy+0.5, 1.4, 0.08, 0.85, "#e8e8e8","#d0d0d0","#b8b8b8", cx, cy);
  // Board surface
  box(c, wx-0.64, wz-0.03, wy+0.56, 1.28, 0.04, 0.72, "#f5f5f5","#e8e8e8","#d8d8d8", cx, cy);
  // Marker lines
  const wbp = iso(wx, wz-0.02, wy+0.82, cx, cy);
  c.strokeStyle="#2060e8"; c.lineWidth=1.2; c.lineCap="round";
  c.beginPath(); c.moveTo(wbp.x-22, wbp.y+4); c.lineTo(wbp.x+18, wbp.y-2); c.stroke();
  c.beginPath(); c.moveTo(wbp.x-22, wbp.y+12); c.lineTo(wbp.x+5, wbp.y+10); c.stroke();
  c.strokeStyle="#e04020";
  c.beginPath(); c.moveTo(wbp.x-16, wbp.y+22); c.lineTo(wbp.x+14, wbp.y+18); c.stroke();
  // Tray (eraser/pens)
  box(c, wx-0.5, wz-0.06, wy+0.5, 1.0, 0.07, 0.04, "#d8d0c8","#b8b0a8","#989090", cx, cy);
}

// Coffee machine
function drawCoffeeMachine(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number, time: number) {
  // Body
  box(c, wx-0.32, wz-0.28, wy, 0.64, 0.56, 0.86, "#2a3040","#1a2030","#0e1428", cx, cy);
  // Top panel
  box(c, wx-0.28, wz-0.24, wy+0.86, 0.56, 0.48, 0.08, "#3a4050","#2a3040","#1a2030", cx, cy);
  // Display (glowing amber)
  const dp = iso(wx, wz-0.26, wy+0.64, cx, cy);
  const dispG = Math.sin(time*2)*0.15+0.7;
  c.fillStyle=`rgba(220,160,40,${dispG})`; c.fillRect(dp.x-12, dp.y-5, 24, 10);
  c.strokeStyle="rgba(255,200,60,0.6)"; c.lineWidth=0.6; c.strokeRect(dp.x-12, dp.y-5, 24, 10);
  // Nozzle
  box(c, wx-0.06, wz-0.12, wy+0.26, 0.12, 0.12, 0.28, "#404858","#303848","#202838", cx, cy);
  // Cup tray
  box(c, wx-0.28, wz-0.24, wy+0.1, 0.56, 0.48, 0.04, "#303840","#202830","#101820", cx, cy);
  // Steam
  if (Math.sin(time*3)>0.2) {
    const np = iso(wx, wz-0.06, wy+0.54, cx, cy);
    c.strokeStyle=`rgba(200,210,220,0.5)`; c.lineWidth=1.2; c.lineCap="round";
    c.beginPath(); c.moveTo(np.x, np.y); c.quadraticCurveTo(np.x+4, np.y-7, np.x, np.y-14); c.stroke();
  }
  // Indicator light
  const lp = iso(wx+0.2, wz-0.27, wy+0.78, cx, cy);
  c.beginPath(); c.arc(lp.x, lp.y, 3, 0, Math.PI*2);
  c.fillStyle=`rgba(60,220,80,${0.7+Math.sin(time*1.5)*0.3})`; c.fill();
}

// Server rack
function drawServerRack(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number, time: number) {
  // Main frame
  box(c, wx-0.24, wz-0.24, wy, 0.48, 0.48, 1.1, "#1e2028","#141820","#0c1018", cx, cy, 0.3);
  // Server units (blinking lights)
  for (let i=0; i<5; i++) {
    const unitY = wy + 0.08 + i*0.18;
    box(c, wx-0.2, wz-0.2, unitY, 0.4, 0.4, 0.12, "#252830","#181c24","#0e1218", cx, cy, 0.2);
    // LED lights (different blink phases)
    const ledP = iso(wx+0.1, wz-0.22, unitY+0.08, cx, cy);
    const blink = Math.sin(time*3.5+i*1.3)>0.4;
    c.beginPath(); c.arc(ledP.x-6, ledP.y, 2, 0, Math.PI*2);
    c.fillStyle = blink ? "#40ff80" : "#0a4018"; c.fill();
    c.beginPath(); c.arc(ledP.x, ledP.y, 2, 0, Math.PI*2);
    c.fillStyle = Math.sin(time*2.8+i*0.9)>0.3 ? "#ffa020" : "#4a2008"; c.fill();
  }
  // Cable management (back)
  box(c, wx-0.18, wz+0.24, wy, 0.36, 0.04, 1.1, "#282030","#181428","#0e0c1e", cx, cy, 0.15);
}

// Sofa
function drawSofa(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, w: number, cx: number, cy: number) {
  // Body
  box(c, wx, wz, wy, w, 1.0, 0.38, PAL.sofaTop, PAL.sofaFront, PAL.sofaSide, cx, cy);
  // Back rest
  box(c, wx, wz, wy+0.38, w, 0.24, 0.5, lighter(PAL.sofaTop,0.9), lighter(PAL.sofaFront,0.9), lighter(PAL.sofaSide,0.9), cx, cy);
  // Left arm
  box(c, wx-0.14, wz-0.1, wy, 0.14, 1.2, 0.64, lighter(PAL.sofaTop,0.95), PAL.sofaFront, PAL.sofaSide, cx, cy);
  // Right arm
  box(c, wx+w, wz-0.1, wy, 0.14, 1.2, 0.64, lighter(PAL.sofaTop,0.95), PAL.sofaFront, PAL.sofaSide, cx, cy);
  // Cushion highlights
  for (let i=0; i<Math.floor(w/0.9); i++) {
    box(c, wx+i*0.9+0.08, wz+0.15, wy+0.02, 0.74, 0.7, 0.34, lighter(PAL.sofaTop,1.08), PAL.sofaFront, PAL.sofaSide, cx, cy, 0.1);
  }
}

// Reception desk (L-shaped)
function drawReceptionDesk(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number) {
  // Main counter
  box(c, wx, wz, wy, 3.0, 0.7, 0.7, PAL.deskTop, PAL.deskLeft, PAL.deskRight, cx, cy);
  // Wing
  box(c, wx+2.6, wz, wy, 0.7, 2.2, 0.7, PAL.deskTop, PAL.deskLeft, PAL.deskRight, cx, cy);
  // Counter top glass strip
  box(c, wx, wz-0.02, wy+0.7, 3.0, 0.06, 0.04, "rgba(200,230,255,0.4)","rgba(180,210,240,0.3)","rgba(160,190,220,0.2)", cx, cy, 0.1);
  // Monitor
  box(c, wx+0.8, wz+0.1, wy+0.7, 0.1, 0.08, 0.36, PAL.monFrame, PAL.monFrame, PAL.monFrame, cx, cy);
  box(c, wx+0.5, wz+0.05, wy+1.06, 0.7, 0.04, 0.44, "#0d1a2a","#081018","#040c12", cx, cy);
  // Phone
  box(c, wx+1.8, wz+0.08, wy+0.7, 0.28, 0.2, 0.06, "#2a3040","#1a2030","#0e1420", cx, cy);
  // Pen holder + papers
  box(c, wx+2.2, wz+0.04, wy+0.7, 0.16, 0.16, 0.2, "#d09858","#a07838","#7a5828", cx, cy);
}

// Water cooler
function drawWaterCooler(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number) {
  // Base
  box(c, wx-0.16, wz-0.16, wy, 0.32, 0.32, 0.5, "#2a3858","#1a2848","#0e1c38", cx, cy);
  // Bottle (blue translucent)
  const bp = iso(wx, wz, wy+0.5, cx, cy);
  c.beginPath(); c.ellipse(bp.x, bp.y, 10, 5, 0, 0, Math.PI*2);
  c.fillStyle="rgba(100,160,220,0.8)"; c.fill();
  c.strokeStyle="rgba(60,120,200,0.6)"; c.lineWidth=0.7; c.stroke();
  c.beginPath(); c.ellipse(bp.x, bp.y-18, 8, 4, 0, 0, Math.PI*2);
  c.fillStyle="rgba(120,180,240,0.7)"; c.fill();
  // Tap nozzles
  box(c, wx-0.1, wz-0.18, wy+0.26, 0.08, 0.08, 0.1, "#c04040","#902828","#6a1818", cx, cy);
  box(c, wx+0.04, wz-0.18, wy+0.26, 0.08, 0.08, 0.1, "#4080c0","#286090","#184870", cx, cy);
}

// Printer
function drawPrinter(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number) {
  box(c, wx-0.3, wz-0.24, wy, 0.6, 0.48, 0.42, "#d8d4cc","#b8b4ac","#989090", cx, cy);
  // Paper slot
  box(c, wx-0.22, wz-0.26, wy+0.3, 0.44, 0.06, 0.04, "#f0ede8","#d8d4d0","#c0bcb8", cx, cy);
  // Display
  const dp=iso(wx+0.12, wz-0.26, wy+0.26, cx, cy);
  c.fillStyle="#2060a0"; c.fillRect(dp.x-10, dp.y-4, 20, 8);
  // Status light
  c.beginPath(); c.arc(dp.x+16, dp.y-2, 2.5, 0, Math.PI*2);
  c.fillStyle="#40e040"; c.fill();
}

// Floor lamp
function drawLamp(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number, time: number) {
  // Pole
  box(c, wx-0.04, wz-0.04, wy, 0.08, 0.08, 0.9, "#4a4040","#302828","#201c1c", cx, cy);
  // Shade
  const sp2 = iso(wx, wz, wy+0.9, cx, cy);
  c.beginPath(); c.moveTo(sp2.x-16, sp2.y+4); c.lineTo(sp2.x+16, sp2.y); c.lineTo(sp2.x+8, sp2.y-14); c.lineTo(sp2.x-8, sp2.y-12); c.closePath();
  c.fillStyle="#d4a830"; c.fill();
  c.strokeStyle="rgba(0,0,0,0.3)"; c.lineWidth=0.7; c.stroke();
  // Glow
  const glow = 0.25+Math.sin(time*0.8)*0.05;
  const gl = c.createRadialGradient(sp2.x, sp2.y, 0, sp2.x, sp2.y, 40);
  gl.addColorStop(0, `rgba(255,220,120,${glow})`); gl.addColorStop(1, "transparent");
  c.fillStyle=gl; c.beginPath(); c.ellipse(sp2.x, sp2.y+10, 40, 20, 0, 0, Math.PI*2); c.fill();
}

// Filing cabinet
function drawFilingCabinet(c: CanvasRenderingContext2D, wx: number, wz: number, wy: 0|1, cx: number, cy: number) {
  box(c, wx-0.2, wz-0.2, wy, 0.4, 0.4, 0.84, "#8090a0","#606878","#485058", cx, cy);
  for (let i=0; i<3; i++) {
    box(c, wx-0.18, wz-0.22, wy+0.06+i*0.24, 0.36, 0.06, 0.2, "#909eae","#707888","#586068", cx, cy);
    // Drawer handle
    const hp=iso(wx, wz-0.22, wy+0.12+i*0.24, cx, cy);
    c.fillStyle="#c8ccd8"; c.fillRect(hp.x-6, hp.y-2, 12, 3);
  }
}

// Elevator
function drawElevator(c: CanvasRenderingContext2D, elv: ElevatorSim, time: number, cx: number, cy: number) {
  const ex=ELV_X, ez=ELV_Z;
  // Shaft
  box(c, ex-0.58, ez-0.58, 0, 1.16, 1.16, 0.25, "#1a2234","#101828","#080e1e", cx, cy);
  box(c, ex-0.52, ez-0.52, 0.25, 1.04, 1.04, 3.5, "#111928","#0a1220","#060c16", cx, cy);
  // Guide rails
  for (let ry=0.3; ry<3.7; ry+=0.6) {
    const rp=iso(ex+0.46, ez-0.5, ry, cx, cy);
    c.beginPath(); c.arc(rp.x, rp.y, 3, 0, Math.PI*2);
    c.fillStyle="#2a3d52"; c.fill();
  }
  // Car body
  const carY=elv.carY*3.0;
  box(c, ex-0.44, ez-0.44, carY+0.25, 0.88, 0.88, 0.72, "#7a8fa8","#5a6f88","#3a4f68", cx, cy);
  // Interior
  box(c, ex-0.38, ez-0.38, carY+0.25, 0.76, 0.76, 0.68, "#0e1a28","#091220","#060c18", cx, cy);
  // Ceiling light
  const litP=iso(ex, ez-0.1, carY+0.93, cx, cy);
  const lit = elv.door>0.4 ? 0.8+Math.sin(time*6)*0.08 : 0.25;
  c.fillStyle=`rgba(200,225,255,${lit})`; c.beginPath(); c.ellipse(litP.x, litP.y, 8, 4, 0, 0, Math.PI*2); c.fill();
  const litG=c.createRadialGradient(litP.x, litP.y, 0, litP.x, litP.y, 30);
  litG.addColorStop(0, `rgba(200,225,255,${lit*0.4})`); litG.addColorStop(1, "transparent");
  c.fillStyle=litG; c.beginPath(); c.ellipse(litP.x, litP.y, 30, 18, 0, 0, Math.PI*2); c.fill();
  // Doors
  const dw=0.44*(1-elv.door);
  if (dw>0.02) {
    box(c, ex-0.44, ez-0.44, carY+0.25, dw, 0.06, 0.72, "#2a4a70","#1a3a60","#0e2a50", cx, cy);
    box(c, ex-0.44+0.88-dw, ez-0.44, carY+0.25, dw, 0.06, 0.72, "#2a4a70","#1a3a60","#0e2a50", cx, cy);
  }
  // Floor indicator panel
  const indP=iso(ex+0.52, ez-0.58, 2.9, cx, cy);
  c.fillStyle="#0a1422"; c.beginPath(); c.roundRect(indP.x-16, indP.y-10, 32, 20, 4); c.fill();
  c.strokeStyle="#2a4a6a"; c.lineWidth=1; c.stroke();
  c.fillStyle=elv.moveState==="moving"?"#e8c040":"#50c880";
  c.font="bold 9px monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText(elv.carY>0.5?"▲ 2F":"▼ 1F", indP.x, indP.y);
  // Queue indicator
  if (elv.queue.length>0) {
    const qp=iso(ex+0.55, ez-0.62, 3.6, cx, cy);
    c.fillStyle="#e8b020"; c.beginPath(); c.arc(qp.x, qp.y, 9, 0, Math.PI*2); c.fill();
    c.fillStyle="#fff"; c.font="bold 9px monospace"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText(String(elv.queue.length), qp.x, qp.y);
  }
}

// Meeting room (large)
function drawMeetingRoom(c: CanvasRenderingContext2D, hasMeeting: boolean, time: number, cx: number, cy: number) {
  const wy=0;
  // Big oval table
  box(c, MEET_CX-1.6, MEET_CZ-1.9, wy, 3.2, 3.8, 0.1, PAL.tableTop, PAL.tableLeft, PAL.tableRight, cx, cy);
  // Table legs
  for (const [dx,dz] of [[-1.3,-1.5],[-1.3,1.7],[1.3,-1.5],[1.3,1.7]]) {
    box(c, MEET_CX+dx, MEET_CZ+dz, wy, 0.12, 0.12, 0.3, "#5a3818","#3a2008","#2a1408", cx, cy);
  }
  // Laptops/notebooks around table
  for (let i=0; i<8; i++) {
    const ang=(i/8)*Math.PI*2;
    const tx=MEET_CX+Math.cos(ang)*1.3, tz=MEET_CZ+Math.sin(ang)*1.6;
    box(c, tx-0.18, tz-0.14, wy+0.1, 0.36, 0.28, 0.02, "#1a2230","#101828","#0a1020", cx, cy);
  }
  // Water jug
  box(c, MEET_CX-0.12, MEET_CZ-0.14, wy+0.1, 0.24, 0.28, 0.28, "rgba(120,180,240,0.7)","rgba(80,140,200,0.6)","rgba(60,110,180,0.6)", cx, cy, 0.12);
  // Projector screen (mounted on wall)
  box(c, 1.1, MEET_CZ-2.0, wy+0.6, 0.08, 2.8, 1.4, "#f5f5f5","#e0e0e0","#d0d0d0", cx, cy);
  // Projector beam
  if (hasMeeting) {
    const pp=iso(MEET_CX+2, MEET_CZ-0.5, wy+1.2, cx, cy);
    const sp2=iso(1.1, MEET_CZ+0.4, wy+1.1, cx, cy);
    const beamG=c.createLinearGradient(pp.x, pp.y, sp2.x, sp2.y);
    beamG.addColorStop(0,`rgba(255,255,200,${0.25+Math.sin(time)*0.1})`);
    beamG.addColorStop(1,"rgba(255,255,200,0)");
    c.fillStyle=beamG;
    c.beginPath(); c.moveTo(pp.x, pp.y); c.lineTo(pp.x+8, pp.y-4); c.lineTo(sp2.x+20, sp2.y+8); c.lineTo(sp2.x+20, sp2.y-8); c.closePath(); c.fill();
    // Projector body
    box(c, MEET_CX+1.8, MEET_CZ-0.6, wy+1.0, 0.4, 0.2, 0.18, "#303848","#202838","#101828", cx, cy);
    // Meeting badge
    const gp=iso(MEET_CX, MEET_CZ, wy+0.5, cx, cy);
    c.fillStyle="rgba(0,188,212,0.25)";
    c.beginPath(); c.ellipse(gp.x, gp.y, 100, 50, 0, 0, Math.PI*2); c.fill();
    c.fillStyle="rgba(10,14,28,0.9)"; c.strokeStyle="rgba(0,188,212,0.7)"; c.lineWidth=1;
    c.beginPath(); c.roundRect(gp.x-80, gp.y-12, 160, 22, 5); c.fill(); c.stroke();
    c.fillStyle="#00d4ef"; c.font="bold 8.5px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText("🤝  MEETING IN PROGRESS", gp.x, gp.y-1);
  }
}

// Break room props
function drawBreakRoom(c: CanvasRenderingContext2D, time: number, cx: number, cy: number) {
  const wy=0;
  // Sofa
  drawSofa(c, 1.5, 11.5, wy, 2.8, cx, cy);
  // Coffee table
  box(c, 2.5, 12.7, wy, 1.3, 0.9, 0.12, PAL.tableTop, PAL.tableLeft, PAL.tableRight, cx, cy);
  // Items on coffee table
  box(c, 2.7, 12.9, wy+0.12, 0.2, 0.2, 0.14, "#c47840","#a06028","#7a4418", cx, cy); // mug
  box(c, 3.1, 12.9, wy+0.12, 0.28, 0.22, 0.04, "#d0d4da","#b0b4ba","#909498", cx, cy); // book
  // Coffee machine
  drawCoffeeMachine(c, 1.4, 14.5, wy, cx, cy, time);
  // Plants
  drawPlant(c, 5.8, 11.2, wy, cx, cy, 1.1);
  drawPlant(c, 8.5, 14.0, wy, cx, cy, 0.85);
  // Bean bags (big colored circles)
  const bg=iso(7.0, 12.5, wy, cx, cy);
  c.beginPath(); c.ellipse(bg.x, bg.y, 22, 12, 0, 0, Math.PI*2);
  c.fillStyle="#c44040"; c.fill(); c.strokeStyle="rgba(0,0,0,0.2)"; c.lineWidth=0.8; c.stroke();
  c.beginPath(); c.ellipse(bg.x-2, bg.y-4, 17, 9, -0.2, 0, Math.PI*2);
  c.fillStyle="#e05050"; c.fill();
  const bg2=iso(8.2, 13.2, wy, cx, cy);
  c.beginPath(); c.ellipse(bg2.x, bg2.y, 20, 10, 0, 0, Math.PI*2);
  c.fillStyle="#4060c8"; c.fill(); c.strokeStyle="rgba(0,0,0,0.2)"; c.stroke();
  c.beginPath(); c.ellipse(bg2.x-2, bg2.y-3, 15, 8, -0.2, 0, Math.PI*2);
  c.fillStyle="#5070e0"; c.fill();
  // Foosball table
  box(c, 6.2, 12.0, wy, 1.6, 0.8, 0.24, "#28c060","#18a048","#0e7830", cx, cy);
  box(c, 6.0, 11.85, wy, 2.0, 1.1, 0.06, "#3a3028","#282018","#1a1408", cx, cy);
  // Fridge
  box(c, 9.0, 13.8, wy, 0.7, 0.5, 1.1, "#c8d0d8","#a8b0b8","#88909a", cx, cy);
  box(c, 9.04, 13.84, wy+0.55, 0.62, 0.42, 0.5, "#b8c0c8","#98a0a8","#78808a", cx, cy);
  const fh=iso(9.34, 13.84, wy+0.78, cx, cy);
  c.fillStyle="#909498"; c.fillRect(fh.x-8, fh.y-2, 16, 3);
}

// Server room
function drawServerRoom(c: CanvasRenderingContext2D, time: number, cx: number, cy: number) {
  const wy=0;
  // Server racks in rows
  for (let row=0; row<3; row++) {
    for (let col=0; col<4; col++) {
      drawServerRack(c, 12+col*1.2, 9.5+row*2.5, wy, cx, cy, time+col*0.7+row*1.3);
    }
  }
  // Cooling unit (large)
  box(c, 20.0, 9.0, wy, 1.4, 1.0, 1.0, "#3a4858","#2a3848","#1a2838", cx, cy);
  // Cooling fan circles
  const cp=iso(20.7, 9.0, wy+0.7, cx, cy);
  c.strokeStyle=`rgba(80,160,220,${0.5+Math.sin(time*8)*0.3})`; c.lineWidth=1.5;
  c.beginPath(); c.arc(cp.x, cp.y, 8, 0, Math.PI*2); c.stroke();
  c.strokeStyle=`rgba(80,160,220,${0.3+Math.sin(time*8+1)*0.2})`;
  c.beginPath(); c.arc(cp.x, cp.y, 14, 0, Math.PI*2); c.stroke();
  // Floor tiles (raised/grid)
  for (let tx=11; tx<22; tx++) for (let tz=9; tz<16; tz++) {
    tile(c, tx, tz, wy, (tx+tz)%2===0 ? "#3a4048" : "#2e3438", cx, cy);
  }
  // Network switches on wall
  box(c, 11.1, 9.1, wy+0.5, 0.1, 1.4, 0.4, "#2a3848","#1a2838","#0e1c28", cx, cy);
  // Patch panel
  const pp=iso(11.1, 9.8, wy+0.7, cx, cy);
  for (let i=0; i<8; i++) {
    const pOn=Math.sin(time*4+i*0.6)>0;
    c.beginPath(); c.arc(pp.x+(i-4)*5, pp.y, 2, 0, Math.PI*2);
    c.fillStyle=pOn?"#40ff80":"#104018"; c.fill();
  }
}

// Lobby
function drawLobby(c: CanvasRenderingContext2D, time: number, cx: number, cy: number) {
  const wy=0;
  // Reception desk
  drawReceptionDesk(c, 12, 2, wy, cx, cy);
  // Waiting area chairs
  for (let i=0; i<3; i++) {
    box(c, 12.8+i*1.1, 5.5, wy, 0.9, 0.9, 0.1, PAL.chairSeat, PAL.chairBack, PAL.chairSide, cx, cy);
    box(c, 12.5+i*1.1, 5.5, wy+0.1, 0.2, 0.9, 0.42, PAL.chairBack, PAL.chairSide, PAL.chairSide, cx, cy);
  }
  // Indoor fountain
  const fp=iso(15.5, 4.5, wy, cx, cy);
  c.beginPath(); c.ellipse(fp.x, fp.y, 28, 14, 0, 0, Math.PI*2);
  c.fillStyle="rgba(40,100,200,0.5)"; c.fill();
  c.strokeStyle="rgba(80,160,240,0.8)"; c.lineWidth=1; c.stroke();
  box(c, 15.1, 4.1, wy, 0.8, 0.8, 0.24, "#6080a0","#405080","#283060", cx, cy);
  // Fountain water effect
  const fps=iso(15.5, 4.5, wy+0.28, cx, cy);
  const fw=0.4+Math.sin(time*4)*0.15;
  const fwg=c.createRadialGradient(fps.x, fps.y, 0, fps.x, fps.y, 18);
  fwg.addColorStop(0, `rgba(120,190,255,${fw})`); fwg.addColorStop(1,"transparent");
  c.fillStyle=fwg; c.beginPath(); c.arc(fps.x, fps.y, 18, 0, Math.PI*2); c.fill();
  // Welcome sign
  const ws=iso(18.5, 2.0, wy+0.4, cx, cy);
  c.fillStyle="rgba(8,12,24,0.92)"; c.strokeStyle="rgba(255,160,40,0.8)"; c.lineWidth=1.2;
  c.beginPath(); c.roundRect(ws.x-60, ws.y-12, 120, 24, 6); c.fill(); c.stroke();
  c.fillStyle="#ffb830"; c.font="bold 9px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
  c.fillText("✦ DLavie OS HQ ✦", ws.x, ws.y);
  // Plants at lobby entrance
  drawPlant(c, 18.0, 1.5, wy, cx, cy, 1.2);
  drawPlant(c, 18.0, 7.5, wy, cx, cy, 1.2);
  // Logo on wall
  box(c, 11.1, 1.0, wy+0.55, 0.08, 1.2, 0.8, "#1a2848","#0a1838","#060e28", cx, cy);
}

// ═══════════════════════════════════════════════════════════════════════
//  CROSS-SECTION WALLS  (the hotel game "cut" look)
// ═══════════════════════════════════════════════════════════════════════

function drawCrossSectionWalls(c: CanvasRenderingContext2D, cx: number, cy: number) {
  // Left structural wall (NW boundary, runs along wz=0 from x=0 to x=22)
  for (let wx=0; wx<22; wx++) {
    // Ground floor left wall strip
    box(c, wx, 0, 0, 1, 0.38, 0.98, PAL.strip0, darker(PAL.strip0,0.78), darker(PAL.strip0,0.6), cx, cy, 0.25);
    // Upper floor left wall strip (different color to distinguish)
    box(c, wx, 0, 1, 1, 0.38, 0.98, PAL.strip1, darker(PAL.strip1,0.78), darker(PAL.strip1,0.6), cx, cy, 0.25);
    // Floor slab between levels
    box(c, wx, 0, 0.95, 1, 0.38, 0.1, "#8a7c6a","#6a5c4a","#4a3c2a", cx, cy, 0.25);
  }
  // Back structural wall (NE boundary)
  for (let wz=0; wz<16; wz++) {
    box(c, 0, wz, 0, 0.38, 1, 0.98, PAL.strip0, darker(PAL.strip0,0.78), darker(PAL.strip0,0.6), cx, cy, 0.25);
    box(c, 0, wz, 1, 0.38, 1, 0.98, PAL.strip1, darker(PAL.strip1,0.78), darker(PAL.strip1,0.6), cx, cy, 0.25);
    box(c, 0, wz, 0.95, 0.38, 1, 0.1, "#8a7c6a","#6a5c4a","#4a3c2a", cx, cy, 0.25);
  }
  // Floor slab visible edge (top of ground floor / bottom of upper floor)
  for (let wx=0; wx<22; wx++) for (let wz=0; wz<16; wz++) {
    tile(c, wx, wz, 0.98, `rgba(80,60,40,0.12)`, cx, cy);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  FLOOR RENDERING
// ═══════════════════════════════════════════════════════════════════════

function renderFloor(c: CanvasRenderingContext2D, wy: 0|1,
                     zones: typeof ZONES_F0 | typeof ZONES_F1,
                     cx: number, cy: number) {
  // Base checkerboard tiles
  for (let wx=0; wx<22; wx++) for (let wz=0; wz<16; wz++) {
    tile(c, wx, wz, wy, (wx+wz)%2===0 ? PAL.floorA : PAL.floorB, cx, cy);
  }

  // Zone carpets (vibrant colored areas)
  for (const z of zones) {
    const [r,g,b] = hexToRGB(z.carpet);
    for (let wx=z.x; wx<z.x+z.w; wx++) {
      for (let wz=z.z; wz<z.z+z.d; wz++) {
        // Carpet tiles (solid color, slight checkerboard texture)
        const shade = (wx+wz)%2===0 ? 1.0 : 0.94;
        tile(c, wx, wz, wy, `rgba(${(r*shade)|0},${(g*shade)|0},${(b*shade)|0},0.58)`, cx, cy);
      }
    }
    // Zone border (darker outline)
    const borderColor = `rgba(${(r*0.6)|0},${(g*0.6)|0},${(b*0.6)|0},0.65)`;
    for (let wx=z.x; wx<z.x+z.w; wx++) {
      tile(c, wx, z.z, wy, borderColor, cx, cy);
      tile(c, wx, z.z+z.d-1, wy, borderColor, cx, cy);
    }
    for (let wz=z.z; wz<z.z+z.d; wz++) {
      tile(c, z.x, wz, wy, borderColor, cx, cy);
      tile(c, z.x+z.w-1, wz, wy, borderColor, cx, cy);
    }
    // Zone label
    const lp=iso(z.x+z.w/2, z.z+z.d/2, wy+0.01, cx, cy);
    const [lr,lg,lb]=hexToRGB(z.carpet);
    c.fillStyle=`rgba(${(lr*1.3)|0},${(lg*1.3)|0},${(lb*1.3)|0},0.85)`;
    c.font="bold 7px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText(z.name.toUpperCase(), lp.x, lp.y+5);
  }

  // Floor divider baseboard
  const boardH = 0.12;
  for (let wx=0; wx<22; wx++) {
    box(c, wx, 0, wy, 1, 0.04, boardH, "#a09080","#806860","#604840", cx, cy, 0.1);
    box(c, wx, 15.96, wy, 1, 0.04, boardH, "#a09080","#806860","#604840", cx, cy, 0.1);
  }
  for (let wz=0; wz<16; wz++) {
    box(c, 0, wz, wy, 0.04, 1, boardH, "#a09080","#806860","#604840", cx, cy, 0.1);
    box(c, 21.96, wz, wy, 0.04, 1, boardH, "#a09080","#806860","#604840", cx, cy, 0.1);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  UPPER FLOOR PROPS (Floor 1 — offices)
// ═══════════════════════════════════════════════════════════════════════

function drawOfficeProps(c: CanvasRenderingContext2D, time: number, cx: number, cy: number) {
  // All agent desks
  for (const d of AGENT_DEFS) {
    const app = APPEARANCES[d.id] ?? { skin:"#f0d0b0", hair:"#2a1808", shirt:"#4060a0", pants:"#1a2040" };
    drawDesk(c, d.deskX, d.deskZ, app.shirt, cx, cy);
  }
  // Whiteboards
  drawWhiteboard(c, 8.2, 2.5, 1, cx, cy);
  drawWhiteboard(c, 12.5, 14.5, 1, cx, cy);
  // Bookshelves along left wall
  drawBookshelf(c, 1.0, 13.5, 1, cx, cy);
  drawBookshelf(c, 1.0, 10.5, 1, cx, cy);
  // Plants scattered through office
  drawPlant(c, 8.2, 1.5, 1, cx, cy, 0.85);
  drawPlant(c, 10.5, 13.5, 1, cx, cy, 0.9);
  drawPlant(c, 19.8, 1.5, 1, cx, cy, 1.0);
  drawPlant(c, 19.8, 5.5, 1, cx, cy, 0.9);
  drawPlant(c, 19.8, 9.5, 1, cx, cy, 1.0);
  // Printer area
  drawPrinter(c, 20.2, 12.5, 1, cx, cy);
  // Water cooler
  drawWaterCooler(c, 20.5, 3.0, 1, cx, cy);
  // Lamps
  drawLamp(c, 9.0, 14.5, 1, cx, cy, time);
  drawLamp(c, 21.0, 14.5, 1, cx, cy, time+1.3);
  // Filing cabinets
  drawFilingCabinet(c, 20.0, 14.0, 1, cx, cy);
  drawFilingCabinet(c, 20.8, 14.0, 1, cx, cy);
  // Lounge sofa area
  drawSofa(c, 19.2, 2.0, 1, 1.8, cx, cy);
  // Lounge coffee table
  box(c, 19.5, 3.3, 1, 1.2, 0.8, 0.1, PAL.tableTop, PAL.tableLeft, PAL.tableRight, cx, cy);
  // Lounge plant
  drawPlant(c, 20.8, 1.5, 1, cx, cy, 0.8);
}

// ═══════════════════════════════════════════════════════════════════════
//  SIMULATION
// ═══════════════════════════════════════════════════════════════════════

function makeAgents(): Map<string, AgentSim> {
  const m = new Map<string, AgentSim>();
  for (const d of AGENT_DEFS) {
    const appear = APPEARANCES[d.id] ?? { skin:"#f0d0b0", hair:"#2a1808", shirt:"#4060a0", pants:"#1a2040" };
    m.set(d.id, {
      id:d.id, name:d.name, emoji:d.emoji, color:d.color, appear,
      x:d.deskX+(Math.random()-0.5)*0.3, z:d.deskZ+(Math.random()-0.5)*0.3, floor:1,
      tx:d.deskX, tz:d.deskZ, tfloor:1,
      deskX:d.deskX, deskZ:d.deskZ, seatIdx:-1,
      phase:Math.random()*Math.PI*2, walkPhase:Math.random()*Math.PI*2,
      macro:"at_desk", activity:"typing",
      actTimer:Math.floor(Math.random()*180+40), stTimer:0,
      chatPartner:null, bubble:null, bubbleTimer:0,
    });
  }
  return m;
}

function pickActivity(ag: AgentSim, agents: Map<string, AgentSim>, macro: Macro) {
  const r = Math.random();
  if (macro === "at_desk") {
    if      (r<0.38) { ag.activity="typing";     ag.actTimer=100+Math.random()*160; }
    else if (r<0.50) { ag.activity="drinking";   ag.actTimer=40+Math.random()*50; }
    else if (r<0.60) { ag.activity="idle";        ag.actTimer=30+Math.random()*60; }
    else if (r<0.68) { ag.activity="stretching"; ag.actTimer=45; }
    else if (r<0.76) { ag.activity="phone";       ag.actTimer=50+Math.random()*80; }
    else if (r<0.85) {
      ag.activity="chatting"; ag.actTimer=60+Math.random()*80;
      const near=[...agents.values()].filter(a=>a.id!==ag.id&&a.macro==="at_desk"&&Math.abs(a.deskX-ag.deskX)<5&&Math.abs(a.deskZ-ag.deskZ)<5);
      ag.chatPartner=near[0]?.id??null;
    }
    else if (r<0.93) { ag.activity="drowsy";     ag.actTimer=60; }
    else             { ag.activity="sleeping";   ag.actTimer=90; }
  } else if (macro === "in_meeting") {
    if      (r<0.36) { ag.activity="nodding";    ag.actTimer=50+Math.random()*80; }
    else if (r<0.54) {
      ag.activity="chatting"; ag.actTimer=50+Math.random()*70;
      ag.bubble=CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]!; ag.bubbleTimer=90;
    }
    else if (r<0.70) { ag.activity="presenting"; ag.actTimer=50; }
    else if (r<0.85) { ag.activity="typing";     ag.actTimer=40+Math.random()*60; }
    else             { ag.activity="idle";        ag.actTimer=30+Math.random()*50; }
  }
}

function tickSim(agents: Map<string, AgentSim>, elv: ElevatorSim, meetingSet: Set<string>) {
  // ─ Elevator ─────────────────────────────────────────────────────────
  elv.timer = Math.max(0, elv.timer - 1);

  if (elv.moveState === "idle") {
    const onFloor = elv.queue.filter(q => { const a=agents.get(q.agentId); return a&&a.floor===elv.floor&&a.macro==="queuing"; });
    if (onFloor.length > 0 && elv.timer === 0) { elv.moveState="loading"; elv.doorState="opening"; elv.timer=40; }
  }

  if (elv.moveState === "loading") {
    if (elv.doorState === "opening") { elv.door=Math.min(1,elv.door+0.06); if(elv.door>=1) elv.doorState="open"; }
    if (elv.doorState === "open" && elv.timer === 0) {
      const toBoard = elv.queue.filter(q=>{ const a=agents.get(q.agentId); return a&&a.floor===elv.floor&&a.macro==="queuing"; }).slice(0,ELV_CAP-elv.passengers.length);
      for (const qe of toBoard) {
        const a=agents.get(qe.agentId); if(!a) continue;
        elv.passengers.push(qe.agentId); elv.queue=elv.queue.filter(q=>q.agentId!==qe.agentId);
        a.macro="in_elevator"; a.activity="waiting"; a.x=ELV_X; a.z=ELV_Z;
      }
      elv.target=elv.floor===1?0:1; elv.moveState="moving"; elv.doorState="closing";
    }
  }
  if (elv.doorState === "closing") { elv.door=Math.max(0,elv.door-0.08); if(elv.door<=0) elv.doorState="closed"; }

  if (elv.moveState === "moving") {
    const diff = elv.target - elv.carY;
    if (Math.abs(diff) < 0.015) {
      elv.carY=elv.target; elv.floor=elv.target;
      elv.moveState="unloading"; elv.doorState="opening"; elv.timer=50;
      for (const pid of elv.passengers) { const a=agents.get(pid); if(a){ a.floor=elv.target; a.x=ELV_X; a.z=ELV_Z; } }
    } else {
      elv.carY += Math.sign(diff)*0.016;
      for (const pid of elv.passengers) { const a=agents.get(pid); if(a){ a.x=ELV_X; a.z=ELV_Z; a.floor=elv.carY>0.5?1:0; } }
    }
  }

  if (elv.moveState === "unloading") {
    if (elv.doorState==="opening"){ elv.door=Math.min(1,elv.door+0.06); if(elv.door>=1) elv.doorState="open"; }
    if (elv.doorState==="open" && elv.timer===0) {
      for (const pid of [...elv.passengers]) {
        const a=agents.get(pid); if(!a) continue;
        a.floor=elv.floor;
        if (elv.floor===0) {
          const s=Q_SPOTS_F0[elv.passengers.indexOf(pid)%Q_SPOTS_F0.length]!;
          a.tx=s[0]; a.tz=s[1]; a.tfloor=0; a.macro="walk_from_elv";
        } else {
          a.tx=a.deskX; a.tz=a.deskZ; a.tfloor=1; a.macro="walk_to_desk";
        }
      }
      elv.passengers=[]; elv.moveState="idle"; elv.doorState="closing"; elv.timer=20;
    }
  }

  // ─ Agents ──────────────────────────────────────────────────────────
  for (const ag of agents.values()) {
    ag.phase += 0.04;
    const moving = Math.hypot(ag.tx-ag.x, ag.tz-ag.z)>0.1 && ag.floor===ag.tfloor;
    if (moving) {
      const dx=ag.tx-ag.x, dz=ag.tz-ag.z, dist=Math.hypot(dx,dz);
      const step=Math.min(AGENT_SPD, dist);
      ag.x+=(dx/dist)*step; ag.z+=(dz/dist)*step;
      ag.walkPhase+=0.2; ag.activity="walking";
    }
    ag.actTimer = Math.max(0, ag.actTimer-1);
    if (ag.actTimer===0 && (ag.macro==="at_desk"||ag.macro==="in_meeting")) pickActivity(ag,agents,ag.macro);
    if (ag.bubbleTimer>0){ ag.bubbleTimer--; if(ag.bubbleTimer===0) ag.bubble=null; }
    if (ag.activity==="chatting"&&Math.random()<0.007){
      ag.bubble=CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)]!; ag.bubbleTimer=100;
    }

    switch (ag.macro) {
      case "at_desk": {
        ag.tx=ag.deskX; ag.tz=ag.deskZ; ag.tfloor=1;
        if (!moving){ ag.x=ag.deskX; ag.z=ag.deskZ; }
        if (meetingSet.has(ag.id) && ag.seatIdx===-1) {
          const used=new Set([...agents.values()].map(a=>a.seatIdx).filter(s=>s>=0));
          const seat=MEETING_SEATS.findIndex((_,i)=>!used.has(i));
          if (seat>=0) {
            ag.seatIdx=seat;
            const usedQ=new Set([...agents.values()].filter(a=>(a.macro==="walk_to_elv"||a.macro==="queuing")&&a.floor===1).map(a=>`${a.tx},${a.tz}`));
            const sp=Q_SPOTS_F1.find(([sx,sz])=>!usedQ.has(`${sx},${sz}`));
            ag.tx=sp?.[0]??ELV_X-1; ag.tz=sp?.[1]??ELV_Z; ag.tfloor=1; ag.macro="walk_to_elv";
          }
        }
        break;
      }
      case "walk_to_elv": {
        if (!moving&&ag.floor===1){ ag.macro="queuing"; ag.x=ag.tx; ag.z=ag.tz; if(!elv.queue.find(q=>q.agentId===ag.id)) elv.queue.push({agentId:ag.id,dest:0}); }
        break;
      }
      case "queuing": ag.activity="waiting"; break;
      case "in_elevator": ag.activity="waiting"; break;
      case "walk_from_elv": {
        if (!moving&&ag.floor===0){
          if(ag.seatIdx>=0){ const s=MEETING_SEATS[ag.seatIdx]!; ag.tx=s[0]; ag.tz=s[1]; ag.tfloor=0; ag.macro="walk_to_meeting"; }
          else ag.macro="walk_to_desk";
        }
        break;
      }
      case "walk_to_meeting": {
        if (!moving&&ag.floor===0){ ag.macro="in_meeting"; ag.activity="nodding"; ag.x=ag.tx; ag.z=ag.tz; ag.actTimer=60; }
        break;
      }
      case "in_meeting": {
        if (!meetingSet.has(ag.id)) {
          ag.seatIdx=-1; ag.macro="walk_to_elv_return";
          const usedQ=new Set([...agents.values()].filter(a=>(a.macro==="walk_to_elv_return"||a.macro==="queuing_return")&&a.floor===0).map(a=>`${a.tx},${a.tz}`));
          const sp=Q_SPOTS_F0.find(([sx,sz])=>!usedQ.has(`${sx},${sz}`));
          ag.tx=sp?.[0]??ELV_X+1; ag.tz=sp?.[1]??ELV_Z; ag.tfloor=0;
        }
        break;
      }
      case "walk_to_elv_return": {
        if (!moving&&ag.floor===0){ ag.macro="queuing_return"; ag.x=ag.tx; ag.z=ag.tz; if(!elv.queue.find(q=>q.agentId===ag.id)) elv.queue.push({agentId:ag.id,dest:1}); }
        break;
      }
      case "queuing_return": ag.activity="waiting"; break;
      case "in_elevator_return": ag.activity="waiting"; break;
      case "walk_to_desk": {
        if (!moving&&ag.floor===1){ ag.macro="at_desk"; ag.activity="idle"; ag.actTimer=30; ag.x=ag.deskX; ag.z=ag.deskZ; }
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export function OfficeRealistic({
  agentStatuses, selectedAgent, onSelectAgent,
  activeThreads=[], agentEmotions=new Map(),
}: OfficeRealisticProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef(makeAgents());
  const elvRef    = useRef<ElevatorSim>({ floor:1, carY:1, target:1, door:0, doorState:"closed", moveState:"idle", timer:0, passengers:[], queue:[] });
  const timeRef   = useRef(0);
  const tickRef   = useRef(0);
  const statusMap = useRef(new Map<string, string>());
  const propsRef  = useRef({ activeThreads, agentEmotions, agentStatuses, selectedAgent, onSelectAgent });
  propsRef.current = { activeThreads, agentEmotions, agentStatuses, selectedAgent, onSelectAgent };
  const cam = useRef({ zoom:1.0, panX:0, panY:0, drag:false, lx:0, ly:0, pinchDist:0 });
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
    return () => clearInterval(id);
  }, []);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let running = true;

    function render() {
      if (!running) return;
      const c = canvas!.getContext("2d"); if (!c){ requestAnimationFrame(render); return; }
      const W=canvas!.width, H=canvas!.height;
      timeRef.current += 0.016;
      const time = timeRef.current;

      // ── Background
      c.fillStyle = PAL.sky; c.fillRect(0,0,W,H);
      // Subtle gradient sky
      const skyG = c.createLinearGradient(0,0,0,H);
      skyG.addColorStop(0, "#2a2248"); skyG.addColorStop(1, PAL.sky);
      c.fillStyle=skyG; c.fillRect(0,0,W,H);

      // ── Camera transform
      const CX0 = W*0.5 - TW2*2;
      const CY0 = H*0.5 - (36*TH2 + 1.6*TH2 - FLOOR_H)*0.5;
      c.save();
      c.translate(W/2, H/2);
      c.scale(cam.current.zoom, cam.current.zoom);
      c.translate(-W/2+cam.current.panX, -H/2+cam.current.panY);
      const CX=CX0, CY=CY0;

      // ── Cross-section walls (drawn first, behind floors)
      drawCrossSectionWalls(c, CX, CY);

      // ── Floor 0 (ground — common areas)
      renderFloor(c, 0, ZONES_F0, CX, CY);
      drawMeetingRoom(c, propsRef.current.activeThreads.some(t=>t.active), time, CX, CY);
      drawBreakRoom(c, time, CX, CY);
      drawLobby(c, time, CX, CY);
      drawServerRoom(c, time, CX, CY);
      // Meeting chair seats
      for (const [sx,sz] of MEETING_SEATS) {
        box(c, sx-0.28, sz-0.28, 0, 0.56, 0.56, 0.06, PAL.chairSeat, PAL.chairBack, PAL.chairSide, CX, CY);
        box(c, sx-0.24, sz-0.28, 0.06, 0.48, 0.05, 0.38, PAL.chairBack, PAL.chairSide, PAL.chairSide, CX, CY);
      }

      // ── Floor 1 (upper — workstations)
      renderFloor(c, 1, ZONES_F1, CX, CY);
      drawOfficeProps(c, time, CX, CY);

      // ── Elevator (spans both floors)
      drawElevator(c, elvRef.current, time, CX, CY);

      // ── Agents (depth-sorted per floor)
      const { agentEmotions:emo, selectedAgent:sel } = propsRef.current;
      const agList = [...agentsRef.current.values()];
      // Sort: floor first (0 before 1), then isometric depth
      agList.sort((a,b) => a.floor!==b.floor ? a.floor-b.floor : (a.x+a.z)-(b.x+b.z));

      for (const ag of agList) {
        const inElv = ag.macro==="in_elevator"||ag.macro==="in_elevator_return";
        // Compute draw position
        let drawFloor: number = ag.floor;
        if (inElv) drawFloor = elvRef.current.carY;
        const sp = iso(ag.x, ag.z, drawFloor, CX, CY);

        c.save();
        // Agent jitter in moving elevator
        const jitterX = inElv&&elvRef.current.moveState==="moving"?(Math.random()-0.5)*2:0;
        drawHumanoid(
          c, sp.x+jitterX, sp.y,
          ag.appear, ag.activity, ag.phase, ag.walkPhase,
          sel===ag.id, emo.get(ag.id)?.emoji,
        );
        drawNameTag(c, ag.name, statusMap.current.get(ag.id)??"idle", ag.color, sp.x, sp.y);
        if (ag.bubble) drawSpeechBubble(c, ag.bubble, sp.x, sp.y, ag.phase);
        c.restore();

        // Elevator queue badge
        const qPos = elvRef.current.queue.findIndex(q=>q.agentId===ag.id);
        if (qPos>=0) {
          const lp=iso(ag.x, ag.z, ag.floor, CX, CY);
          c.fillStyle="#e8b020"; c.font="bold 8px monospace"; c.textAlign="center"; c.textBaseline="middle";
          c.fillText(`Q${qPos+1}`, lp.x+22, lp.y-56);
        }
      }

      // ── HUD overlay
      c.restore(); // end camera

      // Stats panel
      const mobileCount=[...agentsRef.current.values()].filter(a=>a.macro!=="at_desk").length;
      const meetCount=[...agentsRef.current.values()].filter(a=>a.macro==="in_meeting").length;
      const elvQ=elvRef.current.queue.length;
      const typingCount=[...agentsRef.current.values()].filter(a=>a.activity==="typing").length;

      c.fillStyle="rgba(8,10,20,0.88)"; c.strokeStyle="rgba(60,90,140,0.7)"; c.lineWidth=1.2;
      c.beginPath(); c.roundRect(12,12,192,90,8); c.fill(); c.stroke();
      // Title bar
      c.fillStyle="rgba(30,50,90,0.6)";
      c.beginPath(); c.roundRect(12,12,192,22,8); c.fill();
      c.fillStyle="#a8c8f0"; c.font="bold 8.5px 'Space Mono',monospace"; c.textAlign="left"; c.textBaseline="middle";
      c.fillText("◉  DLAVIE OS — OFFICE", 22, 23);
      c.fillStyle="#50c880"; c.fillText(`⌨ ${typingCount} coding`, 22, 45);
      c.fillStyle="#f0a040"; c.fillText(`🚶 ${mobileCount} in transit`, 22, 57);
      c.fillStyle="#80c0f8"; c.fillText(`🤝 ${meetCount} in meeting`, 22, 69);
      c.fillStyle="#e8c040"; c.fillText(`🛗 Elev: ${elvRef.current.moveState}  Q:${elvQ}`, 22, 81);
      c.fillStyle="#4a6878"; c.font="7px 'Space Mono',monospace";
      c.fillText(`${elvRef.current.carY>0.5?"Floor 2":"Floor 1"} · ${elvRef.current.doorState}`, 22, 95);

      // Active meeting topic
      const topic=propsRef.current.activeThreads.find(t=>t.active)?.topic;
      if (topic) {
        c.fillStyle="rgba(8,12,24,0.92)"; c.strokeStyle="rgba(0,200,220,0.7)"; c.lineWidth=1;
        c.beginPath(); c.roundRect(W-295,12,285,30,6); c.fill(); c.stroke();
        c.fillStyle="#00d8f0"; c.font="bold 8px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
        c.fillText("📋 "+topic.slice(0,44), W-152, 27);
      }

      // Controls hint
      c.fillStyle="rgba(8,10,20,0.75)"; c.strokeStyle="rgba(40,60,100,0.6)"; c.lineWidth=1;
      c.beginPath(); c.roundRect(12, H-48, 198, 36, 6); c.fill(); c.stroke();
      c.fillStyle="#3a5068"; c.font="7px 'Space Mono',monospace"; c.textAlign="left"; c.textBaseline="middle";
      c.fillText("✋ Drag to pan  ·  🤏 Pinch to zoom", 20, H-36);
      c.fillText("🖱 Drag to pan  ·  Scroll to zoom  ·  Click agent", 20, H-24);

      // ── MINIMAP ─────────────────────────────────────────────────────
      const MM_W=160, MM_H=120;
      const MM_X=W-MM_W-14, MM_Y=H-MM_H-56;
      const FLOOR_SPLIT=MM_H*0.5;
      const T_W=MM_W/22, T_H=FLOOR_SPLIT/16;
      mmBounds.current={x:MM_X,y:MM_Y,w:MM_W,h:MM_H,floorSplit:FLOOR_SPLIT,tileW:T_W,tileH:T_H};

      // Minimap bg
      c.fillStyle="rgba(6,8,18,0.94)"; c.strokeStyle="#2a3e58"; c.lineWidth=1.2;
      c.beginPath(); c.roundRect(MM_X-6,MM_Y-18,MM_W+12,MM_H+26,8); c.fill(); c.stroke();
      c.fillStyle="#1e2e42"; c.font="bold 7px 'Space Mono',monospace"; c.textAlign="center"; c.textBaseline="middle";
      c.fillText("◉ MINIMAP", MM_X+MM_W/2, MM_Y-9);

      // Floor backgrounds
      c.fillStyle="#141e2e"; c.beginPath(); c.roundRect(MM_X,MM_Y,MM_W,FLOOR_SPLIT-1,2); c.fill();
      c.fillStyle="#0e1824"; c.beginPath(); c.roundRect(MM_X,MM_Y+FLOOR_SPLIT+1,MM_W,FLOOR_SPLIT-1,2); c.fill();
      c.strokeStyle="#253545"; c.lineWidth=0.8;
      c.beginPath(); c.moveTo(MM_X,MM_Y+FLOOR_SPLIT); c.lineTo(MM_X+MM_W,MM_Y+FLOOR_SPLIT); c.stroke();

      // Zone patches — Floor 1
      for (const z of ZONES_F1) {
        const [r,g,b]=hexToRGB(z.carpet);
        c.fillStyle=`rgba(${r},${g},${b},0.32)`;
        c.fillRect(MM_X+z.x*T_W, MM_Y+z.z*T_H, z.w*T_W, z.d*T_H);
      }
      // Zone patches — Floor 0
      for (const z of ZONES_F0) {
        const [r,g,b]=hexToRGB(z.carpet);
        c.fillStyle=`rgba(${r},${g},${b},0.32)`;
        c.fillRect(MM_X+z.x*T_W, MM_Y+FLOOR_SPLIT+z.z*T_H, z.w*T_W, z.d*T_H);
      }

      // Elevator marker
      c.fillStyle="#6090b8";
      c.beginPath(); c.arc(MM_X+ELV_X*T_W, MM_Y+ELV_Z*T_H, 4, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(MM_X+ELV_X*T_W, MM_Y+FLOOR_SPLIT+ELV_Z*T_H, 4, 0, Math.PI*2); c.fill();
      // Elevator car position
      const elvCarMY=MM_Y+ELV_Z*T_H+(FLOOR_SPLIT*0.8)*(1-elvRef.current.carY);
      c.strokeStyle="#90c0e0"; c.lineWidth=1.2;
      c.beginPath(); c.arc(MM_X+ELV_X*T_W, elvCarMY, 5, 0, Math.PI*2); c.stroke();

      // Agent dots
      for (const ag of agentsRef.current.values()) {
        const dotX=MM_X+ag.x*T_W;
        const dotY=ag.floor===1 ? MM_Y+ag.z*T_H : MM_Y+FLOOR_SPLIT+ag.z*T_H;
        const isSel=ag.id===propsRef.current.selectedAgent;
        c.beginPath(); c.arc(dotX, dotY, isSel?5:3, 0, Math.PI*2);
        c.fillStyle=ag.appear.shirt; c.fill();
        c.strokeStyle=isSel?"#fff":"rgba(0,0,0,0.6)"; c.lineWidth=isSel?1.5:0.6; c.stroke();
        if (isSel) {
          const pulse=0.4+Math.abs(Math.sin(time*3))*0.6;
          c.beginPath(); c.arc(dotX, dotY, 8, 0, Math.PI*2);
          c.strokeStyle=ag.appear.shirt+Math.floor(pulse*255).toString(16).padStart(2,"0");
          c.lineWidth=1.2; c.stroke();
        }
        // Walk arrow
        if (ag.activity==="walking"&&Math.hypot(ag.tx-ag.x,ag.tz-ag.z)>0.5) {
          const tdx=ag.tx-ag.x, tdz=ag.tz-ag.z, tlen=Math.hypot(tdx,tdz);
          const arrX=dotX+(tdx/tlen)*6, arrY=dotY+(tdz/tlen)*6;
          c.strokeStyle=ag.appear.shirt+"80"; c.lineWidth=0.8;
          c.beginPath(); c.moveTo(dotX,dotY); c.lineTo(arrX,arrY); c.stroke();
        }
      }

      // Floor labels
      c.font="7px 'Space Mono',monospace"; c.textBaseline="top"; c.textAlign="right";
      c.fillStyle="#4a80a8"; c.fillText("F2",MM_X+MM_W-2,MM_Y+2);
      c.fillStyle="#4a9060"; c.fillText("F1",MM_X+MM_W-2,MM_Y+FLOOR_SPLIT+2);

      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
    return () => { running=false; };
  }, []);

  // Canvas resize
  useEffect(() => {
    const canvas=canvasRef.current; if(!canvas) return;
    const obs=new ResizeObserver(()=>{
      const r=canvas.parentElement?.getBoundingClientRect();
      if(r){ canvas.width=r.width; canvas.height=r.height; }
    });
    const r=canvas.parentElement?.getBoundingClientRect();
    if(r){ canvas.width=r.width; canvas.height=r.height; }
    obs.observe(canvas.parentElement??canvas);
    return () => obs.disconnect();
  }, []);

  // Navigate camera to world pos
  const navigateTo=useCallback((wx:number,wz:number,floor:0|1)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const W=canvas.width, H=canvas.height;
    const CX0=W*0.5-TW2*2, CY0=H*0.5-(36*TH2+1.6*TH2-FLOOR_H)*0.5;
    const sp=iso(wx,wz,floor,CX0,CY0);
    cam.current.panX=W/2-sp.x; cam.current.panY=H/2-sp.y;
  },[]);

  const tryMinimapNav=useCallback((px:number,py:number):boolean=>{
    const mm=mmBounds.current;
    if(px<mm.x||px>mm.x+mm.w||py<mm.y||py>mm.y+mm.h) return false;
    const lx=px-mm.x, ly=py-mm.y;
    const wx=lx/mm.tileW, isF1=ly<mm.floorSplit;
    const wz=isF1?(ly/mm.tileH):((ly-mm.floorSplit)/mm.tileH);
    navigateTo(wx,wz,isF1?1:0); return true;
  },[navigateTo]);

  // Mouse events
  const handleMouseDown=useCallback((e:React.MouseEvent)=>{ cam.current.drag=true; cam.current.lx=e.clientX; cam.current.ly=e.clientY; },[]);
  const handleMouseMove=useCallback((e:React.MouseEvent)=>{ if(!cam.current.drag) return; cam.current.panX+=e.clientX-cam.current.lx; cam.current.lx=e.clientX; cam.current.panY+=e.clientY-cam.current.ly; cam.current.ly=e.clientY; },[]);
  const handleMouseUp=useCallback(()=>{ cam.current.drag=false; },[]);
  const handleWheel=useCallback((e:React.WheelEvent)=>{ e.preventDefault(); cam.current.zoom=Math.max(0.35,Math.min(4.5,cam.current.zoom*(1-e.deltaY*0.0012))); },[]);

  // Touch events
  const handleTouchStart=useCallback((e:React.TouchEvent)=>{
    e.preventDefault();
    if(e.touches.length===1){
      const canvas=canvasRef.current; if(!canvas) return;
      const rect=canvas.getBoundingClientRect();
      const px=e.touches[0]!.clientX-rect.left, py=e.touches[0]!.clientY-rect.top;
      if(tryMinimapNav(px,py)) return;
      cam.current.drag=true; cam.current.lx=e.touches[0]!.clientX; cam.current.ly=e.touches[0]!.clientY;
    } else if(e.touches.length===2){
      cam.current.drag=false;
      cam.current.pinchDist=Math.hypot(e.touches[0]!.clientX-e.touches[1]!.clientX,e.touches[0]!.clientY-e.touches[1]!.clientY);
    }
  },[tryMinimapNav]);

  const handleTouchMove=useCallback((e:React.TouchEvent)=>{
    e.preventDefault();
    if(e.touches.length===1&&cam.current.drag){
      cam.current.panX+=e.touches[0]!.clientX-cam.current.lx; cam.current.lx=e.touches[0]!.clientX;
      cam.current.panY+=e.touches[0]!.clientY-cam.current.ly; cam.current.ly=e.touches[0]!.clientY;
    } else if(e.touches.length===2){
      const dist=Math.hypot(e.touches[0]!.clientX-e.touches[1]!.clientX,e.touches[0]!.clientY-e.touches[1]!.clientY);
      if(cam.current.pinchDist>0) cam.current.zoom=Math.max(0.35,Math.min(4.5,cam.current.zoom*dist/cam.current.pinchDist));
      cam.current.pinchDist=dist;
    }
  },[]);
  const handleTouchEnd=useCallback(()=>{ cam.current.drag=false; cam.current.pinchDist=0; },[]);

  // Click → minimap nav or agent select
  const handleClick=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    if(Math.hypot(e.movementX,e.movementY)>5) return;
    const rect=canvas.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    if(tryMinimapNav(px,py)) return;
    const CX0=canvas.width*0.5-TW2*2, CY0=canvas.height*0.5-(36*TH2+1.6*TH2-FLOOR_H)*0.5;
    const W=canvas.width, H=canvas.height;
    const mx=(px-W/2-cam.current.panX)/cam.current.zoom+W/2;
    const my=(py-H/2-cam.current.panY)/cam.current.zoom+H/2;
    let best:string|null=null, bestD=48;
    for(const ag of agentsRef.current.values()){
      const sp=iso(ag.x,ag.z,ag.floor,CX0,CY0);
      const d=Math.hypot(sp.x-mx,sp.y-my+40);
      if(d<bestD){ bestD=d; best=ag.id; }
    }
    if(best) propsRef.current.onSelectAgent(best);
  },[tryMinimapNav]);

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
        background: PAL.sky,
      }}
    />
  );
}

export default OfficeRealistic;
