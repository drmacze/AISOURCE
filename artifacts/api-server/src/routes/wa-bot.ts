/**
 * DLavie OS — WhatsApp Bot Routes (Baileys)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { waBotManager, waSSEClients } from "../wa-bot-manager.js";

const router: IRouter = Router();

router.get("/wa-bot/status", (_req: Request, res: Response) => {
  res.json(waBotManager.getStatus());
});

router.get("/wa-bot/config", (_req: Request, res: Response) => {
  res.json(waBotManager.getConfig());
});

router.post("/wa-bot/config", (req: Request, res: Response) => {
  waBotManager.setConfig(req.body as Parameters<typeof waBotManager.setConfig>[0]);
  res.json({ ok: true });
});

router.post("/wa-bot/connect", async (req: Request, res: Response) => {
  const { phoneNumber } = req.body as { phoneNumber?: string };
  if (!phoneNumber) {
    res.status(400).json({ error: "phoneNumber required (e.g. 6281234567890)" });
    return;
  }
  try {
    const pairingCode = await waBotManager.connect(phoneNumber.replace(/[^0-9]/g, ""));
    res.json({ pairingCode, message: "Enter this code in WhatsApp → Linked Devices → Link with phone number" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/wa-bot/disconnect", async (_req: Request, res: Response) => {
  await waBotManager.disconnect();
  res.json({ ok: true });
});

router.get("/wa-bot/logs", (_req: Request, res: Response) => {
  res.json({ logs: waBotManager.getLogs() });
});

// ── SSE — real-time push for WA bot events ────────────────────────────────────

router.get("/wa-bot/events", (req: Request, res: Response) => {
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
  client.send("wa_status", waBotManager.getStatus());
  waSSEClients.add(client);

  const heartbeat = setInterval(() => { res.write(": heartbeat\n\n"); }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    waSSEClients.delete(client);
  });
});

// ── Thumbnail endpoints ───────────────────────────────────────────────────────

router.get("/wa-bot/thumbnail", (_req: Request, res: Response) => {
  const data = waBotManager.getThumbnailBase64();
  res.json({ data });
});

router.post("/wa-bot/generate-thumbnail", async (req: Request, res: Response) => {
  const { newSeed } = req.body as { newSeed?: boolean };
  try {
    const data = await waBotManager.generateThumbnail(newSeed ?? true);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/wa-bot/apply-profile-pic", async (_req: Request, res: Response) => {
  try {
    await waBotManager.applyProfilePic();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── WA ticket resolve + notify ────────────────────────────────────────────────

router.post("/wa-bot/notify-ticket", async (req: Request, res: Response) => {
  try {
    const { ticketId, agentNotes } = req.body as { ticketId: number; agentNotes?: string };
    await waBotManager.notifyTicketResolved(ticketId, agentNotes);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
