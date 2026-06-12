/**
 * DLavie OS — Brand Kit Routes
 * AI-generated visual assets: logo, banner, thumbnail, social, icon
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";

const router: IRouter = Router();

// ─── Storage ──────────────────────────────────────────────────────────────────

const BASE     = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
const KIT_DIR  = join(BASE, ".dlavie-brand-kit");
const META_FILE = join(KIT_DIR, "assets.json");

if (!existsSync(KIT_DIR)) mkdirSync(KIT_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssetType  = "logo" | "banner" | "thumbnail" | "social" | "story" | "icon" | "wallpaper";

interface SizePreset { label: string; w: number; h: number; desc: string }
interface AssetMeta  { id: string; type: AssetType; preset: string; prompt: string; seed: number; w: number; h: number; createdAt: string; bytes: number; ext?: string }

// ─── Size presets ─────────────────────────────────────────────────────────────

export const SIZE_PRESETS: Record<AssetType, SizePreset[]> = {
  logo: [
    { label: "Standard",   w: 512,  h: 512,  desc: "512 × 512 px" },
    { label: "Small",      w: 256,  h: 256,  desc: "256 × 256 px (alias 512)" },
  ],
  banner: [
    { label: "Website",    w: 1024, h: 512,  desc: "1024 × 512 — website hero" },
    { label: "Twitter",    w: 1024, h: 384,  desc: "1024 × 384 — Twitter header" },
    { label: "LinkedIn",   w: 1024, h: 256,  desc: "1024 × 256 — LinkedIn cover" },
  ],
  thumbnail: [
    { label: "YouTube",    w: 896,  h: 512,  desc: "896 × 512 — YouTube thumbnail" },
    { label: "Blog",       w: 1024, h: 512,  desc: "1024 × 512 — blog cover" },
  ],
  social: [
    { label: "Square",     w: 512,  h: 512,  desc: "512 × 512 — Instagram / FB" },
    { label: "Wide",       w: 1024, h: 512,  desc: "1024 × 512 — Twitter post" },
  ],
  story: [
    { label: "Story",      w: 512,  h: 896,  desc: "512 × 896 — Instagram / WA story" },
    { label: "TikTok",     w: 512,  h: 1024, desc: "512 × 1024 — TikTok cover" },
  ],
  icon: [
    { label: "App Icon",   w: 512,  h: 512,  desc: "512 × 512 — round/square icon" },
  ],
  wallpaper: [
    { label: "Desktop",    w: 1024, h: 576,  desc: "1024 × 576 — desktop wallpaper" },
    { label: "Mobile",     w: 512,  h: 1024, desc: "512 × 1024 — mobile wallpaper" },
  ],
};

// ─── Prompt templates ─────────────────────────────────────────────────────────

const BASE_STYLE = "elegant professional design, dark navy (#0f172a) background, electric green (#22c55e) accent, 'DLavie OS' text in clean white sans-serif, minimalist corporate tech aesthetic, flat clean design, no gradients except background, high quality";

const PROMPTS: Record<AssetType, string> = {
  logo:      `Minimalist professional logo, circular emblem, geometric AI node pattern, bold centered text 'DLavie OS', thin electric green ring border, ${BASE_STYLE}`,
  banner:    `Professional technology company banner, wide panoramic, subtle hexagonal grid pattern on right side, 'DLavie OS' bold title on left, tagline 'AI ENGINE' below, decorative abstract AI visualization, ${BASE_STYLE}`,
  thumbnail: `Modern video thumbnail, 'DLavie OS' large bold title centered, clean AI visual elements in background, strong contrast, ${BASE_STYLE}`,
  social:    `Social media post, square composition, 'DLavie OS' branding centered, decorative abstract AI pattern background, ${BASE_STYLE}`,
  story:     `Vertical story format post, 'DLavie OS' branding in upper third, abstract futuristic pattern, clean minimal, ${BASE_STYLE}`,
  icon:      `App icon, rounded square shape, 'DL' monogram in bold white on dark navy, subtle green glow, clean modern app icon design, ${BASE_STYLE}`,
  wallpaper: `Desktop wallpaper, wide cinematic, very subtle 'DLavie OS' watermark bottom-right, minimal abstract tech pattern, ${BASE_STYLE}`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadMeta(): AssetMeta[] {
  try {
    if (existsSync(META_FILE)) return JSON.parse(readFileSync(META_FILE, "utf8")) as AssetMeta[];
  } catch { /* ignore */ }
  return [];
}

function saveMeta(list: AssetMeta[]): void {
  try { writeFileSync(META_FILE, JSON.stringify(list, null, 2)); } catch { /* ignore */ }
}

/** Simple sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate image via Pollinations.ai (free, no API key).
 * Retries up to 3× because Replit's shared IP may hit the 1-request-per-IP queue limit.
 */
async function tryPollinations(prompt: string, w: number, h: number, seed: number): Promise<Buffer | null> {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[BrandKit] Pollinations attempt ${attempt}/3…`);
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.startsWith("image/")) {
          const buf = Buffer.from(await res.arrayBuffer());
          console.log(`[BrandKit] ✅ Pollinations OK (${buf.length} bytes)`);
          return buf;
        }
      }
      const msg = await res.text().catch(() => res.statusText);
      console.warn(`[BrandKit] Pollinations ${res.status}: ${msg.slice(0, 120)}`);
      // 402 = queue full — wait and retry
      if (res.status === 402 && attempt < 3) {
        await sleep(12_000 * attempt);
        continue;
      }
      return null;
    } catch (e) {
      console.warn(`[BrandKit] Pollinations error: ${String(e).slice(0, 120)}`);
      if (attempt < 3) await sleep(8_000 * attempt);
    }
  }
  return null;
}

/**
 * HuggingFace router image generation (requires HF token with inference credits).
 */
async function tryHuggingFace(prompt: string, w: number, h: number, seed: number): Promise<Buffer | null> {
  const token = process.env.HF_TOKEN || "";
  if (!token.startsWith("hf_")) return null;

  const models = [
    { id: "black-forest-labs/FLUX.1-schnell", steps: 4 },
    { id: "stabilityai/stable-diffusion-xl-base-1.0", steps: 20 },
  ];

  for (const model of models) {
    try {
      console.log(`[BrandKit] Trying HF: ${model.id}…`);
      const res = await fetch(
        `https://router.huggingface.co/hf-inference/models/${model.id}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Wait-For-Model": "true",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: { seed, num_inference_steps: model.steps, width: w, height: h },
          }),
          signal: AbortSignal.timeout(120_000),
        }
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        console.log(`[BrandKit] ✅ HF ${model.id} OK (${buf.length} bytes)`);
        return buf;
      }
      const msg = await res.text().catch(() => res.statusText);
      console.warn(`[BrandKit] HF ${model.id} → ${res.status}: ${msg.slice(0, 100)}`);
    } catch (e) {
      console.warn(`[BrandKit] HF error: ${String(e).slice(0, 100)}`);
    }
  }
  return null;
}

/**
 * Local SVG fallback — generates a professional brand asset using pure Node.js.
 * No external dependencies, always works, deterministic for the same seed.
 */
function generateLocalSVG(type: AssetType, w: number, h: number, seed: number): Buffer {
  // Seeded pseudo-random for consistent results
  const rng = (n: number) => ((seed * 1103515245 + n * 12345) >>> 0) / 0xffffffff;

  const colors = {
    bg: "#0f172a", accent: "#22c55e", accent2: "#16a34a",
    text: "#ffffff", muted: "#94a3b8", dark: "#020617",
  };

  // Generate decorative hexagons
  const hexCount = 6 + Math.floor(rng(1) * 8);
  const hexagons = Array.from({ length: hexCount }, (_, i) => {
    const cx = Math.floor(rng(i * 7 + 2) * w);
    const cy = Math.floor(rng(i * 7 + 3) * h);
    const r  = 20 + Math.floor(rng(i * 7 + 4) * 60);
    const op = (0.04 + rng(i * 7 + 5) * 0.12).toFixed(2);
    const pts = Array.from({ length: 6 }, (_, k) => {
      const ang = (Math.PI / 3) * k;
      return `${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`;
    }).join(" ");
    return `<polygon points="${pts}" fill="${colors.accent}" opacity="${op}" />`;
  }).join("\n    ");

  // Node count for decorative circuit dots
  const nodes = Array.from({ length: 12 }, (_, i) => {
    const cx = Math.floor(rng(i * 13 + 9) * w);
    const cy = Math.floor(rng(i * 13 + 10) * h);
    const r  = 2 + Math.floor(rng(i * 13 + 11) * 4);
    const op = (0.2 + rng(i * 13 + 12) * 0.5).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors.accent}" opacity="${op}" />`;
  }).join("\n    ");

  const typeLabels: Record<AssetType, string> = {
    logo: "LOGO", banner: "BANNER", thumbnail: "THUMBNAIL",
    social: "SOCIAL", story: "STORY", icon: "ICON", wallpaper: "WALLPAPER",
  };

  const fontSize    = Math.max(16, Math.min(48, w / 10));
  const subFontSize = Math.max(10, Math.min(22, w / 22));
  const cx = w / 2, cy = h / 2;

  let innerContent = "";
  if (type === "logo" || type === "icon") {
    const r = Math.min(cx, cy) * 0.55;
    innerContent = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors.accent}" stroke-width="2" opacity="0.6"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="${colors.dark}" opacity="0.7"/>
    <text x="${cx}" y="${cy - fontSize * 0.3}" text-anchor="middle" dominant-baseline="middle"
          font-family="'Space Mono', monospace" font-weight="700" font-size="${fontSize * 1.2}"
          fill="${colors.text}">DL</text>
    <text x="${cx}" y="${cy + fontSize * 0.95}" text-anchor="middle" dominant-baseline="middle"
          font-family="'Syne', sans-serif" font-weight="600" font-size="${subFontSize * 0.85}"
          fill="${colors.accent}" letter-spacing="4">OS</text>`;
  } else {
    innerContent = `
    <text x="${cx}" y="${cy - subFontSize * 0.8}" text-anchor="middle" dominant-baseline="middle"
          font-family="'Syne', sans-serif" font-weight="700" font-size="${fontSize}"
          fill="${colors.text}">DLavie OS</text>
    <text x="${cx}" y="${cy + fontSize * 0.9}" text-anchor="middle" dominant-baseline="middle"
          font-family="'Space Mono', monospace" font-size="${subFontSize}"
          fill="${colors.accent}" letter-spacing="3">AI ENGINE · ${typeLabels[type]}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="${colors.bg}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${colors.accent}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${hexagons}
  ${nodes}
  ${innerContent}
  <text x="${w - 8}" y="${h - 8}" text-anchor="end"
        font-family="monospace" font-size="9" fill="${colors.muted}" opacity="0.5">DLavie OS</text>
</svg>`;

  console.log(`[BrandKit] ✅ Local SVG fallback generated (${svg.length} chars)`);
  return Buffer.from(svg, "utf8");
}

/**
 * Main image generator — tries Pollinations → HuggingFace → local SVG fallback.
 */
async function generateImage(prompt: string, w: number, h: number, seed: number, type: AssetType): Promise<{ buf: Buffer; isSvg: boolean }> {
  const pollinationsResult = await tryPollinations(prompt, w, h, seed);
  if (pollinationsResult) return { buf: pollinationsResult, isSvg: false };

  const hfResult = await tryHuggingFace(prompt, w, h, seed);
  if (hfResult) return { buf: hfResult, isSvg: false };

  console.warn("[BrandKit] All external providers failed — using local SVG fallback");
  return { buf: generateLocalSVG(type, w, h, seed), isSvg: true };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/brand-kit/presets — return all size presets */
router.get("/brand-kit/presets", (_req, res) => {
  res.json({ presets: SIZE_PRESETS });
});

/** GET /api/brand-kit/assets — list generated assets (newest first) */
router.get("/brand-kit/assets", (_req, res) => {
  const list = loadMeta().reverse();
  const assets = list.map((a) => {
    const ext      = a.ext ?? "jpg";
    const filePath = join(KIT_DIR, `${a.id}.${ext}`);
    const mime     = ext === "svg" ? "image/svg+xml" : "image/jpeg";
    let data: string | null = null;
    try {
      if (existsSync(filePath)) data = `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
    } catch { /* ignore */ }
    return { ...a, data };
  });
  res.json({ assets });
});

/** POST /api/brand-kit/generate — generate a new asset */
router.post("/brand-kit/generate", async (req: Request, res: Response) => {
  const { type, presetIndex = 0, customPrompt, seed: reqSeed } = req.body as {
    type: AssetType;
    presetIndex?: number;
    customPrompt?: string;
    seed?: number;
  };

  if (!type || !SIZE_PRESETS[type]) {
    res.status(400).json({ error: "Invalid type. Valid: logo, banner, thumbnail, social, story, icon, wallpaper" });
    return;
  }

  const presets = SIZE_PRESETS[type];
  const preset  = presets[Math.min(presetIndex, presets.length - 1)];
  const seed    = reqSeed ?? Math.floor(Math.random() * 999_999);
  const prompt  = customPrompt ? `${customPrompt}, DLavie OS, ${BASE_STYLE}` : PROMPTS[type];

  try {
    console.log(`[BrandKit] Generating ${type} (${preset.w}×${preset.h}) seed=${seed}…`);
    const { buf, isSvg } = await generateImage(prompt, preset.w, preset.h, seed, type);

    const id       = crypto.randomBytes(8).toString("hex");
    const ext      = isSvg ? "svg" : "jpg";
    const mime     = isSvg ? "image/svg+xml" : "image/jpeg";
    const filePath = join(KIT_DIR, `${id}.${ext}`);
    writeFileSync(filePath, buf);

    const meta: AssetMeta = {
      id, type, ext,
      preset:    preset.label,
      prompt:    customPrompt || "(default DLavie OS)",
      seed, w: preset.w, h: preset.h,
      createdAt: new Date().toISOString(),
      bytes:     buf.length,
    };
    const list = loadMeta();
    list.push(meta);
    saveMeta(list);

    const data = `data:${mime};base64,${buf.toString("base64")}`;
    console.log(`[BrandKit] ✅ ${id}.${ext} saved (${buf.length} bytes)`);
    res.json({ ok: true, asset: { ...meta, data } });
  } catch (e) {
    console.error("[BrandKit] Error:", e);
    res.status(500).json({ error: String(e) });
  }
});

/** GET /api/brand-kit/assets/:id/download — serve raw file as download */
router.get("/brand-kit/assets/:id/download", (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const list   = loadMeta();
  const meta   = list.find((a) => a.id === id);
  const ext    = meta?.ext ?? "jpg";
  const mime   = ext === "svg" ? "image/svg+xml" : "image/jpeg";
  const filePath = join(KIT_DIR, `${id}.${ext}`);
  if (!existsSync(filePath)) { res.status(404).json({ error: "Asset not found" }); return; }
  const fname  = `dlavie-os-${meta?.type ?? "asset"}-${id.slice(0, 6)}.${ext}`;
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.setHeader("Content-Type", mime);
  res.sendFile(filePath);
});

/** DELETE /api/brand-kit/assets/:id */
router.delete("/brand-kit/assets/:id", (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const filePath = join(KIT_DIR, `${id}.jpg`);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
    const list = loadMeta().filter((a) => a.id !== id);
    saveMeta(list);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
