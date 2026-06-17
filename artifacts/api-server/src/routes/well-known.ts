/**
 * DLavie OS — Well-Known & ChatGPT Plugin Manifest
 *
 * GET  /.well-known/ai-plugin.json  — ChatGPT Actions plugin manifest
 * GET  /.well-known/openapi.yaml    — Full OpenAPI spec (ChatGPT reads this to understand all endpoints)
 * GET  /.well-known/openapi.json    — Same spec as JSON (for Cursor / other clients)
 *
 * URLs are built dynamically from the request host so they work
 * on any Replit domain (dev, deployed, custom).
 */

import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

// ─── ai-plugin.json ───────────────────────────────────────────────────────────
router.get("/.well-known/ai-plugin.json", (req: Request, res: Response) => {
  const origin = getOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    schema_version: "v1",
    name_for_human: "DLavie OS",
    name_for_model: "dlavie_os",
    description_for_human:
      "AI Command Center — baca, tulis, dan kelola conversations, documents, training data, models, dan settings DLavie OS.",
    description_for_model:
      "DLavie OS is a local AI command center. Use it to: read/create/delete chat conversations and messages, manage knowledge base documents (create/edit/delete/search), add or read training samples, list AI models and datasets, check system status and provider health, read/write application settings and API keys, control AI agents, and run AI inference via the chat endpoint. Always call system_status first to confirm the server is online.",
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: `${origin}/.well-known/openapi.yaml`,
      is_user_authenticated: false,
    },
    logo_url: `${origin}/opengraph.jpg`,
    contact_email: "admin@dlavie.local",
    legal_info_url: `${origin}/api/chatgpt/status`,
  });
});

// ─── openapi.yaml ─────────────────────────────────────────────────────────────
router.get("/.well-known/openapi.yaml", (req: Request, res: Response) => {
  const origin = getOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  res.send(buildOpenApiYaml(origin));
});

// ─── openapi.json ─────────────────────────────────────────────────────────────
router.get("/.well-known/openapi.json", (req: Request, res: Response) => {
  const origin = getOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(buildOpenApiJson(origin));
});

// ─── CORS preflight ───────────────────────────────────────────────────────────
router.options("/.well-known/:file", (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.status(204).end();
});

// ─── OpenAPI spec builders ────────────────────────────────────────────────────
function buildOpenApiYaml(origin: string): string {
  return `openapi: "3.1.0"
info:
  title: DLavie OS API
  description: |
    AI Command Center — full CRUD access to conversations, documents,
    training data, models, settings, agents, and AI inference.
    All endpoints are under /api/chatgpt/* except /api/chatgpt/chat which runs live AI inference.
  version: "2.0.0"
servers:
  - url: ${origin}
    description: DLavie OS Server

paths:
  /api/chatgpt/status:
    get:
      operationId: getStatus
      summary: Get system status
      description: Check if DLavie OS is online. Returns server version, capabilities, and stats (conversations, documents, training samples count). Always call this first.
      responses:
        "200":
          description: System status
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: string, example: online }
                  name:   { type: string }
                  version: { type: string }
                  capabilities: { type: array, items: { type: string } }
                  stats:
                    type: object
                    properties:
                      conversations:   { type: integer }
                      documents:       { type: integer }
                      trainingSamples: { type: integer }

  /api/chatgpt/chat:
    post:
      operationId: chat
      summary: Send a message to DLavie OS AI
      description: |
        Run AI inference on DLavie OS. The message is processed by the best available provider
        (Groq → OpenRouter → HuggingFace → Ollama). Use this to ask the DLavie OS AI questions,
        get help with setup, or have a conversation.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [message]
              properties:
                message:
                  type: string
                  description: The user message to send to the AI
                  example: "Bagaimana cara upload dokumen ke DLavie OS?"
                system:
                  type: string
                  description: Optional system prompt override
                conversationId:
                  type: integer
                  description: Optional existing conversation ID to continue
      responses:
        "200":
          description: AI response
          content:
            application/json:
              schema:
                type: object
                properties:
                  reply:    { type: string }
                  provider: { type: string }
                  model:    { type: string }
                  conversationId: { type: integer }

  /api/chatgpt/conversations:
    get:
      operationId: listConversations
      summary: List all conversations
      description: Returns all chat conversations ordered by most recent. Use limit to control how many.
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 50 }
      responses:
        "200":
          description: List of conversations
          content:
            application/json:
              schema:
                type: object
                properties:
                  conversations:
                    type: array
                    items:
                      type: object
                      properties:
                        id:        { type: integer }
                        title:     { type: string }
                        createdAt: { type: string, format: date-time }
                        updatedAt: { type: string, format: date-time }
    post:
      operationId: createConversation
      summary: Create a new conversation
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                title: { type: string, example: "Setup Discussion" }
      responses:
        "201":
          description: Created conversation
          content:
            application/json:
              schema:
                type: object
                properties:
                  conversation:
                    type: object
                    properties:
                      id:    { type: integer }
                      title: { type: string }

  /api/chatgpt/conversations/{id}:
    get:
      operationId: getConversation
      summary: Get conversation with messages
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Conversation and messages
          content:
            application/json:
              schema:
                type: object
                properties:
                  conversation: { type: object }
                  messages:
                    type: array
                    items:
                      type: object
                      properties:
                        id:             { type: integer }
                        role:           { type: string, enum: [user, assistant] }
                        content:        { type: string }
                        createdAt:      { type: string, format: date-time }
    delete:
      operationId: deleteConversation
      summary: Delete a conversation
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Deleted

  /api/chatgpt/conversations/{id}/messages:
    post:
      operationId: addMessage
      summary: Add a message to a conversation
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content]
              properties:
                role:    { type: string, enum: [user, assistant], default: user }
                content: { type: string }
      responses:
        "201":
          description: Created message

  /api/chatgpt/documents:
    get:
      operationId: listDocuments
      summary: List all knowledge base documents
      responses:
        "200":
          description: Documents list
          content:
            application/json:
              schema:
                type: object
                properties:
                  documents:
                    type: array
                    items:
                      type: object
                      properties:
                        id:        { type: integer }
                        title:     { type: string }
                        content:   { type: string }
                        fileType:  { type: string }
                        createdAt: { type: string, format: date-time }
    post:
      operationId: createDocument
      summary: Add a document to the knowledge base
      description: Creates a new document and indexes it for RAG search.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, content]
              properties:
                title:   { type: string, example: "Panduan Setup" }
                content: { type: string, example: "Isi dokumen..." }
                type:    { type: string, example: "text" }
      responses:
        "201":
          description: Created document

  /api/chatgpt/documents/{id}:
    patch:
      operationId: editDocument
      summary: Edit a document
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                title:   { type: string }
                content: { type: string }
      responses:
        "200":
          description: Updated document
    delete:
      operationId: deleteDocument
      summary: Delete a document
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Deleted

  /api/chatgpt/search:
    get:
      operationId: searchKnowledgeBase
      summary: Search the knowledge base
      parameters:
        - name: q
          in: query
          required: true
          schema: { type: string }
          description: Search query
      responses:
        "200":
          description: Search results
          content:
            application/json:
              schema:
                type: object
                properties:
                  query:   { type: string }
                  count:   { type: integer }
                  results: { type: array, items: { type: object } }

  /api/chatgpt/training:
    get:
      operationId: listTrainingSamples
      summary: List training samples
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 50 }
        - name: offset
          in: query
          schema: { type: integer, default: 0 }
      responses:
        "200":
          description: Training samples
    post:
      operationId: addTrainingSample
      summary: Add a training sample
      description: Adds an input/output pair to the training dataset.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [input, output]
              properties:
                input:     { type: string, example: "What is RAG?" }
                output:    { type: string, example: "RAG stands for Retrieval-Augmented Generation..." }
                datasetId: { type: integer }
      responses:
        "201":
          description: Created sample

  /api/chatgpt/settings:
    get:
      operationId: getSettings
      summary: Read current DLavie OS settings
      description: Returns currently configured API keys (masked), active providers, and system configuration.
      responses:
        "200":
          description: Current settings
          content:
            application/json:
              schema:
                type: object
                properties:
                  providers:
                    type: object
                    properties:
                      groq:        { type: object, properties: { configured: { type: boolean }, key: { type: string } } }
                      openrouter:  { type: object, properties: { configured: { type: boolean }, key: { type: string } } }
                      huggingface: { type: object, properties: { configured: { type: boolean }, key: { type: string } } }
                      ollama:      { type: object, properties: { running: { type: boolean } } }
                  dlavieApiKey:  { type: string, description: "Masked API key if set" }
    post:
      operationId: saveSettings
      summary: Save API keys and settings
      description: |
        Save one or more configuration values to DLavie OS. Supported keys:
        GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN, GITHUB_TOKEN, DLAVIE_API_KEY,
        KAGGLE_USERNAME, KAGGLE_KEY, TELEGRAM_BOT_TOKEN.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                GROQ_API_KEY:       { type: string }
                OPENROUTER_API_KEY: { type: string }
                HF_TOKEN:           { type: string }
                GITHUB_TOKEN:       { type: string }
                DLAVIE_API_KEY:     { type: string }
                KAGGLE_USERNAME:    { type: string }
                KAGGLE_KEY:         { type: string }
                TELEGRAM_BOT_TOKEN: { type: string }
      responses:
        "200":
          description: Saved successfully

  /api/chatgpt/models:
    get:
      operationId: listModels
      summary: List available AI models
      description: Returns Ollama local models, provider status, and registered custom models.
      responses:
        "200":
          description: Models list

  /api/chatgpt/agents:
    get:
      operationId: getAgentStatus
      summary: Get AI agent system status
      description: Returns status of all 24 AI agents, their last activity, and recent agent mail.
      responses:
        "200":
          description: Agent status

  /api/chatgpt/providers:
    get:
      operationId: getProviderHealth
      summary: Check AI provider health
      description: Tests connectivity to Groq, OpenRouter, HuggingFace, and Ollama. Returns which providers are available.
      responses:
        "200":
          description: Provider health status

  /api/chatgpt/kaggle/sync:
    post:
      operationId: kaggleSync
      summary: Sync dataset to Kaggle
      description: Pushes the training dataset to Kaggle for GPU fine-tuning.
      responses:
        "200":
          description: Sync result

  /api/chatgpt/kaggle/train:
    post:
      operationId: kaggleTrain
      summary: Start GPU training on Kaggle
      description: Launches a LoRA fine-tuning job on Kaggle's free GPU.
      responses:
        "200":
          description: Training job started
`;
}

function buildOpenApiJson(origin: string): object {
  // Parse the YAML (simplified — return key structure as JSON)
  return {
    openapi: "3.1.0",
    info: { title: "DLavie OS API", version: "2.0.0" },
    servers: [{ url: origin }],
    paths: { "...": "See /.well-known/openapi.yaml for full spec" },
  };
}

export default router;
