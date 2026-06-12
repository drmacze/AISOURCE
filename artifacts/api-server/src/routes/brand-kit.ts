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
interface AssetMeta  { id: string; type: AssetType; preset: string; prompt: string; seed: number; w: number; h: number; createdAt: string; bytes: number }

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

async function generateImage(prompt: string, w: number, h: number, seed: number): Promise<Buffer> {
  const token = process.env.HF_TOKEN || "";
  if (!token.startsWith("hf_")) throw new Error("HF_TOKEN not configured");

  const res = await fetch(
    "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Wait-For-Model": "true",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { seed, num_inference_steps: 4, width: w, height: h },
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`FLUX API ${res.status}: ${msg.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/brand-kit/presets — return all size presets */
router.get("/brand-kit/presets", (_req, res) => {
  res.json({ presets: SIZE_PRESETS });
});

/** GET /api/brand-kit/assets — list generated assets (newest first) */
router.get("/brand-kit/assets", (_req, res) => {
  const list = loadMeta().reverse();
  // Attach base64 thumbnail data for gallery display
  const assets = list.map((a) => {
    const filePath = join(KIT_DIR, `${a.id}.jpg`);
    let data: string | null = null;
    try {
      if (existsSync(filePath)) data = `data:image/jpeg;base64,${readFileSync(filePath).toString("base64")}`;
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
    const buf = await generateImage(prompt, preset.w, preset.h, seed);

    const id       = crypto.randomBytes(8).toString("hex");
    const filePath = join(KIT_DIR, `${id}.jpg`);
    writeFileSync(filePath, buf);

    const meta: AssetMeta = {
      id, type,
      preset:    preset.label,
      prompt:    customPrompt || "(default DLavie OS)",
      seed, w: preset.w, h: preset.h,
      createdAt: new Date().toISOString(),
      bytes:     buf.length,
    };
    const list = loadMeta();
    list.push(meta);
    saveMeta(list);

    const data = `data:image/jpeg;base64,${buf.toString("base64")}`;
    console.log(`[BrandKit] ✅ ${id} saved (${buf.length} bytes)`);
    res.json({ ok: true, asset: { ...meta, data } });
  } catch (e) {
    console.error("[BrandKit] Error:", e);
    res.status(500).json({ error: String(e) });
  }
});

/** GET /api/brand-kit/assets/:id/download — serve raw file as download */
router.get("/brand-kit/assets/:id/download", (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const filePath = join(KIT_DIR, `${id}.jpg`);
  if (!existsSync(filePath)) { res.status(404).json({ error: "Asset not found" }); return; }
  const list   = loadMeta();
  const meta   = list.find((a) => a.id === id);
  const fname  = `dlavie-os-${meta?.type ?? "asset"}-${id.slice(0, 6)}.jpg`;
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.setHeader("Content-Type", "image/jpeg");
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
