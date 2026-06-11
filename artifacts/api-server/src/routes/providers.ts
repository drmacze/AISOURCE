/**
 * DLavie OS — Providers API
 *
 * GET /api/providers        — list all providers + their status
 * GET /api/providers/models — list all available models across providers
 */

import { Router, type IRouter } from "express";
import { isOllamaOnline, listOllamaModels } from "../ollama";
import { isHFConfigured, HF_CHAT_MODELS } from "../huggingface";
import { isGroqConfigured, GROQ_MODELS } from "../groq";
import { isOpenRouterConfigured, OPENROUTER_FREE_MODELS } from "../openrouter";
import { isKimiConfigured, getKimiConfig } from "../kimi";

const router: IRouter = Router();

router.get("/providers", async (_req, res) => {
  const [ollamaOnline, ollamaModels] = await Promise.all([
    isOllamaOnline().catch(() => false),
    listOllamaModels().catch(() => [] as Array<{ name: string }>),
  ]);

  const kimiCfg = getKimiConfig();

  res.json({
    providers: [
      {
        id: "ollama",
        label: "Ollama (Local)",
        online: ollamaOnline,
        configured: true,
        requiresKey: false,
        modelCount: (ollamaModels as Array<{ name: string }>).length,
        models: (ollamaModels as Array<{ name: string }>).map((m) => ({
          id: m.name,
          label: m.name,
          prefix: "",
          free: true,
        })),
      },
      {
        id: "groq",
        label: "Groq (Cloud — LPU Fast)",
        online: isGroqConfigured(),
        configured: isGroqConfigured(),
        requiresKey: true,
        envKey: "GROQ_API_KEY",
        keyHint: "Get free key at console.groq.com",
        modelCount: GROQ_MODELS.length,
        models: GROQ_MODELS.map((m) => ({
          id: `groq:${m.id}`,
          label: m.label,
          prefix: "groq:",
          context: m.context,
          free: m.free,
        })),
      },
      {
        id: "openrouter",
        label: "OpenRouter (50+ Models)",
        online: isOpenRouterConfigured(),
        configured: isOpenRouterConfigured(),
        requiresKey: true,
        envKey: "OPENROUTER_API_KEY",
        keyHint: "Get free key at openrouter.ai",
        modelCount: OPENROUTER_FREE_MODELS.length,
        models: OPENROUTER_FREE_MODELS.map((m) => ({
          id: `openrouter:${m.id}`,
          label: m.label,
          prefix: "openrouter:",
          context: m.context,
          free: true,
        })),
      },
      {
        id: "huggingface",
        label: "HuggingFace (Serverless GPU)",
        online: isHFConfigured(),
        configured: isHFConfigured(),
        requiresKey: true,
        envKey: "HF_TOKEN",
        keyHint: "Get free token at huggingface.co/settings/tokens",
        modelCount: HF_CHAT_MODELS.length,
        models: HF_CHAT_MODELS.map((m) => ({
          id: `hf:${m}`,
          label: m.split("/").pop() || m,
          prefix: "hf:",
          free: true,
        })),
      },
      {
        id: "kimi",
        label: "Kimi K2 (1T MoE)",
        online: kimiCfg.ok,
        configured: isKimiConfigured(),
        requiresKey: true,
        envKey: "MOONSHOT_API_KEY",
        keyHint: "Or uses HF_TOKEN via HF Router",
        modelCount: 1,
        models: [
          {
            id: "kimi",
            label: "Kimi K2 (moonshotai/Kimi-K2-Instruct)",
            prefix: "",
            free: kimiCfg.via === "hf",
          },
        ],
      },
    ],
  });
});

router.get("/providers/models", async (_req, res) => {
  const ollamaModels = await listOllamaModels().catch(() => [] as Array<{ name: string }>);

  const all = [
    ...(ollamaModels as Array<{ name: string }>).map((m) => ({
      id: m.name,
      label: m.name,
      provider: "ollama",
      providerLabel: "Ollama (Local)",
      free: true,
      available: true,
    })),
    ...(isGroqConfigured()
      ? GROQ_MODELS.map((m) => ({
          id: `groq:${m.id}`,
          label: m.label,
          provider: "groq",
          providerLabel: "Groq",
          free: m.free,
          available: true,
          context: m.context,
        }))
      : []),
    ...(isOpenRouterConfigured()
      ? OPENROUTER_FREE_MODELS.map((m) => ({
          id: `openrouter:${m.id}`,
          label: m.label,
          provider: "openrouter",
          providerLabel: "OpenRouter",
          free: true,
          available: true,
          context: m.context,
        }))
      : []),
    ...(isKimiConfigured()
      ? [
          {
            id: "kimi",
            label: "Kimi K2",
            provider: "kimi",
            providerLabel: "Kimi K2 (MoonshotAI)",
            free: true,
            available: true,
          },
        ]
      : []),
  ];

  res.json({ models: all, total: all.length });
});

export default router;
