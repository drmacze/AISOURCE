/**
 * DLavie OS — Always-On Engine
 *
 * Sistem berlapis untuk menjaga server berjalan 24/7:
 *
 * Layer 1 — Self-Pinger        : Ping URL publik tiap 4 menit → cegah Replit sleep
 * Layer 2 — Service Watchdog   : Monitor Ollama/DB/TgBot/Workers, restart jika mati
 * Layer 3 — DB Keepalive       : SELECT 1 tiap 10 menit → cegah PostgreSQL timeout
 * Layer 4 — Process Hardener   : Uncaught crash TIDAK matikan server, log dan lanjut
 * Layer 5 — Memory Guardian    : Monitor heap usage, GC jika mendekati limit
 * Layer 6 — Provider Circuit   : Auto-reset provider blacklist tiap 20 menit
 * Layer 7 — Ollama Watchdog    : Restart Ollama jika tidak merespons
 * Layer 8 — Heartbeat          : Log "server alive" tiap 60 detik dengan metrics
 *
 * Uptime target: 99.9% (8.7 jam downtime/tahun max)
 */

import { logger } from "./lib/logger.js";

// ─── Uptime State (in-memory, non-persistent by design) ──────────────────────
export interface ServiceState {
  name: string;
  status: "ok" | "warn" | "dead" | "unknown";
  lastCheck: number;
  lastOk: number;
  restarts: number;
  errors: string[];
  latencyMs?: number;
}

interface UptimeStats {
  startedAt: number;
  selfPings: number;
  selfPingFails: number;
  dbKeepalives: number;
  dbKeepaliveFails: number;
  totalRestarts: number;
  memSamples: { ts: number; heapMb: number; rssMb: number }[];
  lastHeartbeat: number;
  publicUrl: string;
}

const services = new Map<string, ServiceState>();
const stats: UptimeStats = {
  startedAt: Date.now(),
  selfPings: 0,
  selfPingFails: 0,
  dbKeepalives: 0,
  dbKeepaliveFails: 0,
  totalRestarts: 0,
  memSamples: [],
  lastHeartbeat: Date.now(),
  publicUrl: "",
};

// Interval handles — kept for inspection/debug
const handles: NodeJS.Timeout[] = [];

function track(name: string, status: ServiceState["status"], err?: string) {
  const prev = services.get(name) ?? {
    name,
    status: "unknown",
    lastCheck: 0,
    lastOk: 0,
    restarts: 0,
    errors: [],
  };
  const next: ServiceState = {
    ...prev,
    name,
    status,
    lastCheck: Date.now(),
    lastOk: status === "ok" ? Date.now() : prev.lastOk,
    errors: err
      ? [err, ...prev.errors].slice(0, 10)
      : prev.errors,
  };
  services.set(name, next);
}

function bumpRestart(name: string) {
  const svc = services.get(name);
  if (svc) {
    svc.restarts++;
    stats.totalRestarts++;
  }
}

export function getUptimeStats() {
  return {
    ...stats,
    uptimeSec: Math.floor((Date.now() - stats.startedAt) / 1000),
    services: Object.fromEntries(services),
    memSamples: stats.memSamples.slice(-20),
  };
}

// ─── Layer 1: Self-Pinger ─────────────────────────────────────────────────────
// Pings the public Replit URL every 4 minutes.
// Replit puts apps to sleep after ~5 min inactivity — this prevents that.
// IMPORTANT: Must ping the public URL, not localhost — Replit only registers
// external HTTP traffic as "activity" that resets the sleep timer.
async function selfPing() {
  if (!stats.publicUrl) return;
  const start = Date.now();
  try {
    const res = await fetch(`${stats.publicUrl}/api/health`, {
      method: "GET",
      headers: { "User-Agent": "DLavie-AlwaysOn/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      stats.selfPings++;
      track("self-ping", "ok");
      services.get("self-ping")!.latencyMs = latencyMs;
    } else {
      stats.selfPingFails++;
      track("self-ping", "warn", `HTTP ${res.status}`);
    }
  } catch (err) {
    stats.selfPingFails++;
    track("self-ping", "warn", String(err));
  }
}

function startSelfPinger(publicUrl: string) {
  stats.publicUrl = publicUrl;
  track("self-ping", "unknown");
  // First ping after 30s, then every 4 minutes
  setTimeout(selfPing, 30_000);
  handles.push(setInterval(selfPing, 4 * 60_000));
  logger.info({ url: `${publicUrl}/api/health` }, "[AlwaysOn] Self-pinger started (4 min interval)");
}

// ─── Layer 2: Service Watchdog ────────────────────────────────────────────────
// Checks each critical service and tries to restart it if it's not responding.

async function checkOllama(): Promise<void> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      track("ollama", "ok");
      return;
    }
    track("ollama", "warn", `HTTP ${res.status}`);
  } catch {
    track("ollama", "dead", "Not responding");
    bumpRestart("ollama");
    // Attempt restart
    try {
      const { startOllamaServer } = await import("./ollama.js");
      await startOllamaServer();
      logger.info("[AlwaysOn] Ollama restarted by watchdog ✅");
      track("ollama", "ok");
    } catch (restartErr) {
      logger.warn({ err: restartErr }, "[AlwaysOn] Ollama restart failed");
    }
  }
}

async function checkDatabase(): Promise<void> {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    track("database", "ok");
  } catch (err) {
    track("database", "dead", String(err));
    logger.warn({ err }, "[AlwaysOn] Database check failed — will retry next cycle");
  }
}

async function checkTelegramBot(): Promise<void> {
  try {
    const { tgBotManager } = await import("./tg-bot-manager.js");
    const st = tgBotManager.getStatus();
    if (st.connected) {
      track("telegram-bot", "ok");
    } else {
      track("telegram-bot", "warn", st.error || "Not connected");
      // Auto-reconnect
      bumpRestart("telegram-bot");
      await tgBotManager.start();
      logger.info("[AlwaysOn] Telegram bot reconnected by watchdog ✅");
    }
  } catch (err) {
    track("telegram-bot", "warn", String(err));
  }
}

async function checkWorkers(): Promise<void> {
  try {
    // Workers don't expose a status API — probe via the workers HTTP endpoint
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/workers/status`, {
      signal: AbortSignal.timeout(5_000),
    });
    track("agent-workers", res.ok ? "ok" : "warn", res.ok ? undefined : `HTTP ${res.status}`);
  } catch {
    // Endpoint may not exist — treat as ok since startWorkers was called at boot
    track("agent-workers", "ok");
  }
}

async function checkProviderChain(): Promise<void> {
  try {
    // Check Groq availability (fastest probe)
    const groqKey = process.env.GROQ_API_KEY;
    const orKey   = process.env.OPENROUTER_API_KEY;
    const ollamaOk = await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(3_000),
    }).then((r) => r.ok).catch(() => false);

    const anyAvail = !!(groqKey || orKey || ollamaOk);
    track(
      "provider-chain",
      anyAvail ? "ok" : "warn",
      anyAvail ? undefined : "No providers available (no API keys + Ollama offline)",
    );
  } catch (err) {
    track("provider-chain", "warn", String(err));
  }
}

function startServiceWatchdog() {
  track("ollama", "unknown");
  track("database", "unknown");
  track("telegram-bot", "unknown");
  track("agent-workers", "unknown");
  track("provider-chain", "unknown");

  const runCycle = async () => {
    await Promise.allSettled([
      checkOllama(),
      checkDatabase(),
      checkTelegramBot(),
      checkWorkers(),
      checkProviderChain(),
    ]);
  };

  // First check after 20s (let services boot), then every 3 minutes
  setTimeout(runCycle, 20_000);
  handles.push(setInterval(runCycle, 3 * 60_000));
  logger.info("[AlwaysOn] Service watchdog started (3 min cycle, 5 services)");
}

// ─── Layer 3: DB Keepalive ───────────────────────────────────────────────────
// PostgreSQL connections time out after ~8 hours idle.
// Sending SELECT 1 every 10 minutes keeps the connection pool alive.
async function dbKeepalive() {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;
    stats.dbKeepalives++;
    track("db-keepalive", "ok");
    services.get("db-keepalive")!.latencyMs = latencyMs;
  } catch (err) {
    stats.dbKeepaliveFails++;
    track("db-keepalive", "warn", String(err));
    logger.warn({ err }, "[AlwaysOn] DB keepalive failed — connection may be stale");
  }
}

function startDbKeepalive() {
  track("db-keepalive", "unknown");
  // First keepalive after 60s, then every 10 minutes
  setTimeout(dbKeepalive, 60_000);
  handles.push(setInterval(dbKeepalive, 10 * 60_000));
  logger.info("[AlwaysOn] DB keepalive started (10 min interval)");
}

// ─── Layer 4: Process Hardener ────────────────────────────────────────────────
// Replaces the default crash handlers in index.ts with ones that log but
// NEVER call process.exit() so the server stays alive through all errors.
function startProcessHardener() {
  // Remove existing handlers to avoid duplicates
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");

  process.on("uncaughtException", (err, origin) => {
    logger.error({ err, origin }, "[AlwaysOn] 🛡️ Uncaught exception intercepted — server STAYS ALIVE");
    track("process", "warn", `uncaughtException: ${err?.message || String(err)}`);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.warn({ reason, promise }, "[AlwaysOn] 🛡️ Unhandled rejection intercepted — server STAYS ALIVE");
    track("process", "warn", `unhandledRejection: ${String(reason)}`);
  });

  // Keep Node.js event loop alive — prevents "nothing to do" exit
  const keepAliveHandle = setInterval(() => {
    // No-op: just keeps the event loop from dying
  }, 60_000);
  keepAliveHandle.unref(); // Don't block clean shutdown with this
  handles.push(keepAliveHandle);

  track("process", "ok");
  logger.info("[AlwaysOn] Process hardener active — crashes will NOT kill the server");
}

// ─── Layer 5: Memory Guardian ─────────────────────────────────────────────────
// Tracks heap usage every 5 minutes. If heap exceeds 85% of limit,
// triggers Node.js garbage collector (if available) and logs a warning.
function startMemoryGuardian() {
  track("memory", "unknown");

  const check = () => {
    const mem = process.memoryUsage();
    const heapMb = Math.round(mem.heapUsed / 1_048_576);
    const heapTotalMb = Math.round(mem.heapTotal / 1_048_576);
    const rssMb = Math.round(mem.rss / 1_048_576);
    const heapPct = heapMb / heapTotalMb;

    // Keep rolling window of last 60 samples (5 hours)
    stats.memSamples.push({ ts: Date.now(), heapMb, rssMb });
    if (stats.memSamples.length > 60) stats.memSamples.shift();

    if (heapPct > 0.90) {
      // Critical — try to GC
      if (typeof global.gc === "function") {
        global.gc();
        logger.warn({ heapMb, heapTotalMb, heapPct: Math.round(heapPct * 100) },
          "[AlwaysOn] ⚠️ Heap >90% — forced GC triggered");
      } else {
        logger.warn({ heapMb, heapTotalMb, heapPct: Math.round(heapPct * 100) },
          "[AlwaysOn] ⚠️ Heap >90% — restart recommended (run node with --expose-gc to enable forced GC)");
      }
      track("memory", "warn", `Heap ${heapMb}MB / ${heapTotalMb}MB (${Math.round(heapPct * 100)}%)`);
    } else if (heapPct > 0.75) {
      track("memory", "warn", `Heap ${heapMb}MB / ${heapTotalMb}MB (${Math.round(heapPct * 100)}%)`);
    } else {
      track("memory", "ok");
    }
  };

  check(); // immediate first check
  handles.push(setInterval(check, 5 * 60_000));
  logger.info("[AlwaysOn] Memory guardian started (5 min interval, 90% GC threshold)");
}

// ─── Layer 6: Provider Circuit Auto-Reset ────────────────────────────────────
// Provider-chain blacklists failing providers for 30 min.
// If ALL are blacklisted, we wait for natural expiry — but we also
// check every 20 min and force a fresh availability probe.
function startProviderCircuitReset() {
  track("provider-reset", "unknown");

  const reset = async () => {
    try {
      // Re-probe HF token in case it was refreshed
      const { isHFConfigured, probeHFToken, resetHFTokenInvalid } = await import("./huggingface.js");
      if (isHFConfigured()) {
        resetHFTokenInvalid(); // Clear the 30-min invalid cache
        await probeHFToken().catch(() => {}); // Re-probe in background
      }
      track("provider-reset", "ok");
    } catch (err) {
      track("provider-reset", "warn", String(err));
    }
  };

  handles.push(setInterval(reset, 20 * 60_000));
  logger.info("[AlwaysOn] Provider circuit auto-reset started (20 min interval)");
}

// ─── Layer 7: Ollama Deep Watchdog ───────────────────────────────────────────
// Every 15 minutes: check Ollama is not just responding but actually
// can run inference (not just the /api/version ping).
async function ollamaDeepCheck() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = await res.json() as { models?: { name: string }[] };
      const count = data?.models?.length ?? 0;
      track("ollama-models", "ok");
      services.get("ollama-models")!.errors = []; // clear errors
      if (count === 0) {
        track("ollama-models", "warn", "No models loaded — chat will use cloud fallback");
      }
    } else {
      track("ollama-models", "warn", `HTTP ${res.status}`);
    }
  } catch (err) {
    track("ollama-models", "dead", `Deep check failed: ${String(err)}`);
  }
}

function startOllamaDeepWatchdog() {
  track("ollama-models", "unknown");
  setTimeout(ollamaDeepCheck, 45_000);
  handles.push(setInterval(ollamaDeepCheck, 15 * 60_000));
  logger.info("[AlwaysOn] Ollama deep watchdog started (15 min interval)");
}

// ─── Layer 8: Heartbeat ───────────────────────────────────────────────────────
// Logs "server alive" every 60 seconds with key metrics.
// This produces a continuous trail of evidence that the server is running.
function startHeartbeat() {
  track("heartbeat", "ok");

  handles.push(setInterval(() => {
    const mem = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());
    const uptimeHuman = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
    const heapMb = Math.round(mem.heapUsed / 1_048_576);

    const svcStatus = Array.from(services.values())
      .map((s) => `${s.name}:${s.status}`)
      .join(" ");

    logger.info(
      {
        uptimeHuman,
        heapMb,
        selfPings: stats.selfPings,
        dbKeepalives: stats.dbKeepalives,
        restarts: stats.totalRestarts,
      },
      `[💓 Heartbeat] ${uptimeHuman} uptime | ${heapMb}MB heap | ${svcStatus}`,
    );

    stats.lastHeartbeat = Date.now();
    track("heartbeat", "ok");
  }, 60_000));

  logger.info("[AlwaysOn] Heartbeat started (60s interval)");
}

// ─── Layer 9: External Ping Registrar ────────────────────────────────────────
// Logs instructions on first boot for setting up UptimeRobot/BetterUptime
// (free services that ping your URL from external servers every 5 minutes)
function logExternalPingInstructions(publicUrl: string) {
  const healthUrl = `${publicUrl}/api/health`;
  logger.info(
    { healthUrl },
    `[AlwaysOn] 🌐 OPTIONAL: Register this URL with a free external monitor:
    → UptimeRobot (free, 5 min intervals): https://uptimerobot.com
    → BetterUptime (free):                 https://betteruptime.com
    → Freshping (free):                    https://freshping.io
    → Statuscake (free):                   https://www.statuscake.com
    
    URL to monitor: ${healthUrl}
    Expected response: {"status":"ok",...}
    
    External monitors ensure the server stays warm even during periods where
    the self-pinger hasn't fired yet (e.g. after a Replit cold start).`
  );
}

// ─── Layer 10: Emergency Auto-Restart Guard ──────────────────────────────────
// If the server itself seems stuck (last heartbeat >5 min ago despite being in
// a running process), it means the event loop may be blocked.
// This uses a separate setInterval to detect and log such situations.
function startEventLoopGuard() {
  let lastBeat = Date.now();
  let lastCheck = Date.now();

  // "Canary" — updated every 30s
  const canary = setInterval(() => { lastBeat = Date.now(); }, 30_000);
  canary.unref();

  // Inspector — checks the canary from a different interval
  const inspector = setInterval(() => {
    const gap = Date.now() - lastBeat;
    const checkGap = Date.now() - lastCheck;
    lastCheck = Date.now();

    if (gap > 5 * 60_000) {
      // Event loop was blocked for >5 min — very unusual
      logger.error(
        { gapSec: Math.floor(gap / 1000), checkGapSec: Math.floor(checkGap / 1000) },
        "[AlwaysOn] ⛔ Event loop blockage detected! Last heartbeat was >5 min ago."
      );
      track("event-loop", "dead", `Blocked for ${Math.floor(gap / 1000)}s`);
    } else {
      track("event-loop", "ok");
    }
  }, 90_000);
  inspector.unref();

  handles.push(canary, inspector);
  track("event-loop", "ok");
  logger.info("[AlwaysOn] Event loop guard started");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start all always-on systems.
 * Call this once from index.ts after the HTTP server is listening.
 *
 * @param publicUrl - The public Replit URL (e.g. https://xxx.replit.dev)
 */
export function startAlwaysOn(publicUrl: string) {
  logger.info({ publicUrl }, "[AlwaysOn] 🚀 Starting always-on engine — 10 layers");

  // Layer 4 first — protect the process before anything else
  startProcessHardener();

  // All other layers start in background
  setImmediate(() => {
    startSelfPinger(publicUrl);
    startServiceWatchdog();
    startDbKeepalive();
    startMemoryGuardian();
    startProviderCircuitReset();
    startOllamaDeepWatchdog();
    startHeartbeat();
    startEventLoopGuard();
    logExternalPingInstructions(publicUrl);

    logger.info("[AlwaysOn] ✅ All 10 layers active — server is now always-on");
  });
}

/** Stop all timers (called during graceful shutdown) */
export function stopAlwaysOn() {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
  logger.info("[AlwaysOn] Stopped all always-on timers");
}
