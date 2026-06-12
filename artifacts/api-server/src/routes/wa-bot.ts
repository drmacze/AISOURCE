/**
 * DLavie OS — WhatsApp Bot Routes (Baileys)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { waBotManager } from "../wa-bot-manager.js";

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
  if (!phoneNumber) { res.status(400).json({ error: "phoneNumber required (e.g. 6281234567890)" }); return; }
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

export default router;
