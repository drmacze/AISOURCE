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

const router: IRouter = Router();

router.use(healthRouter);
router.use(conversationsRouter);
router.use(documentsRouter);
router.use(trainingRouter);
router.use(dashboardRouter);

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

// Public API v1 — for external integrations (e.g. dlavie.vercel.app)
router.use("/v1", v1Router);

export default router;
