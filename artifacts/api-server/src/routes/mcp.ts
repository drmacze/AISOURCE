/**
 * DLavie OS — MCP (Model Context Protocol) Server
 *
 * Exposes DLavie OS capabilities as MCP tools so any MCP-compatible AI
 * (Claude Desktop, Cursor, ChatGPT, etc.) can control DLavie OS directly.
 *
 * Endpoint: POST /api/mcp
 *
 * Compatible with:
 *  - Claude Desktop (via claude_desktop_config.json)
 *  - Cursor IDE (via .cursor/mcp.json)
 *  - VS Code (via .vscode/mcp.json)
 *  - Any OpenAI-style client that supports MCP
 *
 * Tools exposed:
 *  - system_status       — health check + provider status
 *  - dashboard_stats     — real-time usage statistics
 *  - chat                — send a message to DLavie OS AI (Groq/OpenRouter/Ollama)
 *  - list_conversations  — list all chat conversations
 *  - create_conversation — create a new conversation
 *  - search_knowledge    — search the RAG knowledge base
 *  - list_documents      — list all documents in knowledge base
 *  - upload_document     — add text document to knowledge base
 *  - list_models         — list available AI models
 *  - list_datasets       — list training datasets
 *  - start_training      — start a training job
 *  - save_secret         — save an API key (HF_TOKEN, GROQ_API_KEY, etc.)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { generateWithFallback } from "../lib/provider-chain.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const API_BASE = `http://127.0.0.1:${process.env.PORT || 3000}/api`;

/** Internal helper — call our own REST API */
async function localApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`DLavie API ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

/** Build a fresh McpServer with all DLavie OS tools registered */
function buildMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "dlavie-os",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: system_status
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "system_status",
    "Check DLavie OS health: server status, active AI providers (Groq, OpenRouter, HuggingFace, Ollama), and system uptime.",
    {},
    async () => {
      try {
        const [health, providers] = await Promise.all([
          localApi("GET", "/health").catch(() => null),
          localApi("GET", "/providers/health").catch(() => null),
        ]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ health, providers }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: dashboard_stats
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "dashboard_stats",
    "Get real-time DLavie OS statistics: total conversations, documents, training jobs, messages, and recent activity.",
    {},
    async () => {
      try {
        const [stats, activity] = await Promise.all([
          localApi("GET", "/dashboard/stats"),
          localApi("GET", "/dashboard/recent-activity"),
        ]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ stats, recentActivity: activity }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: chat
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "chat",
    "Send a message to DLavie OS AI and get a response. Uses the best available provider (Groq → OpenRouter → HuggingFace → Ollama). Optionally continue an existing conversation.",
    {
      message: z.string().describe("The message to send to DLavie OS AI"),
      conversationId: z
        .string()
        .optional()
        .describe("Optional conversation ID to continue. Omit to start fresh."),
      system: z
        .string()
        .optional()
        .describe("Optional system prompt to guide the AI response"),
    },
    async ({ message, conversationId, system }) => {
      try {
        let convId = conversationId;

        // Create conversation if none provided
        if (!convId) {
          const conv = (await localApi("POST", "/conversations", {
            title: message.slice(0, 60),
          })) as { id: string };
          convId = conv.id;
        }

        // Send message via conversation endpoint
        const result = (await localApi(
          "POST",
          `/conversations/${convId}/messages`,
          { content: message, role: "user" },
        )) as { content?: string; reply?: string; text?: string };

        const reply =
          result.content ?? result.reply ?? result.text ?? JSON.stringify(result);

        return {
          content: [
            {
              type: "text" as const,
              text: `[Conversation: ${convId}]\n\n${reply}`,
            },
          ],
        };
      } catch {
        // Fallback: use provider chain directly
        try {
          const messages = system
            ? [
                { role: "system" as const, content: system },
                { role: "user" as const, content: message },
              ]
            : [{ role: "user" as const, content: message }];

          const result = await generateWithFallback(message, undefined, system);
          return {
            content: [
              {
                type: "text" as const,
                text: `[via ${result.provider}/${result.model}]\n\n${result.text}`,
              },
            ],
          };
        } catch (err2) {
          return {
            content: [{ type: "text" as const, text: `Error: ${String(err2)}` }],
            isError: true,
          };
        }
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: list_conversations
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "list_conversations",
    "List all chat conversations in DLavie OS with their IDs, titles, and message counts.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max conversations to return (default 20)"),
    },
    async ({ limit = 20 }) => {
      try {
        const data = (await localApi(
          "GET",
          `/conversations?limit=${limit}`,
        )) as { conversations?: unknown[] } | unknown[];
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: create_conversation
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "create_conversation",
    "Create a new chat conversation in DLavie OS. Returns the conversation ID to use with the chat tool.",
    {
      title: z.string().describe("Title for the new conversation"),
    },
    async ({ title }) => {
      try {
        const conv = await localApi("POST", "/conversations", { title });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(conv, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: search_knowledge
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "search_knowledge",
    "Search the DLavie OS knowledge base (RAG). Returns relevant document chunks matching the query.",
    {
      query: z.string().describe("Search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of results to return (default 5)"),
      method: z
        .enum(["keyword", "semantic", "hybrid"])
        .optional()
        .describe("Search method (default: hybrid)"),
    },
    async ({ query, limit = 5, method = "hybrid" }) => {
      try {
        const data = await localApi("POST", "/documents/search", {
          query,
          limit,
          method,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: list_documents
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "list_documents",
    "List all documents in the DLavie OS knowledge base (RAG). Shows document names, sizes, and chunk counts.",
    {},
    async () => {
      try {
        const data = await localApi("GET", "/documents");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: upload_document
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "upload_document",
    "Add a text document to the DLavie OS knowledge base. The document will be chunked and indexed for RAG search.",
    {
      title: z.string().describe("Document title"),
      content: z.string().describe("Full text content of the document"),
      type: z
        .enum(["text", "markdown", "code", "json"])
        .optional()
        .describe("Document type (default: text)"),
    },
    async ({ title, content, type = "text" }) => {
      try {
        const data = await localApi("POST", "/documents", {
          title,
          content,
          type,
          source: "mcp",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: list_models
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "list_models",
    "List all AI models available in DLavie OS: local Ollama models, registered models, and available providers.",
    {},
    async () => {
      try {
        const data = await localApi("GET", "/ai-models");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: list_datasets
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "list_datasets",
    "List all training datasets in DLavie OS with their sizes and sample counts.",
    {},
    async () => {
      try {
        const data = await localApi("GET", "/training-datasets");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: start_training
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "start_training",
    "Start a training job on a dataset in DLavie OS. Returns the job ID to track progress.",
    {
      datasetId: z.string().describe("ID of the training dataset to use"),
      modelName: z
        .string()
        .optional()
        .describe("Model name to train (default: tinyllama)"),
      epochs: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of training epochs (default: 3)"),
    },
    async ({ datasetId, modelName = "tinyllama", epochs = 3 }) => {
      try {
        const data = await localApi("POST", "/training-jobs", {
          datasetId,
          modelName,
          epochs,
          source: "mcp",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Tool: save_secret
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    "save_secret",
    "Save an API key or secret to DLavie OS settings. Examples: HF_TOKEN, GROQ_API_KEY, OPENROUTER_API_KEY, GITHUB_TOKEN, OPENAI_API_KEY.",
    {
      name: z
        .string()
        .describe(
          "Environment variable name (uppercase, e.g. HF_TOKEN, GROQ_API_KEY)",
        ),
      value: z.string().describe("The secret value / API key"),
    },
    async ({ name, value }) => {
      try {
        const data = await localApi("POST", "/settings/secrets", {
          name: name.toUpperCase(),
          value,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ─── POST /mcp — main MCP endpoint (stateless, one transport per request) ────
router.post("/mcp", async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    const server = buildMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch (err) {
    logger.error({ err }, "[MCP] Request failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP server error", detail: String(err) });
    }
  }
});

// ─── GET /mcp — returns server info + tool list for discovery ─────────────
router.get("/mcp", (_req: Request, res: Response) => {
  const replDomain = process.env.REPL_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN;
  const publicUrl = replDomain
    ? `https://${replDomain}`
    : `http://localhost:${process.env.PORT || 3000}`;

  res.json({
    name: "DLavie OS MCP Server",
    version: "1.0.0",
    protocol: "mcp/1.0",
    endpoint: `${publicUrl}/api/mcp`,
    transport: "streamable-http",
    tools: [
      { name: "system_status",       description: "Health check + provider status" },
      { name: "dashboard_stats",     description: "Real-time usage statistics" },
      { name: "chat",                description: "Send message to DLavie OS AI" },
      { name: "list_conversations",  description: "List all conversations" },
      { name: "create_conversation", description: "Create new conversation" },
      { name: "search_knowledge",    description: "Search RAG knowledge base" },
      { name: "list_documents",      description: "List knowledge base documents" },
      { name: "upload_document",     description: "Add document to knowledge base" },
      { name: "list_models",         description: "List available AI models" },
      { name: "list_datasets",       description: "List training datasets" },
      { name: "start_training",      description: "Start a training job" },
      { name: "save_secret",         description: "Save API key to settings" },
    ],
    integrations: {
      claudeDesktop: {
        config: "mcpServers.dlavie-os.url",
        value: `${publicUrl}/api/mcp`,
      },
      cursor: {
        config: ".cursor/mcp.json",
        value: { mcpServers: { "dlavie-os": { url: `${publicUrl}/api/mcp` } } },
      },
    },
  });
});

export default router;
