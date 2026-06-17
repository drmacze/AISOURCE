/**
 * DLavie OS — Uptime Monitoring API
 *
 * GET  /api/uptime          — full always-on system status + all service states
 * GET  /api/uptime/ping     — lightweight liveness probe (for external monitors)
 * GET  /api/uptime/services — per-service health breakdown
 * GET  /api/uptime/memory   — memory usage history (last 5 hours)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { getUptimeStats } from "../always-on.js";

const router: IRouter = Router();

// ─── GET /uptime — full status dashboard ────────────────────────────────────
router.get("/uptime", (_req: Request, res: Response) => {
  const data = getUptimeStats();
  const uptimeSec = Math.floor((Date.now() - data.startedAt) / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;

  const services = Object.values(data.services);
  const healthy = services.filter((s) => s.status === "ok").length;
  const degraded = services.filter((s) => s.status === "warn").length;
  const dead = services.filter((s) => s.status === "dead").length;

  const overallStatus =
    dead > 0 ? "degraded" : degraded > 2 ? "degraded" : "healthy";

  res.json({
    status: overallStatus,
    uptime: {
      seconds: uptimeSec,
      human: `${h}h ${m}m ${s}s`,
      startedAt: new Date(data.startedAt).toISOString(),
    },
    selfPinger: {
      pings: data.selfPings,
      fails: data.selfPingFails,
      successRate:
        data.selfPings + data.selfPingFails === 0
          ? "n/a"
          : `${Math.round((data.selfPings / (data.selfPings + data.selfPingFails)) * 100)}%`,
      targetUrl: data.publicUrl ? `${data.publicUrl}/api/health` : "not set",
    },
    database: {
      keepalives: data.dbKeepalives,
      fails: data.dbKeepaliveFails,
    },
    services: {
      summary: { healthy, degraded, dead, total: services.length },
      detail: data.services,
    },
    memory: {
      current: (() => {
        const m = process.memoryUsage();
        return {
          heapMb: Math.round(m.heapUsed / 1_048_576),
          heapTotalMb: Math.round(m.heapTotal / 1_048_576),
          rssMb: Math.round(m.rss / 1_048_576),
          externalMb: Math.round(m.external / 1_048_576),
        };
      })(),
      history: data.memSamples.slice(-12),
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
      totalRestarts: data.totalRestarts,
    },
    lastHeartbeat: new Date(data.lastHeartbeat).toISOString(),
    alwaysOnLayers: [
      "Self-Pinger (4 min)",
      "Service Watchdog (3 min)",
      "DB Keepalive (10 min)",
      "Process Hardener",
      "Memory Guardian (5 min)",
      "Provider Circuit Reset (20 min)",
      "Ollama Deep Watchdog (15 min)",
      "Heartbeat Logger (60s)",
      "Event Loop Guard (90s)",
      "External Ping Instructions",
    ],
  });
});

// ─── GET /uptime/ping — ultra-lightweight liveness probe ─────────────────────
// Use this URL in UptimeRobot / BetterUptime / Freshping
// Response: 200 OK, {"alive":true,"ts":...}
router.get("/uptime/ping", (_req: Request, res: Response) => {
  res.json({ alive: true, ts: Date.now(), uptime: Math.floor(process.uptime()) });
});

// ─── GET /uptime/services — per-service detail ───────────────────────────────
router.get("/uptime/services", (_req: Request, res: Response) => {
  const { services } = getUptimeStats();
  res.json({ services, count: Object.keys(services).length });
});

// ─── GET /uptime/memory — memory history (last 5 hours = 60 samples) ─────────
router.get("/uptime/memory", (_req: Request, res: Response) => {
  const { memSamples } = getUptimeStats();
  const mem = process.memoryUsage();
  res.json({
    current: {
      heapMb: Math.round(mem.heapUsed / 1_048_576),
      heapTotalMb: Math.round(mem.heapTotal / 1_048_576),
      rssMb: Math.round(mem.rss / 1_048_576),
    },
    history: memSamples,
    samples: memSamples.length,
    spanMinutes: memSamples.length * 5,
  });
});

export default router;
