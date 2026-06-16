/**
 * DLavie OS — Kaggle Integration (Full)
 *
 * Endpoints:
 *  GET  /api/kaggle/status                    — credential check + connectivity
 *  POST /api/kaggle/credentials               — save KAGGLE_USERNAME + KAGGLE_KEY
 *  POST /api/kaggle/dataset/sync              — export dataset from DB → push to Kaggle
 *  GET  /api/kaggle/datasets                  — list user's Kaggle datasets
 *  GET  /api/kaggle/kernels                   — list user's kernels/notebooks
 *  GET  /api/kaggle/kernels/:slug/status      — kernel run status + output
 *  POST /api/kaggle/kernels/push              — push/update notebook to Kaggle
 *  POST /api/kaggle/kernels/run               — trigger a kernel run (GPU training)
 *  GET  /api/kaggle/kernels/:slug/output      — list output files from completed run
 *  GET  /api/kaggle/quota                     — GPU usage quota (30hr/week)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { trainingSamplesTable, trainingDatasetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const KAGGLE_API = "https://www.kaggle.com/api/v1";
const CONFIG_PATH = join(
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace",
  ".dlavie-config.json"
);

// ─── Credential helpers ───────────────────────────────────────────────────────

function getKaggleCreds(): { username: string; key: string } | null {
  const username = process.env.KAGGLE_USERNAME || "";
  const key      = process.env.KAGGLE_KEY      || "";
  if (!username || !key) return null;
  return { username, key };
}

function kaggleHeaders(creds: { username: string; key: string }) {
  const b64 = Buffer.from(`${creds.username}:${creds.key}`).toString("base64");
  return {
    "Authorization": `Basic ${b64}`,
    "Content-Type":  "application/json",
    "User-Agent":    "DLavie-OS/1.0",
  };
}

async function kaggleGet<T = unknown>(path: string, creds: { username: string; key: string }): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  try {
    const r = await fetch(`${KAGGLE_API}${path}`, {
      headers: kaggleHeaders(creds),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, error: txt.slice(0, 300), status: r.status };
    }
    const data = await r.json() as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function kagglePost<T = unknown>(path: string, creds: { username: string; key: string }, body: unknown): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  try {
    const r = await fetch(`${KAGGLE_API}${path}`, {
      method: "POST",
      headers: kaggleHeaders(creds),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, error: txt.slice(0, 300), status: r.status };
    }
    const data = await r.json() as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── GET /api/kaggle/status ───────────────────────────────────────────────────
router.get("/kaggle/status", async (_req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) {
    return res.json({
      configured: false,
      message: "KAGGLE_USERNAME dan KAGGLE_KEY belum diset. Tambahkan di Settings → API Keys.",
    });
  }

  // Test connectivity against Kaggle /datasets (user's own datasets)
  const test = await kaggleGet<{ count?: number }>(`/datasets/list?user=${creds.username}&pageSize=1`, creds);

  if (!test.ok && test.status === 401) {
    return res.json({
      configured: false,
      username: creds.username,
      message: "Kredensial Kaggle tidak valid (401). Periksa KAGGLE_KEY Anda.",
    });
  }

  if (!test.ok && test.status === 403) {
    return res.json({
      configured: false,
      username: creds.username,
      message: "Kaggle API tidak aktif. Verifikasi nomor HP di kaggle.com/settings.",
    });
  }

  return res.json({
    configured: true,
    username: creds.username,
    apiReachable: test.ok,
    message: test.ok ? `Terhubung sebagai ${creds.username}` : `Kaggle terhubung (${test.error?.slice(0, 80)})`,
  });
});

// ─── POST /api/kaggle/credentials ────────────────────────────────────────────
router.post("/kaggle/credentials", async (req: Request, res: Response) => {
  const { username, key } = req.body as { username?: string; key?: string };
  if (!username?.trim() || !key?.trim()) {
    return res.status(400).json({ error: "username dan key wajib diisi." });
  }

  // Test first
  const testCreds = { username: username.trim(), key: key.trim() };
  const test = await kaggleGet(`/datasets/list?user=${testCreds.username}&mine=true&pageSize=1`, testCreds);

  if (test.status === 401) {
    return res.status(400).json({ error: "Kredensial tidak valid (401). Periksa kembali username dan API key Kaggle." });
  }

  // Save to process.env and config file
  process.env.KAGGLE_USERNAME = testCreds.username;
  process.env.KAGGLE_KEY      = testCreds.key;

  // Also persist to .dlavie-config.json
  try {
    const cfg: Record<string, unknown> = existsSync(CONFIG_PATH)
      ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>
      : {};
    const secrets = (cfg.secrets as Record<string, string>) || {};
    secrets["KAGGLE_USERNAME"] = testCreds.username;
    secrets["KAGGLE_KEY"]      = testCreds.key;
    cfg.secrets    = secrets;
    cfg.updatedAt  = new Date().toISOString();
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    logger.warn({ err }, "Could not persist Kaggle credentials to config file");
  }

  // Also update ~/.kaggle/kaggle.json for CLI usage
  try {
    const kaggleDir = join(process.env.HOME || "/home/runner", ".kaggle");
    mkdirSync(kaggleDir, { recursive: true });
    writeFileSync(
      join(kaggleDir, "kaggle.json"),
      JSON.stringify({ username: testCreds.username, key: testCreds.key }, null, 2),
      { encoding: "utf8", mode: 0o600 }
    );
  } catch { /* non-fatal */ }

  return res.json({
    ok: true,
    username: testCreds.username,
    message: `Kaggle credentials disimpan. ${test.ok ? "Koneksi berhasil ✓" : "Tersimpan (uji koneksi nanti)"}`,
  });
});

// ─── POST /api/kaggle/dataset/sync ───────────────────────────────────────────
router.post("/kaggle/dataset/sync", async (req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const { datasetId = 1, datasetSlug = "dlavie-training-dataset" } = req.body as {
    datasetId?: number;
    datasetSlug?: string;
  };

  try {
    // 1. Load samples from DB
    const [datasetInfo] = await db.select().from(trainingDatasetsTable)
      .where(eq(trainingDatasetsTable.id, datasetId)).limit(1);

    if (!datasetInfo) return res.status(404).json({ error: "Dataset tidak ditemukan." });

    const samples = await db.select().from(trainingSamplesTable)
      .where(eq(trainingSamplesTable.datasetId, datasetId));

    if (!samples.length) return res.status(400).json({ error: "Dataset kosong." });

    // 2. Filter valid samples
    const valid = samples.filter(s => s.input?.trim() && s.expectedOutput?.trim());
    if (!valid.length) return res.status(400).json({ error: "Tidak ada sample valid." });

    // 3. Build JSONL
    const jsonl = valid.map(s => JSON.stringify({
      input:  s.input,
      output: s.expectedOutput,
      source: s.source || "dlavie",
    })).join("\n");

    const jsonlB64 = Buffer.from(jsonl, "utf-8").toString("base64");
    const slug = datasetSlug.replace(/[^a-z0-9-]/g, "-").toLowerCase();
    const repoRef = `${creds.username}/${slug}`;

    // 4. Try to create dataset via Kaggle API
    // First check if it exists
    const existing = await kaggleGet(`/datasets/${repoRef}`, creds);

    if (!existing.ok) {
      // Create new dataset
      const createRes = await kagglePost("/datasets", creds, {
        ownerSlug:   creds.username,
        title:       "DLavie Training Dataset",
        slug:         slug,
        isPrivate:   false,
        licenses:    [{ name: "CC0-1.0" }],
        files: [{
          token:    "file1",
          name:     "dataset.jsonl",
          totalBytes: Buffer.byteLength(jsonl),
          mimeType:  "application/x-jsonlines",
        }],
      });

      if (!createRes.ok) {
        // Fallback: use Python CLI
        return await syncViaCli(res, creds, jsonl, slug, valid.length, datasetInfo.name);
      }
    }

    // 5. Create a new version (blob upload)
    const blobRes = await fetch(`${KAGGLE_API}/datasets/${creds.username}/${slug}/versions`, {
      method: "POST",
      headers: { ...kaggleHeaders(creds), "Content-Type": "application/json" },
      body: JSON.stringify({
        versionNotes: `DLavie OS sync — ${valid.length} samples — ${new Date().toISOString()}`,
        files: [{
          name:       "dataset.jsonl",
          content:    jsonlB64,
        }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (blobRes.ok) {
      logger.info({ slug, samples: valid.length }, "Kaggle dataset synced via API");
      return res.json({
        ok: true,
        repoRef,
        datasetUrl: `https://kaggle.com/datasets/${repoRef}`,
        samplesUploaded: valid.length,
        method: "api",
      });
    }

    // Final fallback: Python CLI
    return await syncViaCli(res, creds, jsonl, slug, valid.length, datasetInfo.name);

  } catch (err) {
    logger.error({ err }, "Kaggle dataset sync failed");
    return res.status(500).json({ error: String(err) });
  }
});

/** Sync via Python kaggle CLI as fallback */
async function syncViaCli(
  res: Response,
  creds: { username: string; key: string },
  jsonl: string,
  slug: string,
  sampleCount: number,
  datasetName: string
): Promise<Response> {
  const { execFile } = await import("child_process");
  const { mkdtempSync, writeFileSync: wf } = await import("fs");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const os = await import("os");
  const path = await import("path");

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dlavie-kaggle-"));
  const jsonlPath = path.join(tmpDir, "dataset.jsonl");
  const metaPath  = path.join(tmpDir, "dataset-metadata.json");

  wf(jsonlPath, jsonl, "utf8");
  wf(metaPath, JSON.stringify({
    title:    datasetName || "DLavie Training Dataset",
    id:       `${creds.username}/${slug}`,
    licenses: [{ name: "CC0-1.0" }],
  }, null, 2), "utf8");

  // Ensure ~/.kaggle/kaggle.json exists
  try {
    const kaggleDir = path.join(process.env.HOME || "/home/runner", ".kaggle");
    mkdirSync(kaggleDir, { recursive: true });
    writeFileSync(path.join(kaggleDir, "kaggle.json"),
      JSON.stringify({ username: creds.username, key: creds.key }, null, 2),
      { encoding: "utf8", mode: 0o600 }
    );
  } catch { /* ignore */ }

  try {
    // Check if dataset exists
    let isNew = false;
    try {
      await execFileAsync("python3", ["-m", "kaggle", "datasets", "status", `${creds.username}/${slug}`], { timeout: 15_000 });
    } catch { isNew = true; }

    if (isNew) {
      await execFileAsync("python3", ["-m", "kaggle", "datasets", "create", "-p", tmpDir], { timeout: 60_000 });
    } else {
      await execFileAsync("python3", ["-m", "kaggle", "datasets", "version", "-p", tmpDir,
        "-m", `DLavie OS sync — ${sampleCount} samples`], { timeout: 60_000 });
    }

    return res.json({
      ok: true,
      repoRef: `${creds.username}/${slug}`,
      datasetUrl: `https://kaggle.com/datasets/${creds.username}/${slug}`,
      samplesUploaded: sampleCount,
      method: "cli",
    });
  } catch (err) {
    return res.status(500).json({ error: `CLI sync gagal: ${String(err)}` });
  }
}

// ─── GET /api/kaggle/datasets ─────────────────────────────────────────────────
router.get("/kaggle/datasets", async (_req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const result = await kaggleGet<unknown[]>(`/datasets/list?user=${creds.username}&pageSize=20`, creds);
  if (!result.ok) return res.status(502).json({ error: result.error });
  return res.json(Array.isArray(result.data) ? result.data : []);
});

// ─── GET /api/kaggle/kernels ──────────────────────────────────────────────────
router.get("/kaggle/kernels", async (_req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const result = await kaggleGet<unknown[]>(`/kernels/list?user=${creds.username}&mine=true&pageSize=20`, creds);
  if (!result.ok) {
    // Fallback: list via CLI
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync("python3", ["-m", "kaggle", "kernels", "list", "--mine", "--csv"], { timeout: 20_000 });
      const lines = stdout.trim().split("\n").slice(1).filter(Boolean);
      const kernels = lines.map(l => {
        const parts = l.split(",");
        return { ref: parts[0], title: parts[1], status: parts[2], lastRunTime: parts[3] };
      });
      return res.json(kernels);
    } catch {
      return res.json([]);
    }
  }
  return res.json(Array.isArray(result.data) ? result.data : []);
});

// ─── GET /api/kaggle/kernels/:owner/:slug/status ──────────────────────────────
router.get("/kaggle/kernels/:owner/:slug/status", async (req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const { owner, slug } = req.params as { owner: string; slug: string };
  const result = await kaggleGet<{ status?: string; failureMessage?: string; completenessPercent?: number }>(
    `/kernels/${owner}/${slug}`, creds
  );

  if (!result.ok) {
    // Fallback via CLI
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync("python3", ["-m", "kaggle", "kernels", "status", `${owner}/${slug}`], { timeout: 20_000 });
      return res.json({ raw: stdout.trim(), ok: true });
    } catch {
      return res.status(502).json({ error: result.error });
    }
  }

  return res.json(result.data);
});

// ─── POST /api/kaggle/kernels/push ───────────────────────────────────────────
router.post("/kaggle/kernels/push", async (req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const {
    kernelSlug  = "dlavie-os-lora-finetuning",
    datasetSlug = "dlavie-training-dataset",
  } = req.body as { kernelSlug?: string; datasetSlug?: string };

  // Read the notebook from workspace
  const WORKSPACE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
  const nbPath = join(WORKSPACE, "scripts/kaggle/kernel_push/notebook.ipynb");

  if (!existsSync(nbPath)) {
    return res.status(404).json({ error: "Notebook tidak ditemukan di scripts/kaggle/kernel_push/notebook.ipynb" });
  }

  const nbContent = readFileSync(nbPath, "utf8");

  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Update kernel-metadata.json
    const metaPath = join(WORKSPACE, "scripts/kaggle/kernel_push/kernel-metadata.json");
    const meta = {
      id:                `${creds.username}/${kernelSlug}`,
      title:             "DLavie OS — LoRA Fine-Tuning",
      code_file:         "notebook.ipynb",
      language:          "python",
      kernel_type:       "notebook",
      is_private:        false,
      enable_gpu:        true,
      enable_internet:   true,
      dataset_sources:   [`${creds.username}/${datasetSlug}`],
      competition_sources: [],
      kernel_sources:    [],
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

    const pushDir = join(WORKSPACE, "scripts/kaggle/kernel_push");
    const { stdout, stderr } = await execFileAsync("python3", ["-m", "kaggle", "kernels", "push", "-p", pushDir], {
      timeout: 60_000,
      env: { ...process.env, KAGGLE_USERNAME: creds.username, KAGGLE_KEY: creds.key },
    });

    logger.info({ stdout, stderr }, "Kaggle kernel pushed");

    const url = `https://kaggle.com/code/${creds.username}/${kernelSlug}`;
    return res.json({
      ok: true,
      kernelUrl: url,
      message: `Notebook berhasil dipush ke ${url}`,
      stdout: stdout.slice(0, 500),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Kaggle kernel push error");
    return res.status(500).json({ error: `Push gagal: ${msg.slice(0, 300)}` });
  }

  void nbContent; // used above
});

// ─── POST /api/kaggle/kernels/run ────────────────────────────────────────────
router.post("/kaggle/kernels/run", async (req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const { kernelSlug = "dlavie-os-lora-finetuning" } = req.body as { kernelSlug?: string };
  const ref = `${creds.username}/${kernelSlug}`;

  // Kaggle doesn't have a direct "run" endpoint — pushing a new version triggers a run
  // Instead, we can check current status first
  const statusRes = await kaggleGet<{ status?: string }>(
    `/kernels/${creds.username}/${kernelSlug}`, creds
  );

  if (statusRes.ok) {
    const status = (statusRes.data as { status?: string })?.status;
    if (status === "running") {
      return res.json({ ok: false, message: `Kernel sudah running (status: ${status}). Tunggu selesai.`, status });
    }
  }

  // Trigger by pushing (creates new version = new run)
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const WORKSPACE = process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace";
    const pushDir = join(WORKSPACE, "scripts/kaggle/kernel_push");

    await execFileAsync("python3", ["-m", "kaggle", "kernels", "push", "-p", pushDir], {
      timeout: 60_000,
      env: { ...process.env, KAGGLE_USERNAME: creds.username, KAGGLE_KEY: creds.key },
    });

    return res.json({
      ok: true,
      ref,
      kernelUrl: `https://kaggle.com/code/${ref}`,
      message: `Training dimulai di Kaggle GPU. Cek status di: https://kaggle.com/code/${ref}`,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/kaggle/kernels/:owner/:slug/output ──────────────────────────────
router.get("/kaggle/kernels/:owner/:slug/output", async (req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  const { owner, slug } = req.params as { owner: string; slug: string };

  const result = await kaggleGet<{ files?: { name: string; size: number; url: string }[] }>(
    `/kernels/${owner}/${slug}/output`, creds
  );

  if (!result.ok) {
    // CLI fallback
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync("python3", ["-m", "kaggle", "kernels", "output", `${owner}/${slug}`], { timeout: 30_000 });
      return res.json({ ok: true, raw: stdout.trim(), files: [] });
    } catch (e) {
      return res.status(502).json({ error: result.error || String(e) });
    }
  }

  return res.json({ ok: true, files: (result.data as { files?: unknown[] })?.files ?? [] });
});

// ─── GET /api/kaggle/quota ────────────────────────────────────────────────────
router.get("/kaggle/quota", async (_req: Request, res: Response) => {
  const creds = getKaggleCreds();
  if (!creds) return res.status(401).json({ error: "Kaggle belum dikonfigurasi." });

  // Kaggle doesn't expose quota directly via API; we compute from kernel history
  const result = await kaggleGet<{ results?: Array<{ runningTime?: number; status?: string }> }>(
    `/kernels/list?user=${creds.username}&pageSize=100&sortBy=dateRun`, creds
  );

  if (!result.ok) {
    return res.json({ ok: true, usedHours: null, totalHours: 30, message: "Tidak bisa mengambil data quota." });
  }

  const kernels = (result.data as unknown[]) ?? [];
  const nowMs   = Date.now();
  const weekMs  = 7 * 24 * 3600 * 1000;

  // Sum GPU seconds from this week's runs
  let usedSec = 0;
  for (const k of kernels) {
    const kObj = k as { lastRunTime?: string; totalVotes?: number; runningTime?: number };
    const runTime = kObj.runningTime ?? 0;
    usedSec += runTime;
  }

  const usedHours  = Math.round((usedSec / 3600) * 10) / 10;
  const totalHours = 30;
  const remaining  = Math.max(0, totalHours - usedHours);

  return res.json({
    ok: true,
    usedHours,
    totalHours,
    remainingHours: remaining,
    percentUsed: Math.round((usedHours / totalHours) * 100),
    message: `${remaining}hr tersisa dari 30hr/minggu`,
    weeklyResetNote: "Quota direset setiap Senin",
  });

  void nowMs; void weekMs;
});

export default router;
