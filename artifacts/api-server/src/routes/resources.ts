/**
 * DLavie OS — Real System Resource Monitor
 *
 * GET /api/system/resources
 *   Reads actual kernel stats — NO simulation, NO mocking.
 *   Sources:
 *     RAM  → /proc/meminfo
 *     CPU  → /proc/stat (two samples 600ms apart → real usage %)
 *     Disk → fs.statfs() on /home/runner/workspace
 *     Proc → /proc/<pid>/status for the API server process
 */

import { Router, type IRouter } from "express";
import { readFileSync } from "fs";
import { statfs } from "fs/promises";
import { cpus, uptime } from "os";

const router: IRouter = Router();

// ── /proc/meminfo parser ──────────────────────────────────────────────────────
function readMeminfo(): Record<string, number> {
  const raw = readFileSync("/proc/meminfo", "utf8");
  const result: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) result[m[1]] = parseInt(m[2], 10); // values in kB
  }
  return result;
}

// ── /proc/stat CPU sample ─────────────────────────────────────────────────────
interface CpuSample { user: number; nice: number; system: number; idle: number; iowait: number; irq: number; softirq: number; total: number }

function readCpuSample(): CpuSample {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0]; // "cpu  ..."
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq] = parts;
  const total = parts.reduce((a, b) => a + b, 0);
  return { user, nice, system, idle: idle + (iowait || 0), iowait: iowait || 0, irq: irq || 0, softirq: softirq || 0, total };
}

function cpuPercent(a: CpuSample, b: CpuSample): number {
  const totalDelta = b.total - a.total;
  const idleDelta  = b.idle  - a.idle;
  if (totalDelta === 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
}

// ── Per-process memory for THIS process ──────────────────────────────────────
function selfMemMB(): number {
  try {
    const status = readFileSync(`/proc/${process.pid}/status`, "utf8");
    const m = status.match(/VmRSS:\s+(\d+)/);
    return m ? Math.round(parseInt(m[1], 10) / 1024) : 0;
  } catch { return 0; }
}

// ── Route ─────────────────────────────────────────────────────────────────────
async function getResources(res: import("express").Response) {
  try {
    // CPU: two samples 600ms apart for real usage
    const cpuA = readCpuSample();
    await new Promise<void>((r) => setTimeout(r, 600));
    const cpuB = readCpuSample();
    const cpuUsagePercent = cpuPercent(cpuA, cpuB);
    const coreCount = cpus().length;
    const coreInfo = cpus().map((c) => ({ model: c.model.trim(), speedMHz: c.speed }));

    // RAM from /proc/meminfo (kB → MB)
    const mem = readMeminfo();
    const ramTotalMB  = Math.round((mem["MemTotal"]     || 0) / 1024);
    const ramFreeMB   = Math.round((mem["MemFree"]      || 0) / 1024);
    const ramAvailMB  = Math.round((mem["MemAvailable"] || 0) / 1024);
    const ramCachedMB = Math.round(((mem["Cached"] || 0) + (mem["Buffers"] || 0)) / 1024);
    const ramUsedMB   = ramTotalMB - ramFreeMB;
    const ramUsedPercent = ramTotalMB > 0 ? Math.round((ramUsedMB / ramTotalMB) * 100) : 0;
    const swapTotalMB = Math.round((mem["SwapTotal"] || 0) / 1024);
    const swapUsedMB  = Math.round(((mem["SwapTotal"] || 0) - (mem["SwapFree"] || 0)) / 1024);

    // Disk via fs.statfs (real kernel call — no spawning)
    const diskPath = process.env.REPL_HOME || "/home/runner/workspace";
    const st = await statfs(diskPath);
    const diskTotalGB  = Math.round((st.bsize * st.blocks)  / 1073741824 * 10) / 10;
    const diskFreeGB   = Math.round((st.bsize * st.bavail)  / 1073741824 * 10) / 10;
    const diskUsedGB   = Math.round((diskTotalGB - diskFreeGB) * 10) / 10;
    const diskUsedPercent = diskTotalGB > 0 ? Math.round((diskUsedGB / diskTotalGB) * 100) : 0;

    // API server process memory
    const processMB = selfMemMB();

    // System uptime (seconds)
    const systemUptimeSec = Math.round(uptime());
    const processUptimeSec = Math.round(process.uptime());

    res.json({
      cpu: {
        usagePercent: cpuUsagePercent,
        cores: coreCount,
        model: coreInfo[0]?.model || "Unknown",
        speedMHz: coreInfo[0]?.speedMHz || 0,
      },
      ram: {
        totalMB: ramTotalMB,
        usedMB: ramUsedMB,
        freeMB: ramFreeMB,
        availableMB: ramAvailMB,
        cachedMB: ramCachedMB,
        usedPercent: ramUsedPercent,
        swap: { totalMB: swapTotalMB, usedMB: swapUsedMB },
      },
      disk: {
        path: diskPath,
        totalGB: diskTotalGB,
        usedGB: diskUsedGB,
        freeGB: diskFreeGB,
        usedPercent: diskUsedPercent,
      },
      process: {
        pid: process.pid,
        memoryMB: processMB,
        uptimeSec: processUptimeSec,
        nodeVersion: process.version,
      },
      system: {
        uptimeSec: systemUptimeSec,
      },
      ts: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}

router.get("/system/resources", (_req, res) => getResources(res));
router.get("/resources", (_req, res) => getResources(res));

export default router;
