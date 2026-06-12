/**
 * DLavie OS — OpenClaw Routes
 * GET  /openclaw/status   — gateway status
 * POST /openclaw/restart  — restart gateway
 * POST /openclaw/stop     — stop gateway
 * GET  /openclaw/logs     — recent log buffer
 * GET  /openclaw/events   — SSE live log stream
 * POST /openclaw/config   — update channel credentials
 * POST /openclaw/agent    — send message to OpenClaw agent via Gateway HTTP API
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  getStatus,
  getLogs,
  startGateway,
  stopGateway,
  restartGateway,
  sseClients,
  OPENCLAW_PORT,
} from "../openclaw-manager.js";

const router: IRouter = Router();

router.get("/openclaw/status", (_req, res: Response) => {
  res.json(getStatus());
});

router.get("/openclaw/logs", (_req, res: Response) => {
  res.json({ logs: getLogs() });
});

router.post("/openclaw/start", async (_req, res: Response) => {
  try {
    await startGateway();
    res.json({ ok: true, ...getStatus() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/openclaw/stop", (_req, res: Response) => {
  stopGateway();
  res.json({ ok: true });
});

router.post("/openclaw/restart", async (_req, res: Response) => {
  try {
    await restartGateway();
    res.json({ ok: true, ...getStatus() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── SSE — real-time log and status stream ─────────────────────────────────────

router.get("/openclaw/events", (req: Request, res: Response) => {
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
  sseClients.add(client);

  // Immediately send current status and last 20 logs
  client.send("status", getStatus());
  getLogs().slice(-20).forEach((line) => client.send("log", { line, ts: Date.now() }));

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    sseClients.delete(client);
    clearInterval(heartbeat);
  });
});

// ── Agent chat — proxies to OpenClaw Gateway HTTP API ────────────────────────

router.post("/openclaw/agent", async (req: Request, res: Response) => {
  const { message, sessionId = "main" } = req.body as { message: string; sessionId?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const status = getStatus();
  if (!status.running) {
    res.status(503).json({ error: "OpenClaw gateway is not running. Start it first." });
    return;
  }

  try {
    const resp = await fetch(`http://127.0.0.1:${OPENCLAW_PORT}/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      res.status(resp.status).json({ error: txt });
      return;
    }

    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: `Gateway unreachable: ${String(e)}` });
  }
});

// ── Streaming agent chat ───────────────────────────────────────────────────────

router.post("/openclaw/agent/stream", async (req: Request, res: Response) => {
  const { message, sessionId = "main" } = req.body as { message: string; sessionId?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const status = getStatus();
  if (!status.running) {
    res.setHeader("Content-Type", "text/event-stream");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ error: "Gateway not running", done: true })}\n\n`);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const resp = await fetch(`http://127.0.0.1:${OPENCLAW_PORT}/api/sessions/${sessionId}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    if (!resp.ok || !resp.body) {
      res.write(`data: ${JSON.stringify({ error: await resp.text(), done: true })}\n\n`);
      res.end();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!res.writableEnded) res.write(chunk);
    }
    if (!res.writableEnded) res.end();
  } catch (e) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: String(e), done: true })}\n\n`);
      res.end();
    }
  }
});

export default router;
