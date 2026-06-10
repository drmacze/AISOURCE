import { Router, type IRouter } from "express";
import healthRouter from "./health";
import conversationsRouter from "./conversations";
import documentsRouter from "./documents";
import trainingRouter from "./training";
import dashboardRouter from "./dashboard";
import v1Router from "./v1";
import cliRouter from "./cli";
import hfRouter from "./hf";
import autoTrainingRouter from "./autotraining";
import modelsRouter from "./models";
import imageRouter from "./image";
import kimiRouter from "./kimi";
import apiKeysRouter from "./apikeys";
import searchRouter from "./search";
import settingsRouter from "./settings";
import authSessionRouter from "./auth-session";
import toolsRouter from "./tools";
import promptsRouter from "./prompts";
import analyticsRouter from "./analytics";

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

// Public API v1 — for external integrations (e.g. dlavie.vercel.app)
router.use("/v1", v1Router);

// Settings — manage API keys and integrations
router.use(settingsRouter);

// Persistent auth session — store primary admin key in DB
router.use(authSessionRouter);

export default router;
