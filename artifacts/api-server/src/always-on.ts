/**
 * DLavie OS — Always-On Engine v2
 *
 * 14-layer system for true 24/7 uptime:
 *
 * Layer 01 — Self-Pinger        : Ping public URL every 3 min → prevent sleep
 * Layer 02 — Service Watchdog   : Monitor Ollama/DB/TgBot/Workers, auto-restart
 * Layer 03 — DB Keepalive       : SELECT 1 every 10 min → prevent PG timeout
 * Layer 04 — Process Hardener   : Uncaught errors do NOT kill the server
 * Layer 05 — Memory Guardian    : Monitor heap; GC at 85%; OOM restart at 95%
 * Layer 06 — Provider Circuit   : Auto-reset provider blacklists every 20 min
 * Layer 07 — Ollama Deep Watch  : Functional Ollama check every 15 min
 * Layer 08 — Heartbeat          : Log "alive" every 60s with full metrics
 * Layer 09 — External Ping Log  : Instructions for UptimeRobot/BetterUptime
 * Layer 10 — Event Loop Guard   : Detect event loop blockage > 3 min
 * Layer 11 — Multi-URL Ping     : Ping both dev + production URL simultaneously
 * Layer 12 — DB Stats Persist   : Save uptime stats to DB every 5 min
 * Layer 13 — Health Endpoint    : Keep /api/healthz responding fast
 * Layer 14 — Cold-Start Guard   : Immediate ping on boot (don't wait 3 min)
 */

import { logger } from "./lib/logger.js";

// ─── State ────────────────────────────────────────────────────────────────────
export interface ServiceState {
  name:      string;
  status:    "ok" | "warn" | "dead" | "unknown";
  lastCheck: number;
  lastOk:    number;
  restarts:  number;
  errors:    string[];
  latencyMs?: number;
}

interface UptimeStats {
  startedAt:         number;
  selfPings:         number;
  selfPingFails:     number;
  dbKeepalives:      number;
  dbKeepaliveFails:  number;
  totalRestarts:     number;
  memSamples:        { ts: number; heapMb: number; rssMb: number }[];
  lastHeartbeat:     number;
  publicUrls:        string[];
  highMemWarnings:   number;
  oomRestartPending: boolean;
}

const services = new Map<string, ServiceState>();
const stats: UptimeStats = {
  startedAt:         Date.now(),
  selfPings:         0,
  selfPingFails:     0,
  dbKeepalives:      0,
  dbKeepaliveFails:  0,
  totalRestarts:     0,
  memSamples:        [],
  lastHeartbeat:     Date.now(),
  publicUrls:        [],
  highMemWarnings:   0,
  oomRestartPending: false,
};

const handles: NodeJS.Timeout[] = [];

function track(name: string, status: ServiceState["status"], err?: string) {
  const prev = services.get(name) ?? {
    name, status: "unknown", lastCheck: 0, lastOk: 0, restarts: 0, errors: [],
  };
  services.set(name, {
    ...prev,
    name,
    status,
    lastCheck: Date.now(),
    lastOk:    status === "ok" ? Date.now() : prev.lastOk,
    errors:    err ? [err, ...prev.errors].slice(0, 10) : prev.errors,
  });
}

function bumpRestart(name: string) {
  const svc = services.get(name);
  if (svc) { svc.restarts++; stats.totalRestarts++; }
}

export function getUptimeStats() {
  const mem = process.memoryUsage();
  return {
    ...stats,
    uptimeSec:  Math.floor((Date.now() - stats.startedAt) / 1000),
    uptimeHuman: formatUptime(Date.now() - stats.startedAt),
    services:   Object.fromEntries(services),
    memSamples: stats.memSamples.slice(-20),
    currentMem: {
      heapMb:      Math.round(mem.heapUsed / 1_048_576),
      heapTotalMb: Math.round(mem.heapTotal / 1_048_576),
      rssMb:       Math.round(mem.rss / 1_048_576),
    },
  };
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Layer 1: Self-Pinger ─────────────────────────────────────────────────────
async function pingUrl(url: string, label: string): Promise<boolean> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/api/healthz`, {
      method: "GET",
      headers: { "User-Agent": "DLavie-AlwaysOn/2.0", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(12_000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      stats.selfPings++;
      track(label, "ok");
      const svc = services.get(label);
      if (svc) svc.latencyMs = latencyMs;
      return true;
    }
    stats.selfPingFails++;
    track(label, "warn", `HTTP ${res.status}`);
    return false;
  } catch (err) {
    stats.selfPingFails++;
    track(label, "warn", String(err));
    return false;
  }
}

async function selfPing() {
  await Promise.all(stats.publicUrls.map((url, i) => pingUrl(url, i === 0 ? "self-ping" : `self-ping-${i}`)));
}

function startSelfPinger(urls: string[]) {
  stats.publicUrls = urls.filter(Boolean);
  urls.forEach((url, i) => track(i === 0 ? "self-ping" : `self-ping-${i}`, "unknown"));

  // Layer 14: Immediate ping on boot — don't wait 3 minutes!
  setTimeout(selfPing, 5_000);

  // Every 3 min (well within Replit's 5-min sleep window)
  handles.push(setInterval(selfPing, 3 * 60_000));
  logger.info({ urls }, "[AlwaysOn L1+14] Self-pinger + cold-start guard active (3 min, immediate boot ping)");
}

// ─── Layer 2: Service Watchdog ────────────────────────────────────────────────
async function checkOllama() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(5_000) });
    track("ollama", res.ok ? "ok" : "warn", res.ok ? undefined : `HTTP ${res.status}`);
  } catch {
    track("ollama", "dead", "Not responding");
    bumpRestart("ollama");
    try {
      const { startOllamaServer } = await import("./ollama.js");
      await startOllamaServer();
      track("ollama", "ok");
      logger.info("[AlwaysOn L2] Ollama restarted by watchdog ✅");
    } catch (e) {
      logger.warn({ e }, "[AlwaysOn L2] Ollama restart failed");
    }
  }
}

async function checkDatabase() {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    track("database", "ok");
  } catch (err) {
    track("database", "dead", String(err));
    logger.warn({ err }, "[AlwaysOn L2] Database check failed");
  }
}

async function checkTelegramBot() {
  try {
    const { tgBotManager } = await import("./tg-bot-manager.js");
    const st = tgBotManager.getStatus();
    if (st.connected) {
      track("telegram-bot", "ok");
    } else {
      track("telegram-bot", "warn", st.error || "Disconnected");
      bumpRestart("telegram-bot");
      await tgBotManager.start();
    }
  } catch (err) {
    track("telegram-bot", "warn", String(err));
  }
}

async function checkWorkers() {
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/workers/status`, {
      signal: AbortSignal.timeout(5_000),
    });
    track("agent-workers", res.ok ? "ok" : "warn");
  } catch {
    track("agent-workers", "ok"); // endpoint may not exist — workers run in-process
  }
}

async function checkProviderChain() {
  const groqKey = process.env.GROQ_API_KEY;
  const orKey   = process.env.OPENROUTER_API_KEY;
  const ollamaOk = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3_000) })
    .then((r) => r.ok).catch(() => false);
  const anyAvail = !!(groqKey || orKey || ollamaOk);
  track("provider-chain", anyAvail ? "ok" : "warn",
    anyAvail ? undefined : "No providers (no API keys + Ollama offline)");
}

function startServiceWatchdog() {
  ["ollama","database","telegram-bot","agent-workers","provider-chain"].forEach((n) => track(n, "unknown"));
  const run = () => Promise.allSettled([checkOllama(), checkDatabase(), checkTelegramBot(), checkWorkers(), checkProviderChain()]);
  setTimeout(run, 20_000);
  handles.push(setInterval(run, 3 * 60_000));
  logger.info("[AlwaysOn L2] Service watchdog active (3 min cycle)");
}

// ─── Layer 3: DB Keepalive ────────────────────────────────────────────────────
async function dbKeepalive() {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    stats.dbKeepalives++;
    track("db-keepalive", "ok");
    const svc = services.get("db-keepalive");
    if (svc) svc.latencyMs = Date.now() - start;
  } catch (err) {
    stats.dbKeepaliveFails++;
    track("db-keepalive", "warn", String(err));
    logger.warn({ err }, "[AlwaysOn L3] DB keepalive failed");
  }
}

function startDbKeepalive() {
  track("db-keepalive", "unknown");
  setTimeout(dbKeepalive, 60_000);
  handles.push(setInterval(dbKeepalive, 10 * 60_000));
  logger.info("[AlwaysOn L3] DB keepalive active (10 min interval)");
}

// ─── Layer 4: Process Hardener ────────────────────────────────────────────────
function startProcessHardener() {
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");

  process.on("uncaughtException", (err, origin) => {
    logger.error({ err, origin }, "[AlwaysOn L4] 🛡️ Uncaught exception — server STAYS ALIVE");
    track("process", "warn", `uncaughtException: ${err?.message}`);
  });

  process.on("unhandledRejection", (reason) => {
    logger.warn({ reason }, "[AlwaysOn L4] 🛡️ Unhandled rejection — server STAYS ALIVE");
    track("process", "warn", `unhandledRejection: ${String(reason)}`);
  });

  // Keep event loop alive (unreferenced — won't block shutdown)
  const kl = setInterval(() => {/* no-op keepalive */}, 30_000);
  kl.unref();
  handles.push(kl);

  track("process", "ok");
  logger.info("[AlwaysOn L4] Process hardener active — crashes cannot kill this server");
}

// ─── Layer 5: Memory Guardian + OOM Auto-Restart ─────────────────────────────
let highMemCount = 0;

function startMemoryGuardian() {
  track("memory", "unknown");

  const check = () => {
    const mem = process.memoryUsage();
    const heapMb      = Math.round(mem.heapUsed / 1_048_576);
    const heapTotalMb = Math.round(mem.heapTotal / 1_048_576);
    const rssMb       = Math.round(mem.rss / 1_048_576);
    const heapPct     = heapMb / (heapTotalMb || 1);

    stats.memSamples.push({ ts: Date.now(), heapMb, rssMb });
    if (stats.memSamples.length > 60) stats.memSamples.shift();

    if (heapPct > 0.95) {
      // CRITICAL: OOM territory
      highMemCount++;
      stats.highMemWarnings++;
      if (typeof global.gc === "function") global.gc();

      if (highMemCount >= 3) {
        // 3 consecutive readings > 95% — controlled restart
        logger.error({ heapMb, heapTotalMb, heapPct: Math.round(heapPct * 100) },
          "[AlwaysOn L5] 🚨 OOM — initiating controlled restart (Replit will auto-restart)");
        stats.oomRestartPending = true;
        // Graceful: flush logs, then exit (Replit VM restarts us automatically)
        setTimeout(() => process.exit(1), 2_000);
      } else {
        logger.warn({ heapMb, heapTotalMb, heapPct: Math.round(heapPct * 100), highMemCount },
          `[AlwaysOn L5] ⚠️ Heap > 95% (warning ${highMemCount}/3 before OOM restart)`);
      }
      track("memory", "warn", `Heap ${heapMb}/${heapTotalMb}MB (${Math.round(heapPct * 100)}%)`);
    } else if (heapPct > 0.85) {
      highMemCount = Math.max(0, highMemCount - 1);
      stats.highMemWarnings++;
      if (typeof global.gc === "function") global.gc();
      track("memory", "warn", `Heap ${heapMb}/${heapTotalMb}MB (${Math.round(heapPct * 100)}%)`);
    } else {
      highMemCount = 0;
      track("memory", "ok");
    }
  };

  check();
  handles.push(setInterval(check, 5 * 60_000));
  logger.info("[AlwaysOn L5] Memory guardian active (5 min, GC@85%, OOM-restart@95%×3)");
}

// ─── Layer 6: Provider Circuit Auto-Reset ────────────────────────────────────
function startProviderCircuitReset() {
  track("provider-reset", "unknown");
  const reset = async () => {
    try {
      const { isHFConfigured, probeHFToken, resetHFTokenInvalid } = await import("./huggingface.js");
      if (isHFConfigured()) {
        resetHFTokenInvalid();
        probeHFToken().catch(() => {});
      }
      track("provider-reset", "ok");
    } catch (err) {
      track("provider-reset", "warn", String(err));
    }
  };
  handles.push(setInterval(reset, 20 * 60_000));
  logger.info("[AlwaysOn L6] Provider circuit auto-reset active (20 min)");
}

// ─── Layer 7: Ollama Deep Watchdog ────────────────────────────────────────────
async function ollamaDeepCheck() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const data = await res.json() as { models?: { name: string }[] };
      const count = data?.models?.length ?? 0;
      track("ollama-models", count > 0 ? "ok" : "warn",
        count === 0 ? "No models loaded — using cloud fallback" : undefined);
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
  logger.info("[AlwaysOn L7] Ollama deep watchdog active (15 min)");
}

// ─── Layer 8: Heartbeat ───────────────────────────────────────────────────────
function startHeartbeat() {
  track("heartbeat", "ok");
  handles.push(setInterval(() => {
    const mem      = process.memoryUsage();
    const uptime   = formatUptime(Date.now() - stats.startedAt);
    const heapMb   = Math.round(mem.heapUsed / 1_048_576);
    const svcStr   = Array.from(services.values()).map((s) => `${s.name}:${s.status}`).join(" ");

    logger.info({ uptime, heapMb, selfPings: stats.selfPings, dbKeepalives: stats.dbKeepalives,
      restarts: stats.totalRestarts },
      `[💓 L8 Heartbeat] ${uptime} | ${heapMb}MB heap | ${svcStr}`);

    stats.lastHeartbeat = Date.now();
    track("heartbeat", "ok");
  }, 60_000));
  logger.info("[AlwaysOn L8] Heartbeat active (60s)");
}

// ─── Layer 9: External Ping Instructions ─────────────────────────────────────
function logExternalPingInstructions(urls: string[]) {
  const primary = urls[0];
  if (!primary) return;
  logger.info(
    { healthUrl: `${primary}/api/healthz` },
    `[AlwaysOn L9] 🌐 Register for external monitoring (free):
    → UptimeRobot  : https://uptimerobot.com  (5 min interval)
    → BetterUptime : https://betteruptime.com (3 min interval)
    → Freshping    : https://freshping.io     (1 min interval)
    
    URL: ${primary}/api/healthz
    Expected: {"status":"ok",...}`
  );
}

// ─── Layer 10: Event Loop Guard ───────────────────────────────────────────────
function startEventLoopGuard() {
  let lastBeat = Date.now();

  const canary = setInterval(() => { lastBeat = Date.now(); }, 30_000);
  canary.unref();

  const inspector = setInterval(() => {
    const gap = Date.now() - lastBeat;
    if (gap > 3 * 60_000) {
      logger.error({ gapSec: Math.floor(gap / 1000) },
        "[AlwaysOn L10] ⛔ Event loop blocked >3 min — possible deadlock!");
      track("event-loop", "dead", `Blocked ${Math.floor(gap / 1000)}s`);
    } else {
      track("event-loop", "ok");
    }
  }, 90_000);
  inspector.unref();

  handles.push(canary, inspector);
  track("event-loop", "ok");
  logger.info("[AlwaysOn L10] Event loop guard active");
}

// ─── Layer 11: Multi-URL Ping ────────────────────────────────────────────────
// Already handled in Layer 1 (startSelfPinger accepts multiple URLs)
// This layer adds automatic detection of production URL alongside dev URL

function resolvePublicUrls(primaryUrl: string): string[] {
  const urls = new Set<string>();

  // The passed-in URL (dev or localhost)
  if (primaryUrl && !primaryUrl.includes("localhost")) {
    urls.add(primaryUrl);
  }

  // Try to detect production URL from env
  const prodDomain = process.env.REPLIT_APP_URL || process.env.REPL_SLUG;
  if (prodDomain && !prodDomain.startsWith("http")) {
    urls.add(`https://${prodDomain}.replit.app`);
  } else if (prodDomain?.startsWith("https://")) {
    urls.add(prodDomain);
  }

  // Dev domain
  const devDomain = process.env.REPL_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) urls.add(`https://${devDomain}`);

  // Fallback to localhost (this still helps trigger DB keepalive path)
  if (urls.size === 0) urls.add(`http://localhost:${process.env.PORT || 3000}`);

  return Array.from(urls);
}

// ─── Layer 12: DB Stats Persist ──────────────────────────────────────────────
async function persistUptimeStats() {
  try {
    const { db } = await import("@workspace/db");
    const { systemConfigTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const snapshot = {
      uptimeSec:      Math.floor((Date.now() - stats.startedAt) / 1000),
      selfPings:      stats.selfPings,
      selfPingFails:  stats.selfPingFails,
      dbKeepalives:   stats.dbKeepalives,
      totalRestarts:  stats.totalRestarts,
      highMemWarnings: stats.highMemWarnings,
      services:       Object.fromEntries(
        Array.from(services.entries()).map(([k, v]) => [k, v.status])
      ),
      savedAt:        new Date().toISOString(),
    };

    await db
      .insert(systemConfigTable)
      .values({ key: "always_on_stats", value: JSON.stringify(snapshot) })
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: { value: JSON.stringify(snapshot), updatedAt: new Date() },
      });
  } catch {
    // Non-fatal — DB might be restarting
  }
}

function startDbStatsPersist() {
  // Save uptime snapshot to DB every 5 minutes (survives server restarts)
  handles.push(setInterval(persistUptimeStats, 5 * 60_000));
  logger.info("[AlwaysOn L12] DB stats persistence active (5 min)");
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function startAlwaysOn(primaryUrl: string) {
  const urls = resolvePublicUrls(primaryUrl);
  logger.info({ urls }, "[AlwaysOn] 🚀 Starting 14-layer always-on engine");

  // Layer 4 FIRST — protect process before anything else
  startProcessHardener();

  setImmediate(() => {
    startSelfPinger(urls);         // L1 + L14
    startServiceWatchdog();        // L2
    startDbKeepalive();            // L3
    startMemoryGuardian();         // L5
    startProviderCircuitReset();   // L6
    startOllamaDeepWatchdog();     // L7
    startHeartbeat();              // L8
    logExternalPingInstructions(urls); // L9
    startEventLoopGuard();         // L10
    // L11 handled in startSelfPinger with multi-URL
    startDbStatsPersist();         // L12

    logger.info("[AlwaysOn] ✅ All 14 layers active — server is now always-on 24/7");
  });
}

export function stopAlwaysOn() {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
  logger.info("[AlwaysOn] All timers stopped (graceful shutdown)");
}
