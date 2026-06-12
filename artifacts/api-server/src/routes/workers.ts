/**
 * DLavie OS — Worker Status & Control Routes
 *
 * GET  /workers/status      — all 8 worker statuses + agent heartbeats
 * GET  /workers/agents      — agent DB heartbeats from agent_status table
 * GET  /workers/mail        — boss inbox (mail to "boss")
 * GET  /workers/mail/all    — all inter-agent mail
 * DELETE /workers/mail/:id  — mark mail as read
 * GET  /workers/metrics     — recent agent metrics
 * POST /workers/:id/nudge   — manually trigger a worker tick now
 * GET  /workers/events      — SSE live stream of worker events
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getWorkers,
  nudgeWorker,
  getAgentStatuses,
  getRecentMail,
  getBossInbox,
  getRecentMetrics,
  workerSSEClients,
  getCircuitStatus,
  resetCircuit,
  getActiveThreads,
} from "../agent-workers.js";
import { db } from "@workspace/db";
import { agentMailTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/workers/status", async (_req, res: Response) => {
  try {
    const [workers, agents] = await Promise.all([
      getWorkers(),
      getAgentStatuses(),
    ]);
    res.json({ workers, agents, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/agents", async (_req, res: Response) => {
  try {
    const agents = await getAgentStatuses();
    res.json({ agents });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/mail", async (_req, res: Response) => {
  try {
    const mail = await getBossInbox(30);
    res.json({ mail });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/mail/all", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const mail = await getRecentMail(limit);
    res.json({ mail });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/workers/mail/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await db.update(agentMailTable).set({ read: true }).where(eq(agentMailTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/workers/mail/send", async (req: Request, res: Response) => {
  try {
    const { to, subject, body, priority = "normal", from: fromRaw } = req.body as {
      to: string; subject: string; body: string; priority?: string; from?: string;
    };
    const fromAgent = fromRaw || "dlavie";
    const [inserted] = await db.insert(agentMailTable).values({
      fromAgent,
      toAgent: to,
      subject,
      body,
      priority,
      read: false,
    }).returning();
    res.json({ ok: true, id: inserted?.id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/metrics", async (req: Request, res: Response) => {
  try {
    const agentId = typeof req.query.agent === "string" ? req.query.agent : undefined;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const metrics = await getRecentMetrics(agentId, limit);
    res.json({ metrics });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/workers/circuit", (_req: Request, res: Response) => {
  res.json(getCircuitStatus());
});

router.post("/workers/circuit/reset", (_req: Request, res: Response) => {
  resetCircuit();
  res.json({ ok: true, circuit: getCircuitStatus() });
});

router.get("/workers/threads", (_req: Request, res: Response) => {
  res.json({ threads: getActiveThreads() });
});

router.post("/workers/:id/nudge", async (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = await nudgeWorker(id);
  if (!ok) {
    res.status(404).json({ error: `Worker "${id}" not found` });
    return;
  }
  res.json({ ok: true, workerId: id, message: `Worker "${id}" triggered` });
});

router.get("/workers/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = {
    send(event: string, data: unknown) {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
  };
  workerSSEClients.add(client);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 25_000);

  req.on("close", () => {
    workerSSEClients.delete(client);
    clearInterval(heartbeat);
  });
});

export default router;
