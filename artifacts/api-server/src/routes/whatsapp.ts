/**
 * DLavie OS — WhatsApp Cloud API Webhook
 *
 * GET  /api/webhook/whatsapp        — Meta webhook verification
 * POST /api/webhook/whatsapp        — Receive messages from Meta, reply with AI
 * GET  /api/whatsapp/config         — Get current bot configuration
 * POST /api/whatsapp/config         — Save bot configuration
 * GET  /api/whatsapp/logs           — Get message history
 * DELETE /api/whatsapp/logs         — Clear message history
 * POST /api/whatsapp/test           — Send a test message
 * GET  /api/whatsapp/status         — Check webhook status
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { whatsappConfigTable, whatsappMessagesTable } from "@workspace/db";
import { desc, eq, count } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── WhatsApp Cloud API sender ─────────────────────────────────────────────────
async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: text, preview_url: false },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message: string };
    };
    if (!res.ok || data.error) {
      return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── GET /api/webhook/whatsapp — Meta verification ────────────────────────────
router.get("/webhook/whatsapp", async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const token = req.query["hub.verify_token"];

  if (mode !== "subscribe") {
    res.status(400).send("Invalid mode");
    return;
  }

  try {
    const [config] = await db
      .select()
      .from(whatsappConfigTable)
      .limit(1);

    if (!config || !config.enabled) {
      res.status(403).send("Webhook not enabled");
      return;
    }

    if (token !== config.verifyToken) {
      logger.warn({ token }, "WhatsApp webhook: verify token mismatch");
      res.status(403).send("Verification token mismatch");
      return;
    }

    logger.info("WhatsApp webhook verified successfully");
    res.status(200).send(challenge);
  } catch (err) {
    logger.error({ err }, "WhatsApp webhook verification error");
    res.status(500).send("Server error");
  }
});

// ─── POST /api/webhook/whatsapp — Receive messages ────────────────────────────
router.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  // Immediately acknowledge to Meta (required within 5s)
  res.sendStatus(200);

  try {
    const body = req.body as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              id: string;
              from: string;
              type: string;
              text?: { body: string };
            }>;
            statuses?: Array<{ id: string; status: string }>;
          };
        }>;
      }>;
    };

    if (body.object !== "whatsapp_business_account") return;

    const [config] = await db.select().from(whatsappConfigTable).limit(1);
    if (!config || !config.enabled) return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const msg of value.messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;

          const userText = msg.text.body.trim();
          const from = msg.from;

          // Log inbound message
          await db.insert(whatsappMessagesTable).values({
            waMessageId: msg.id,
            from,
            to: config.phoneNumberId,
            direction: "inbound",
            body: userText,
            status: "received",
          });

          logger.info({ from, msg: userText.slice(0, 80) }, "WhatsApp inbound message");

          // Generate AI response
          let aiText = "";
          let usedProvider = "unknown";

          try {
            // Use custom API key if configured, otherwise use system provider chain
            if (config.aiApiKey && config.aiProvider !== "auto") {
              const origKey = process.env[`${config.aiProvider.toUpperCase()}_API_KEY`];
              process.env[`${config.aiProvider.toUpperCase()}_API_KEY`] = config.aiApiKey;
              const result = await generateWithFallback(
                userText,
                undefined,
                config.systemPrompt || undefined,
                { maxTokens: 1024 }
              );
              aiText = result.text;
              usedProvider = result.provider;
              if (origKey) process.env[`${config.aiProvider.toUpperCase()}_API_KEY`] = origKey;
              else delete process.env[`${config.aiProvider.toUpperCase()}_API_KEY`];
            } else {
              const result = await generateWithFallback(
                userText,
                undefined,
                config.systemPrompt || undefined,
                { maxTokens: 1024 }
              );
              aiText = result.text;
              usedProvider = result.provider;
            }
          } catch (err) {
            aiText = "Maaf, sistem AI sedang tidak tersedia. Coba lagi nanti.";
            logger.error({ err }, "WhatsApp AI generation failed");
          }

          // Send reply via WhatsApp Cloud API
          const sendResult = await sendWhatsAppMessage(
            config.phoneNumberId,
            config.accessToken,
            from,
            aiText
          );

          // Log outbound message
          await db.insert(whatsappMessagesTable).values({
            from: config.phoneNumberId,
            to: from,
            direction: "outbound",
            body: aiText,
            aiProvider: usedProvider,
            status: sendResult.ok ? "sent" : "failed",
            errorMessage: sendResult.error,
          });

          if (!sendResult.ok) {
            logger.error({ err: sendResult.error, to: from }, "WhatsApp send failed");
          } else {
            logger.info({ to: from, provider: usedProvider, msgId: sendResult.messageId }, "WhatsApp reply sent");
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "WhatsApp webhook processing error");
  }
});

// ─── GET /api/whatsapp/config ─────────────────────────────────────────────────
router.get("/whatsapp/config", async (_req: Request, res: Response) => {
  try {
    const [config] = await db.select().from(whatsappConfigTable).limit(1);
    if (!config) {
      res.json({ config: null });
      return;
    }
    // Mask the access token
    const masked = {
      ...config,
      accessToken: config.accessToken
        ? config.accessToken.slice(0, 6) + "••••••••" + config.accessToken.slice(-4)
        : "",
      aiApiKey: config.aiApiKey
        ? config.aiApiKey.slice(0, 4) + "••••••••" + config.aiApiKey.slice(-4)
        : "",
    };
    res.json({ config: masked });
  } catch (err) {
    logger.error({ err }, "Get WhatsApp config failed");
    res.status(500).json({ error: "Failed to get config" });
  }
});

// ─── POST /api/whatsapp/config ────────────────────────────────────────────────
router.post("/whatsapp/config", async (req: Request, res: Response) => {
  const {
    phoneNumberId,
    accessToken,
    verifyToken,
    businessAccountId,
    aiProvider,
    aiModel,
    aiApiKey,
    systemPrompt,
    enabled,
    botName,
  } = req.body as {
    phoneNumberId?: string;
    accessToken?: string;
    verifyToken?: string;
    businessAccountId?: string;
    aiProvider?: string;
    aiModel?: string;
    aiApiKey?: string;
    systemPrompt?: string;
    enabled?: boolean;
    botName?: string;
  };

  if (!phoneNumberId || !accessToken || !verifyToken) {
    res.status(400).json({ error: "phoneNumberId, accessToken, dan verifyToken wajib diisi" });
    return;
  }

  try {
    const [existing] = await db.select().from(whatsappConfigTable).limit(1);

    const values = {
      phoneNumberId: phoneNumberId.trim(),
      accessToken: accessToken.includes("••••") ? (existing?.accessToken ?? accessToken) : accessToken.trim(),
      verifyToken: verifyToken.trim(),
      businessAccountId: businessAccountId?.trim() || "",
      aiProvider: aiProvider || "auto",
      aiModel: aiModel?.trim() || "",
      aiApiKey: aiApiKey?.includes("••••") ? (existing?.aiApiKey ?? "") : (aiApiKey?.trim() || ""),
      systemPrompt: systemPrompt?.trim() || "Kamu adalah asisten AI yang membantu. Jawab dengan singkat dan jelas.",
      enabled: enabled ?? false,
      botName: botName?.trim() || "NEXUS Bot",
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(whatsappConfigTable).set(values).where(eq(whatsappConfigTable.id, existing.id));
    } else {
      await db.insert(whatsappConfigTable).values(values);
    }

    logger.info({ phoneNumberId: values.phoneNumberId, enabled: values.enabled }, "WhatsApp config saved");
    res.json({ success: true, message: "Konfigurasi WhatsApp disimpan." });
  } catch (err) {
    logger.error({ err }, "Save WhatsApp config failed");
    res.status(500).json({ error: "Gagal menyimpan konfigurasi" });
  }
});

// ─── GET /api/whatsapp/logs ───────────────────────────────────────────────────
router.get("/whatsapp/logs", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const logs = await db
      .select()
      .from(whatsappMessagesTable)
      .orderBy(desc(whatsappMessagesTable.createdAt))
      .limit(limit);
    res.json({ logs, total: logs.length });
  } catch (err) {
    logger.error({ err }, "Get WhatsApp logs failed");
    res.status(500).json({ error: "Failed to get logs" });
  }
});

// ─── DELETE /api/whatsapp/logs ────────────────────────────────────────────────
router.delete("/whatsapp/logs", async (_req: Request, res: Response) => {
  try {
    await db.delete(whatsappMessagesTable);
    res.json({ success: true, message: "Log pesan dihapus." });
  } catch (err) {
    logger.error({ err }, "Clear WhatsApp logs failed");
    res.status(500).json({ error: "Failed to clear logs" });
  }
});

// ─── POST /api/whatsapp/test ──────────────────────────────────────────────────
router.post("/whatsapp/test", async (req: Request, res: Response) => {
  const { to, message } = req.body as { to?: string; message?: string };

  if (!to || !message) {
    res.status(400).json({ error: "to dan message wajib diisi" });
    return;
  }

  try {
    const [config] = await db.select().from(whatsappConfigTable).limit(1);
    if (!config) {
      res.status(404).json({ error: "Konfigurasi WhatsApp belum diatur" });
      return;
    }
    if (!config.phoneNumberId || !config.accessToken) {
      res.status(400).json({ error: "Phone Number ID atau Access Token belum diisi" });
      return;
    }

    const result = await sendWhatsAppMessage(
      config.phoneNumberId,
      config.accessToken,
      to.trim(),
      message.trim()
    );

    if (result.ok) {
      await db.insert(whatsappMessagesTable).values({
        from: config.phoneNumberId,
        to: to.trim(),
        direction: "outbound",
        body: message.trim(),
        aiProvider: "manual-test",
        status: "sent",
      });
      res.json({ success: true, messageId: result.messageId, message: "Pesan tes berhasil dikirim!" });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    logger.error({ err }, "WhatsApp test send failed");
    res.status(500).json({ error: "Gagal mengirim pesan tes" });
  }
});

// ─── GET /api/whatsapp/status ─────────────────────────────────────────────────
router.get("/whatsapp/status", async (_req: Request, res: Response) => {
  try {
    const [config] = await db.select().from(whatsappConfigTable).limit(1);

    const [{ total }] = await db
      .select({ total: count() })
      .from(whatsappMessagesTable);

    const [{ inbound }] = await db
      .select({ inbound: count() })
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.direction, "inbound"));

    res.json({
      configured: !!config?.phoneNumberId,
      enabled: config?.enabled ?? false,
      phoneNumberId: config?.phoneNumberId || null,
      botName: config?.botName || null,
      aiProvider: config?.aiProvider || null,
      totalMessages: Number(total) || 0,
      inboundMessages: Number(inbound) || 0,
    });
  } catch (err) {
    logger.error({ err }, "Get WhatsApp status failed");
    res.status(500).json({ error: "Failed to get status" });
  }
});

export default router;
