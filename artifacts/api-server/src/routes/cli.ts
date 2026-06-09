/**
 * DLavie OS — Ollama CLI API (v2 upgraded)
 * Secure terminal interface for Ollama model management via SSE.
 * Supports: pull, list, rm, show, ps, version, create, copy, info, help
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { spawn, execFile } from "child_process";
import { OLLAMA_PATH, listOllamaModels } from "../ollama";

const router: IRouter = Router();

const ALLOWED_COMMANDS = new Set([
  "pull", "list", "ls", "rm", "remove", "show", "ps", "help",
  "version", "create", "copy", "info",
]);

function parseCommand(raw: string): { cmd: string; args: string[] } | null {
  const parts = raw.trim().split(/\s+/);
  // Strip leading "ollama" if user typed it
  if (parts[0]?.toLowerCase() === "ollama") parts.shift();
  const cmd = parts[0]?.toLowerCase();
  if (!cmd || !ALLOWED_COMMANDS.has(cmd)) return null;
  return { cmd, args: parts.slice(1) };
}

function sse(res: Response, payload: object) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function initSSE(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/** POST /api/cli/run — Execute an Ollama CLI command, stream output via SSE */
router.post("/cli/run", async (req: Request, res: Response) => {
  const { command } = req.body as { command?: string };

  if (!command || typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  const trimmed = command.trim();

  // ── Built-in: help ────────────────────────────────────────────────────────
  if (trimmed.toLowerCase() === "help") {
    initSSE(res);
    const lines = [
      "DLavie OS — Ollama CLI v2",
      "",
      "  pull <model>      Download model from ollama.com/library",
      "  list              List installed models",
      "  rm <model>        Remove model",
      "  show <model>      Model info, parameters, template",
      "  info <model>      Detailed model info via API",
      "  ps                Show running models",
      "  version           Ollama version",
      "  copy <src> <dst>  Copy model with new name",
      "  help              Show this help",
      "",
      "Examples:",
      "  pull qwen2.5:1.5b",
      "  list",
      "  show tinyllama:latest",
      "  rm my-old-model",
      "  copy tinyllama my-custom",
    ];
    for (const line of lines) sse(res, { type: "stdout", text: line });
    sse(res, { type: "done", exitCode: 0 });
    res.end();
    return;
  }

  // ── Built-in: info <model> ────────────────────────────────────────────────
  if (trimmed.toLowerCase().startsWith("info ")) {
    const modelName = trimmed.slice(5).trim();
    initSSE(res);
    sse(res, { type: "info", text: `$ ollama show ${modelName} --verbose` });
    try {
      const r = await fetch("http://127.0.0.1:11434/api/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        sse(res, { type: "error", text: `Model not found: ${modelName}` });
      } else {
        const d = await r.json() as { details?: Record<string, string>; modelinfo?: Record<string, unknown>; parameters?: string };
        if (d.details) {
          for (const [k, v] of Object.entries(d.details)) {
            sse(res, { type: "stdout", text: `  ${k.padEnd(22)} ${v}` });
          }
        }
        if (d.parameters) {
          sse(res, { type: "stdout", text: "" });
          sse(res, { type: "stdout", text: "Parameters:" });
          for (const line of d.parameters.split("\n")) {
            if (line.trim()) sse(res, { type: "stdout", text: `  ${line}` });
          }
        }
      }
    } catch (e) {
      sse(res, { type: "error", text: String(e) });
    }
    sse(res, { type: "done", exitCode: 0 });
    res.end();
    return;
  }

  const parsed = parseCommand(trimmed);
  initSSE(res);

  if (!parsed) {
    sse(res, { type: "error", text: `Unknown command: '${trimmed.split(" ")[0]}'. Type 'help' for available commands.` });
    sse(res, { type: "done", exitCode: 1 });
    res.end();
    return;
  }

  const { cmd, args } = parsed;
  const ollamaCmd = cmd === "ls" ? "list" : cmd === "remove" ? "rm" : cmd;

  sse(res, { type: "info", text: `$ ollama ${ollamaCmd} ${args.join(" ")}`.trimEnd() });

  const isStreaming = ollamaCmd === "pull";

  if (isStreaming) {
    const child = spawn(OLLAMA_PATH, ["pull", ...args], {
      env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim()) sse(res, { type: "stdout", text: line });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (!line.trim()) continue;
        const isProg = /pulling|verifying|writing|digest|sha256/i.test(line);
        sse(res, { type: isProg ? "progress" : "stderr", text: line });
      }
    });

    child.on("error", (err) => {
      sse(res, { type: "error", text: `Spawn error: ${err.message}` });
    });

    child.on("close", (code) => {
      const ok = code === 0;
      if (ok) sse(res, { type: "stdout", text: "✅ Model downloaded and ready" });
      sse(res, { type: "done", exitCode: code ?? 1, needsModelRefresh: ok });
      res.end();
    });

    req.on("close", () => child.kill("SIGTERM"));
  } else {
    execFile(
      OLLAMA_PATH,
      [ollamaCmd, ...args],
      {
        env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434" },
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (stdout?.trim()) {
          for (const line of stdout.trim().split("\n")) {
            if (line.trim()) sse(res, { type: "stdout", text: line });
          }
        }
        if (stderr?.trim()) {
          for (const line of stderr.trim().split("\n")) {
            if (line.trim()) sse(res, { type: "stderr", text: line });
          }
        }
        const ok = !error;
        const needsModelRefresh = ok && ["rm", "create", "copy"].includes(ollamaCmd);
        if (ok) {
          sse(res, { type: "done", exitCode: 0, needsModelRefresh });
        } else {
          sse(res, { type: "error", text: `Command failed: ${error?.message || "unknown"}` });
          sse(res, { type: "done", exitCode: 1, error: true, needsModelRefresh: false });
        }
        res.end();
      }
    );
  }
});

/** GET /api/cli/models — installed model names for autocomplete */
router.get("/cli/models", async (_req, res) => {
  const models = await listOllamaModels();
  res.json(models.map((m) => m.name));
});

/** GET /api/cli/help — command reference */
router.get("/cli/help", (_req, res) => {
  res.json({
    commands: [
      { cmd: "pull <model>",      desc: "Download model from ollama.com",     example: "pull qwen2.5:1.5b" },
      { cmd: "list",              desc: "List installed models",               example: "list" },
      { cmd: "rm <model>",        desc: "Remove model",                        example: "rm tinyllama:latest" },
      { cmd: "show <model>",      desc: "Model info, parameters, template",    example: "show qwen2.5:1.5b" },
      { cmd: "info <model>",      desc: "Detailed model info via Ollama API",  example: "info tinyllama" },
      { cmd: "ps",                desc: "Show running models",                 example: "ps" },
      { cmd: "version",           desc: "Ollama version",                      example: "version" },
      { cmd: "copy <src> <dst>",  desc: "Copy model with new name",            example: "copy tinyllama mymodel" },
      { cmd: "help",              desc: "Show this help",                       example: "help" },
    ],
    tips: [
      "Tab to autocomplete model names",
      "Use 'pull <model>:<tag>' for specific versions (e.g. qwen2.5:1.5b)",
      "Find models at ollama.com/library",
      "Custom trained models appear as nexus-<modelname>",
    ],
  });
});

export default router;
