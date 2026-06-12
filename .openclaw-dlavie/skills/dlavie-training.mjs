
/**
 * DLavie OS Training Skills — for trainer agent
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: `${res.status}: ${await res.text()}` };
}

export const tools = [
  {
    name: "training_list_datasets",
    description: "List all training datasets with sample counts and task types.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/training-datasets"); },
  },
  {
    name: "training_create_dataset",
    description: "Create a new training dataset.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string" },
        description: { type: "string" },
        taskType:    { type: "string", description: "chat/instruct/code/classification/summarization" },
      },
      required: ["name", "taskType"],
    },
    async execute({ name, description = "", taskType }) {
      return api("/api/training-datasets", "POST", { name, description, taskType });
    },
  },
  {
    name: "training_add_sample",
    description: "Add a training sample (input/output pair) to a dataset.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId:   { type: "number" },
        input:       { type: "string" },
        output:      { type: "string" },
        instruction: { type: "string" },
        source:      { type: "string" },
      },
      required: ["datasetId", "input", "output"],
    },
    async execute({ datasetId, input, output, instruction = "", source = "agent" }) {
      return api(`/api/training-datasets/${datasetId}/samples`, "POST", { input, output, instruction, source });
    },
  },
  {
    name: "training_start_job",
    description: "Start a new AI model training job.",
    inputSchema: {
      type: "object",
      properties: {
        jobName:      { type: "string" },
        modelName:    { type: "string" },
        datasetId:    { type: "number" },
        epochs:       { type: "number" },
        learningRate: { type: "number" },
      },
      required: ["jobName", "modelName", "datasetId"],
    },
    async execute({ jobName, modelName, datasetId, epochs = 3, learningRate = 0.0001 }) {
      return api("/api/training-jobs", "POST", { jobName, modelName, datasetId, epochs, learningRate });
    },
  },
  {
    name: "training_list_jobs",
    description: "List all training jobs with status and progress.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/training-jobs"); },
  },
  {
    name: "training_list_models",
    description: "List all registered AI models and Ollama models.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [aiModels, ollamaModels] = await Promise.all([
        api("/api/ai-models"),
        api("/api/ollama-models"),
      ]);
      return { aiModels, ollamaModels };
    },
  },
  {
    name: "training_pull_model",
    description: "Download an Ollama model (e.g. llama3.2, phi3, mistral, qwen2.5-coder).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Ollama model name" } },
      required: ["name"],
    },
    async execute({ name }) { return api("/api/ollama-models/pull", "POST", { name }); },
  },
  {
    name: "training_run_benchmark",
    description: "Run a benchmark on a trained model.",
    inputSchema: {
      type: "object",
      properties: {
        jobId:     { type: "number" },
        modelName: { type: "string" },
      },
      required: ["modelName"],
    },
    async execute({ jobId, modelName }) {
      return api("/api/training/benchmark", "POST", { jobId, modelName, metrics: ["perplexity", "bleu"] });
    },
  },
  {
    name: "training_import_hf_dataset",
    description: "Search and import a dataset from HuggingFace Hub.",
    inputSchema: {
      type: "object",
      properties: {
        query:     { type: "string", description: "Search query (e.g. 'instruction tuning Indonesian')" },
        limit:     { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    async execute({ query, limit = 5 }) {
      return api(`/api/hf/datasets/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    },
  },
  {
    name: "training_analytics",
    description: "Get comprehensive training analytics: job history, model performance, dataset stats.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      const [analytics, benchmarks, queue] = await Promise.all([
        api("/api/training/analytics"),
        api("/api/training/benchmarks"),
        api("/api/training/queue"),
      ]);
      return { analytics, benchmarks, queue };
    },
  },
];
