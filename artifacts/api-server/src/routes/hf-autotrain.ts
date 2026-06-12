/**
 * DLavie OS — HuggingFace AutoTrain Integration
 *
 * Real API calls to HuggingFace Hub and AutoTrain.
 * All compute runs on HF's free GPU infrastructure.
 *
 * Endpoints:
 *  GET  /api/hf/autotrain/info              — HF token status + user profile
 *  POST /api/hf/dataset/push               — push training samples from DB → HF Hub dataset
 *  POST /api/hf/autotrain/create           — create AutoTrain fine-tuning job
 *  GET  /api/hf/autotrain/jobs             — list AutoTrain jobs for user
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { trainingSamplesTable, trainingDatasetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const HF_API   = "https://huggingface.co/api";
const HF_HUB   = "https://huggingface.co";
const AT_API   = "https://api.autotrain.huggingface.co";

function getHFToken(): string {
  return process.env.HF_TOKEN || "";
}

function hfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${getHFToken()}`,
    ...extra,
  };
}

function isHFReady(): boolean {
  const t = getHFToken();
  return !!t && t.startsWith("hf_");
}

// ─── GET /api/hf/autotrain/info ──────────────────────────────────────────────
router.get("/hf/autotrain/info", async (_req: Request, res: Response) => {
  if (!isHFReady()) {
    return res.json({
      configured: false,
      message: "HF_TOKEN belum diset. Tambahkan di Settings → API Keys.",
    });
  }

  // Token format valid — try whoami for extra info but don't fail if it errors
  // (fine-grained/read-only tokens can still push datasets and launch AutoTrain)
  try {
    const whoRes = await fetch(`${HF_API}/whoami`, {
      headers: hfHeaders(),
      signal: AbortSignal.timeout(6000),
    });
    if (whoRes.ok) {
      const who = await whoRes.json() as {
        name: string; fullname?: string; email?: string;
        plan?: { type?: string }; orgs?: Array<{ name: string }>;
      };
      return res.json({
        configured: true,
        username:   who.name,
        fullname:   who.fullname ?? who.name,
        plan:       who.plan?.type ?? "free",
        orgs:       (who.orgs ?? []).map((o) => o.name),
      });
    }
    // whoami failed (e.g. fine-grained token / scoped token) — token still usable
    return res.json({
      configured: true,
      username:   null,
      fullname:   null,
      plan:       "unknown",
      orgs:       [],
      note:       "Token valid (format ok) — profil tidak tersedia. Masukkan username HF secara manual saat push dataset.",
    });
  } catch {
    // Network error — optimistically return configured if format is valid
    return res.json({
      configured: true,
      username:   null,
      fullname:   null,
      plan:       "unknown",
      orgs:       [],
      note:       "Tidak dapat verifikasi token ke HuggingFace (network). Token akan digunakan langsung.",
    });
  }
});

// ─── POST /api/hf/dataset/push ───────────────────────────────────────────────
router.post("/hf/dataset/push", async (req: Request, res: Response) => {
  if (!isHFReady()) {
    return res.status(401).json({ error: "HF_TOKEN belum diset." });
  }

  const { datasetId, repoName, private: isPrivate = true, hfUsername } = req.body as {
    datasetId: number; repoName?: string; private?: boolean; hfUsername?: string;
  };

  if (!datasetId) return res.status(400).json({ error: "datasetId wajib diisi." });

  try {
    // 1. Get user info — try whoami, fall back to provided username
    let username = hfUsername?.trim() || "";
    try {
      const whoRes = await fetch(`${HF_API}/whoami`, {
        headers: hfHeaders(),
        signal: AbortSignal.timeout(6000),
      });
      if (whoRes.ok) {
        const who = await whoRes.json() as { name: string };
        username = who.name;
      }
    } catch { /* whoami failed — use provided username */ }

    if (!username) {
      return res.status(400).json({
        error: "Tidak bisa mendapatkan username HF. Masukkan field 'hfUsername' secara manual (lihat profil HuggingFace Anda).",
        needsUsername: true,
      });
    }

    // 2. Load samples from DB
    const dataset = await db.select().from(trainingDatasetsTable).where(eq(trainingDatasetsTable.id, datasetId)).limit(1);
    if (!dataset.length) return res.status(404).json({ error: "Dataset tidak ditemukan." });

    const samples = await db.select().from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, datasetId));
    if (!samples.length) return res.status(400).json({ error: "Dataset kosong — tambahkan samples terlebih dahulu." });

    // 3. Convert to JSONL format (standard for HF instruction fine-tuning)
    const jsonlLines = samples.map((s) => JSON.stringify({
      instruction: s.input,
      output: s.expectedOutput,
      quality: s.quality ?? 0.8,
      source: s.source ?? "dlavie",
    }));
    const jsonlContent = jsonlLines.join("\n");
    const contentBytes = Buffer.from(jsonlContent, "utf-8");

    // 4. Determine repo name
    const safeName = repoName
      ? repoName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
      : `dlavie-${dataset[0].name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}-${Date.now()}`;
    const repoId = `${username}/${safeName}`;

    // 5. Create HF dataset repo
    const createRes = await fetch(`${HF_API}/repos/create`, {
      method: "POST",
      headers: hfHeaders(),
      body: JSON.stringify({
        type: "dataset",
        name: safeName,
        private: isPrivate,
        exist_ok: true,
      }),
    });

    if (!createRes.ok && createRes.status !== 409) {
      const err = await createRes.text();
      return res.status(502).json({ error: `Gagal buat repo HF: ${err}` });
    }

    // 6. Upload JSONL file via HF Hub commit API
    const b64Content = contentBytes.toString("base64");

    const commitRes = await fetch(`${HF_HUB}/api/datasets/${repoId}/commit/main`, {
      method: "POST",
      headers: hfHeaders(),
      body: JSON.stringify({
        summary: `Upload ${samples.length} training samples from DLavie OS`,
        files: [
          {
            path: "train.jsonl",
            content: b64Content,
            encoding: "base64",
          },
        ],
      }),
    });

    if (!commitRes.ok) {
      const commitErr = await commitRes.text();
      console.warn("[HF AutoTrain] commit error:", commitErr.slice(0, 200));
      // Fallback: try the preupload + LFS commit flow
      return await pushViaLFS(res, repoId, safeName, contentBytes, b64Content, samples.length, username);
    }

    const commitData = await commitRes.json() as { id?: string; url?: string };

    return res.json({
      ok: true,
      repoId,
      repoUrl: `https://huggingface.co/datasets/${repoId}`,
      commitId: commitData.id ?? "unknown",
      samplesUploaded: samples.length,
      filename: "train.jsonl",
    });

  } catch (err) {
    console.error("[HF Dataset Push]", err);
    return res.status(500).json({ error: String(err) });
  }
});

/** LFS-based upload fallback for repos that require it */
async function pushViaLFS(
  res: Response,
  repoId: string,
  _repoName: string,
  contentBytes: Buffer,
  b64Content: string,
  sampleCount: number,
  _username: string
): Promise<Response> {
  try {
    // Step A: preupload to get upload URLs
    const preRes = await fetch(`${HF_HUB}/api/datasets/${repoId}/preupload/main`, {
      method: "POST",
      headers: hfHeaders(),
      body: JSON.stringify({
        files: [{
          path: "train.jsonl",
          sample: b64Content.slice(0, 2000),
        }],
      }),
    });

    if (!preRes.ok) {
      const txt = await preRes.text();
      return res.status(502).json({ error: `Preupload gagal: ${txt.slice(0, 200)}` });
    }

    const preData = await preRes.json() as {
      files?: Array<{ upload_url?: string; sha256?: string; path: string }>;
    };
    const fileInfo = preData.files?.[0];

    if (fileInfo?.upload_url) {
      // Upload to S3/LFS
      await fetch(fileInfo.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: contentBytes,
      });

      // Commit with LFS pointer
      await fetch(`${HF_HUB}/api/datasets/${repoId}/commit/main`, {
        method: "POST",
        headers: hfHeaders(),
        body: JSON.stringify({
          summary: `Upload ${sampleCount} training samples from DLavie OS (LFS)`,
          lfs_files: [{ path: "train.jsonl", sha256: fileInfo.sha256, size: contentBytes.length }],
        }),
      });
    } else {
      // Try direct inline upload as final fallback
      await fetch(`${HF_HUB}/api/datasets/${repoId}/commit/main`, {
        method: "POST",
        headers: hfHeaders(),
        body: JSON.stringify({
          summary: `Upload ${sampleCount} training samples`,
          files: [{ path: "train.jsonl", content: b64Content }],
        }),
      });
    }

    return res.json({
      ok: true,
      repoId,
      repoUrl: `https://huggingface.co/datasets/${repoId}`,
      samplesUploaded: sampleCount,
      filename: "train.jsonl",
      method: "lfs",
    });
  } catch (err) {
    return res.status(500).json({ error: `LFS upload gagal: ${String(err)}` });
  }
}

// ─── POST /api/hf/autotrain/create ───────────────────────────────────────────
router.post("/hf/autotrain/create", async (req: Request, res: Response) => {
  if (!isHFReady()) {
    return res.status(401).json({ error: "HF_TOKEN belum diset." });
  }

  const {
    datasetRepoId,
    baseModel   = "unsloth/Qwen2.5-7B-Instruct",
    projectName,
    epochs      = 3,
    lr          = 2e-4,
    trainSplit  = "train",
    textColumn  = "instruction",
    targetColumn = "output",
  } = req.body as {
    datasetRepoId: string;
    baseModel?: string;
    projectName?: string;
    epochs?: number;
    lr?: number;
    trainSplit?: string;
    textColumn?: string;
    targetColumn?: string;
  };

  if (!datasetRepoId) return res.status(400).json({ error: "datasetRepoId wajib diisi." });

  const { hfUsername } = req.body as { hfUsername?: string };

  try {
    // Get username — try whoami, fall back to provided
    let username = hfUsername?.trim() || "";
    try {
      const whoRes = await fetch(`${HF_API}/whoami`, {
        headers: hfHeaders(),
        signal: AbortSignal.timeout(6000),
      });
      if (whoRes.ok) {
        const who = await whoRes.json() as { name: string };
        username = who.name;
      }
    } catch { /* whoami failed */ }

    if (!username) {
      return res.status(400).json({
        error: "Tidak bisa mendapatkan username HF. Sertakan field 'hfUsername' (lihat profil HuggingFace Anda).",
        needsUsername: true,
      });
    }

    const safeName = (projectName ?? `dlavie-finetune-${Date.now()}`)
      .replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();

    // Try HF AutoTrain API (official backend)
    const atPayload = {
      project_name: safeName,
      task: "llm-sft",
      base_model: baseModel,
      data_path: datasetRepoId,
      train_split: trainSplit,
      text_column: textColumn,
      target_column: targetColumn,
      trainer: "sft",
      username,
      hub_dataset: datasetRepoId,
      hub_model: `${username}/${safeName}`,
      num_train_epochs: epochs,
      learning_rate: lr,
      per_device_train_batch_size: 2,
      gradient_accumulation_steps: 4,
      mixed_precision: "fp16",
      peft: true,
      quantization: "int4",
      lora_r: 16,
      lora_alpha: 32,
      lora_dropout: 0.05,
      push_to_hub: true,
      private_repo: false,
    };

    // Try the official AutoTrain backend
    const atRes = await fetch(`${AT_API}/api/create_project`, {
      method: "POST",
      headers: { ...hfHeaders(), "X-Api-Key": getHFToken() },
      body: JSON.stringify(atPayload),
    });

    if (atRes.ok) {
      const atData = await atRes.json() as { id?: string; project_name?: string };
      return res.json({
        ok: true,
        method: "autotrain-api",
        projectId: atData.id ?? safeName,
        projectName: atData.project_name ?? safeName,
        outputModel: `${username}/${safeName}`,
        outputModelUrl: `https://huggingface.co/${username}/${safeName}`,
        monitorUrl: `https://huggingface.co/spaces/autotrain-projects/autotrain-advanced`,
        config: atPayload,
      });
    }

    // Fallback: provide ready-to-use AutoTrain config so user can start via HF UI
    const atConfig = {
      base_model: baseModel,
      project_name: safeName,
      data_path: datasetRepoId,
      task: "llm-sft",
      trainer: "sft",
      epochs,
      lr,
      peft: true,
      quantization: "int4",
      push_to_hub: true,
    };

    return res.json({
      ok: true,
      method: "config-ready",
      message: "AutoTrain API tidak merespons. Config siap — gunakan link di bawah untuk launch via HF UI.",
      projectName: safeName,
      outputModel: `${username}/${safeName}`,
      launchUrl: `https://huggingface.co/spaces/autotrain-projects/autotrain-advanced`,
      config: atConfig,
      configYaml: `task: llm-sft\nbase_model: ${baseModel}\nproject_name: ${safeName}\ndata_path: ${datasetRepoId}\ntrainer: sft\nepochs: ${epochs}\nlr: ${lr}\npeft: true\nquantization: int4\npush_to_hub: true\nhub_model: ${username}/${safeName}`,
    });

  } catch (err) {
    console.error("[HF AutoTrain Create]", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/hf/autotrain/models ────────────────────────────────────────────
// List popular base models suitable for SFT on HF AutoTrain (free with small sizes)
router.get("/hf/autotrain/models", (_req: Request, res: Response) => {
  res.json([
    { id: "unsloth/Qwen2.5-7B-Instruct",         label: "Qwen2.5 7B",          vram: "8GB",  recommended: true  },
    { id: "unsloth/Qwen2.5-3B-Instruct",          label: "Qwen2.5 3B",          vram: "4GB",  recommended: false },
    { id: "unsloth/Llama-3.2-3B-Instruct",        label: "Llama 3.2 3B",        vram: "4GB",  recommended: false },
    { id: "unsloth/Llama-3.1-8B-Instruct",        label: "Llama 3.1 8B",        vram: "10GB", recommended: false },
    { id: "unsloth/mistral-7b-instruct-v0.3",     label: "Mistral 7B v0.3",     vram: "8GB",  recommended: false },
    { id: "unsloth/gemma-2-9b-it",                label: "Gemma 2 9B",          vram: "12GB", recommended: false },
    { id: "microsoft/Phi-3.5-mini-instruct",      label: "Phi-3.5 Mini",        vram: "6GB",  recommended: false },
    { id: "Qwen/Qwen2.5-72B-Instruct",            label: "Qwen2.5 72B (Pro)",   vram: "40GB", recommended: false },
  ]);
});

// ─── GET /api/hf/autotrain/jobs ───────────────────────────────────────────────
router.get("/hf/autotrain/jobs", async (_req: Request, res: Response) => {
  if (!isHFReady()) return res.json({ configured: false, jobs: [] });

  try {
    const whoRes = await fetch(`${HF_API}/whoami`, { headers: hfHeaders() });
    if (!whoRes.ok) return res.json({ configured: false, jobs: [] });
    const who = await whoRes.json() as { name: string };

    const jobsRes = await fetch(`${AT_API}/api/user/${who.name}/projects`, {
      headers: { ...hfHeaders(), "X-Api-Key": getHFToken() },
    });

    if (!jobsRes.ok) return res.json({ configured: true, username: who.name, jobs: [] });

    const data = await jobsRes.json() as { projects?: unknown[] };
    return res.json({ configured: true, username: who.name, jobs: data.projects ?? [] });
  } catch (err) {
    return res.json({ configured: true, jobs: [], error: String(err) });
  }
});

export default router;
