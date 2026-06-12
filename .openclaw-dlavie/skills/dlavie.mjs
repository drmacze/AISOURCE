/**
 * DLavie OS Skills for OpenClaw Agent
 * Gives the agent full access to DLavie OS APIs.
 */

const BASE_URL = "http://127.0.0.1:3000";

async function apiCall(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, opts);
  return res.json();
}

export const tools = [
  {
    name: "dlavie_system_status",
    description: "Check DLavie OS system health: CPU, RAM, disk, AI provider status, and Ollama model list.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [resources, health] = await Promise.all([
        apiCall("/api/resources"),
        apiCall("/api/health"),
      ]);
      return { resources, health };
    }
  },
  {
    name: "dlavie_list_models",
    description: "List all installed Ollama models and available AI providers.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [models, providers] = await Promise.all([
        apiCall("/api/models"),
        apiCall("/api/providers"),
      ]);
      return { models, providers };
    }
  },
  {
    name: "dlavie_pull_model",
    description: "Download an Ollama model to DLavie OS. Example model names: llama3.2, phi3, mistral, qwen2.5-coder.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Ollama model name, e.g. 'llama3.2' or 'phi3:mini'" }
      },
      required: ["model"]
    },
    async execute({ model }) {
      return apiCall("/api/models/pull", "POST", { name: model });
    }
  },
  {
    name: "dlavie_search_knowledge",
    description: "Search the DLavie OS knowledge base (RAG) for relevant documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        method: { type: "string", enum: ["hybrid", "semantic", "keyword"], description: "Search method (default: hybrid)" }
      },
      required: ["query"]
    },
    async execute({ query, method = "hybrid" }) {
      return apiCall(`/api/documents/search?q=${encodeURIComponent(query)}&method=${method}`);
    }
  },
  {
    name: "dlavie_list_training_jobs",
    description: "List all training jobs with their status and progress.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return apiCall("/api/training/jobs");
    }
  },
  {
    name: "dlavie_start_training",
    description: "Start a new AI model training job on DLavie OS.",
    inputSchema: {
      type: "object",
      properties: {
        jobName:    { type: "string", description: "Name for this training job" },
        modelName:  { type: "string", description: "Base Ollama model to fine-tune" },
        datasetId:  { type: "number", description: "ID of the training dataset to use" },
        epochs:     { type: "number", description: "Number of training epochs (default: 3)" },
        learningRate: { type: "number", description: "Learning rate (default: 0.0001)" }
      },
      required: ["jobName", "modelName", "datasetId"]
    },
    async execute(args) {
      return apiCall("/api/training/jobs", "POST", {
        jobName: args.jobName,
        modelName: args.modelName,
        datasetId: args.datasetId,
        epochs: args.epochs ?? 3,
        learningRate: args.learningRate ?? 0.0001,
      });
    }
  },
  {
    name: "dlavie_list_datasets",
    description: "List all training datasets available in DLavie OS.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return apiCall("/api/training/datasets");
    }
  },
  {
    name: "dlavie_create_dataset",
    description: "Create a new training dataset in DLavie OS.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Dataset name" },
        description: { type: "string", description: "What this dataset is for" },
        taskType:    { type: "string", description: "Task type: chat, instruct, code, classification, summarization, etc." }
      },
      required: ["name", "taskType"]
    },
    async execute({ name, description = "", taskType }) {
      return apiCall("/api/training/datasets", "POST", { name, description, taskType });
    }
  },
  {
    name: "dlavie_add_training_sample",
    description: "Add a training sample (input/output pair) to a dataset.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "number", description: "Target dataset ID" },
        input:     { type: "string", description: "Input text / user message" },
        output:    { type: "string", description: "Expected output / assistant response" },
        instruction: { type: "string", description: "Optional system instruction" }
      },
      required: ["datasetId", "input", "output"]
    },
    async execute({ datasetId, input, output, instruction = "" }) {
      return apiCall(`/api/training/datasets/${datasetId}/samples`, "POST", { input, output, instruction });
    }
  },
  {
    name: "dlavie_add_document",
    description: "Add a text document to the DLavie OS knowledge base for RAG search.",
    inputSchema: {
      type: "object",
      properties: {
        title:   { type: "string", description: "Document title" },
        content: { type: "string", description: "Document text content" },
        tags:    { type: "string", description: "Comma-separated tags" }
      },
      required: ["title", "content"]
    },
    async execute({ title, content, tags = "" }) {
      return apiCall("/api/documents", "POST", { title, content, tags });
    }
  },
  {
    name: "dlavie_chat",
    description: "Send a message to DLavie OS AI (uses the full provider chain: Groq → OpenRouter → Ollama). Use this for sub-tasks and reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        message:      { type: "string", description: "Message to send to the AI" },
        systemPrompt: { type: "string", description: "Optional system prompt override" }
      },
      required: ["message"]
    },
    async execute({ message, systemPrompt }) {
      const body = { message, ...(systemPrompt ? { systemPrompt } : {}) };
      const res = await fetch(BASE_URL + "/api/conversations/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.json();
    }
  },
  {
    name: "dlavie_dashboard_stats",
    description: "Get DLavie OS dashboard statistics: conversation count, message count, document count, training sample count.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return apiCall("/api/dashboard");
    }
  }
];
