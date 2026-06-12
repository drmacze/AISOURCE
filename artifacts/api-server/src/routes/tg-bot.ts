/**
 * DLavie OS — Telegram Bot Routes
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { tgBotManager, tgSSEClients } from "../tg-bot-manager.js";
import { db } from "@workspace/db";
import { botTicketsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/tg-bot/status", (_req, res: Response) => {
  res.json(tgBotManager.getStatus());
});

router.get("/tg-bot/config", (_req, res: Response) => {
  const cfg = tgBotManager.getConfig();
  // Mask token in response for security
  res.json({ ...cfg, token: cfg.token ? "•".repeat(8) + cfg.token.slice(-4) : "" });
});

router.post("/tg-bot/config", (req: Request, res: Response) => {
  tgBotManager.setConfig(req.body as Parameters<typeof tgBotManager.setConfig>[0]);
  res.json({ ok: true });
});

router.post("/tg-bot/connect", async (_req, res: Response) => {
  try {
    const info = await tgBotManager.connect();
    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/tg-bot/disconnect", (_req, res: Response) => {
  tgBotManager.disconnect();
  res.json({ ok: true });
});

router.get("/tg-bot/logs", (_req, res: Response) => {
  res.json({ logs: tgBotManager.getLogs() });
});

// ── SSE — real-time push for TG bot events ────────────────────────────────────

router.get("/tg-bot/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = {
    send(event: string, data: unknown) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  client.send("connected", { ts: Date.now() });
  client.send("tg_status", tgBotManager.getStatus());
  tgSSEClients.add(client);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    tgSSEClients.delete(client);
  });
});

// ── Ticket endpoints ──────────────────────────────────────────────────────────

router.get("/bot-tickets", async (_req, res: Response) => {
  try {
    const tickets = await db.select().from(botTicketsTable).orderBy(desc(botTicketsTable.createdAt));
    res.json({ tickets });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/bot-tickets/:id", async (req: Request, res: Response) => {
  try {
    const [ticket] = await db.select().from(botTicketsTable)
      .where(eq(botTicketsTable.id, Number(req.params["id"])));
    if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
    res.json(ticket);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/bot-tickets/:id/resolve", async (req: Request, res: Response) => {
  try {
    const { agentNotes, platform } = req.body as { agentNotes?: string; platform?: string };
    const id = Number(req.params["id"]);
    if (platform === "telegram") {
      await tgBotManager.notifyTicketResolved(id, agentNotes);
    } else {
      await db.update(botTicketsTable)
        .set({ status: "resolved", agentNotes: agentNotes ?? null, resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(botTicketsTable.id, id));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/bot-tickets/:id", async (req: Request, res: Response) => {
  try {
    const { status, priority, agentNotes } = req.body as {
      status?: string; priority?: string; agentNotes?: string;
    };
    const [updated] = await db.update(botTicketsTable)
      .set({ ...(status && { status: status as never }), ...(priority && { priority: priority as never }), ...(agentNotes !== undefined && { agentNotes }), updatedAt: new Date() })
      .where(eq(botTicketsTable.id, Number(req.params["id"])))
      .returning();
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
