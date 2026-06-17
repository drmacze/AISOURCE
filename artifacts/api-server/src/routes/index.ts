import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import conversationsRouter from "./conversations.js";
import documentsRouter from "./documents.js";
import trainingRouter from "./training.js";
import dashboardRouter from "./dashboard.js";
import v1Router from "./v1.js";
import cliRouter from "./cli.js";
import hfRouter from "./hf.js";
import autoTrainingRouter from "./autotraining.js";
import modelsRouter from "./models.js";
import imageRouter from "./image.js";
import kimiRouter from "./kimi.js";
import apiKeysRouter from "./apikeys.js";
import searchRouter from "./search.js";
import settingsRouter from "./settings.js";
import authSessionRouter from "./auth-session.js";
import toolsRouter from "./tools.js";
import promptsRouter from "./prompts.js";
import analyticsRouter from "./analytics.js";
import agentRouter from "./agent.js";
import providersRouter from "./providers.js";
import resourcesRouter from "./resources.js";
import hfAutoTrainRouter from "./hf-autotrain.js";
import trainingAdvancedRouter from "./training-advanced.js";
import onedriveRouter from "./onedrive.js";
import spotifyRouter from "./spotify.js";
import whatsappRouter from "./whatsapp.js";
import waBotRouter from "./wa-bot.js";
import brandKitRouter from "./brand-kit.js";
import tgBotRouter from "./tg-bot.js";
import openclawRouter from "./openclaw.js";
import openaiCompatRouter from "./openai-compat.js";
import workersRouter from "./workers.js";
import builderRouter from "./builder.js";
import feedbackRouter from "./feedback.js";
import benchmarksRouter from "./benchmarks.js";
import projectsRouter from "./projects.js";
import distillationRouter from "./distillation.js";
import redteamRouter from "./redteam.js";
import knowledgeGraphRouter from "./knowledge-graph-routes.js";
import intentRouter from "./intent.js";
import kaggleRouter from "./kaggle.js";
import chatgptActionsRouter from "./chatgpt-actions.js";
import providersHealthRouter from "./providers-health.js";
import mcpRouter from "./mcp.js";


const router: IRouter = Router();

router.use(healthRouter);
router.use(conversationsRouter);
router.use(documentsRouter);
router.use(trainingRouter);
router.use(dashboardRouter);

// API Key management — generate/revoke/list keys for external integrations
router.use(apiKeysRouter);

// Ollama CLI — secure terminal interface for model management
router.use(cliRouter);

// Model management — install/delete/catalogue/HF search
router.use(modelsRouter);

// HuggingFace Hub — model browser + inference fallback
router.use(hfRouter);

// Auto-training control endpoints
router.use(autoTrainingRouter);

// Image generation — HuggingFace Inference API (FLUX/SDXL)
router.use(imageRouter);

// Kimi K2 — MoonshotAI 1T MoE via HF Router or official Moonshot API
router.use(kimiRouter);

// Web search (DuckDuckGo) + Ollama real-time metrics
router.use(searchRouter);

// AI NLP Tools — summarize, translate, sentiment, classify, NER, keywords
router.use(toolsRouter);

// Prompt Library — save and manage reusable prompts
router.use(promptsRouter);

// Analytics — real DB-backed metrics and charts
router.use(analyticsRouter);

// AI Developer Agent — autonomous ReAct agent for building/training models
router.use(agentRouter);

// Providers — list all AI providers + available models
router.use(providersRouter);

// Public API v1 — for external integrations (e.g. dlavie.vercel.app)
router.use("/v1", v1Router);

// Real system resource monitor — RAM/CPU/Disk from /proc and fs.statfs
router.use(resourcesRouter);

// HuggingFace AutoTrain — push datasets to HF Hub + launch fine-tuning jobs on HF GPU
router.use(hfAutoTrainRouter);

// Advanced Training — 35 AI training enhancement features
router.use(trainingAdvancedRouter);

// Settings — manage API keys and integrations
router.use(settingsRouter);

// Persistent auth session — store primary admin key in DB
router.use(authSessionRouter);

// Microsoft OneDrive — 1TB cloud storage + RAG sync
router.use(onedriveRouter);

// Spotify Now Playing — live widget for GitHub profile
router.use(spotifyRouter);

// WhatsApp Cloud API webhook + bot management
router.use(whatsappRouter);
router.use(waBotRouter);

// Brand Kit — AI-generated visual assets (FLUX)
router.use(brandKitRouter);

// Telegram Bot — AI auto-reply + .report ticket system
router.use(tgBotRouter);

// OpenClaw Gateway — multi-channel AI agent (WhatsApp, Telegram, Discord, 20+ platforms)
router.use(openclawRouter);

// OpenAI-compatible endpoint — for OpenClaw and external integrations (mounted at /api by app.ts)
router.use(openaiCompatRouter);

// Multi-agent job worker status, mail, metrics, nudge
router.use(workersRouter);

// AI Builder — task board, agent execution loop, skill-constrained builder
router.use(builderRouter);

// BLOK A — RLHF-lite: User feedback (👍/👎) from Web, Telegram, WhatsApp
router.use(feedbackRouter);

// BLOK B/C/N — Capability Map, Self-Healing Loop, Golden Test Set
router.use(benchmarksRouter);

// BLOK D/G/O — Project System, System Events, Agent Performance
router.use(projectsRouter);

// BLOK E — Smart Model Routing (intent-based)
router.use(intentRouter);

// BLOK H/I — Model Distillation + 3-Agent Debate Verification
router.use(distillationRouter);

// BLOK J/K — Active Learning (uncertainty) + Automated Red-Teaming
router.use(redteamRouter);

// BLOK M — Knowledge Graph (relational entity graph for RAG)
router.use(knowledgeGraphRouter);

// Kaggle — full Kaggle integration (dataset sync, kernel management, GPU training)
router.use(kaggleRouter);

// ChatGPT Actions — read/write/edit conversations, documents, training data via ChatGPT
router.use(chatgptActionsRouter);

// Real-time provider health check — probes Groq, OpenRouter, HuggingFace, Ollama
router.use(providersHealthRouter);

// MCP (Model Context Protocol) server — connect Claude Desktop, Cursor, ChatGPT, etc.
router.use(mcpRouter);

export default router;
