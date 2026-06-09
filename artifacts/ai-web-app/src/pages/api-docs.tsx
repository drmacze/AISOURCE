import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy, Check, ChevronDown, ChevronRight, Zap, Lock, Globe,
  Play, Terminal, Key, Wifi, WifiOff, RefreshCw, Activity,
  Database, MessageSquare, Brain, Server, Code2, Layers,
  BookOpen, Image, Package, Hash, BarChart3, Cpu, Link2,
  AlertCircle, CheckCircle2, Loader2, ExternalLink, X,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";
const LS_KEY   = "dlavie_api_key";

type Method  = "GET" | "POST" | "DELETE";
type Category = "System" | "Chat" | "Knowledge" | "Conversations" | "Utilities";

interface Endpoint {
  id: string;
  method: Method;
  path: string;
  auth: boolean;
  category: Category;
  summary: string;
  description: string;
  body?: Record<string, string>;
  response?: Record<string, unknown> | string;
  example?: string;
  badge?: string;
}

const CATEGORIES: { name: Category; icon: React.ElementType; color: string }[] = [
  { name: "System",        icon: Server,        color: "text-emerald-400" },
  { name: "Chat",          icon: MessageSquare, color: "text-blue-400" },
  { name: "Knowledge",     icon: Database,      color: "text-violet-400" },
  { name: "Conversations", icon: BookOpen,      color: "text-amber-400" },
  { name: "Utilities",     icon: Zap,           color: "text-pink-400" },
];

const ENDPOINTS: Endpoint[] = [
  // ── System ──
  {
    id: "health",
    method: "GET", path: "/api/v1/health", auth: false, category: "System",
    summary: "System health check",
    description: "Returns real-time status of all DLavie OS subsystems: Ollama local engine, HuggingFace fallback, Kimi K2 (MoonshotAI 1T MoE), and rate limit config.",
    response: { status: "online", version: "1.0.0", engine: "Ollama (local)", ollama: true, huggingface: true, kimi: true, uptime: 3600, rateLimit: { windowMs: 60000, maxRequests: 120 }, timestamp: "ISO8601" },
  },
  {
    id: "openapi",
    method: "GET", path: "/api/v1/openapi.json", auth: false, category: "System",
    summary: "OpenAPI 3.0 specification",
    description: "Machine-readable OpenAPI 3.0 spec. Import into Postman, Swagger UI, or any OpenAPI-compatible tool.",
    badge: "NEW",
  },
  {
    id: "models",
    method: "GET", path: "/api/v1/models", auth: false, category: "System",
    summary: "List installed local models",
    description: "Returns all locally installed Ollama models with metadata. No API key required.",
    response: { models: [{ name: "tinyllama", parameterSize: "1.1B", quantization: "Q4_0", family: "llama", sizeMB: 638, provider: "ollama", ready: true }], count: 1 },
  },
  {
    id: "catalogue",
    method: "GET", path: "/api/v1/models/catalogue", auth: false, category: "System",
    summary: "Full model catalogue — local + cloud",
    description: "Returns all available models: locally installed Ollama models AND cloud models (Kimi K2, HuggingFace Inference). Shows which models are ready based on configured API keys.",
    badge: "NEW",
    response: {
      local: [{ id: "tinyllama", provider: "ollama", ready: true }],
      cloud: [{ id: "kimi/kimi-k2-instruct", provider: "kimi", parameters: "1T MoE", ready: true }, { id: "hf/meta-llama/Llama-3.1-8B-Instruct", provider: "hf", parameters: "8B", ready: false }],
      totalLocal: 1, totalCloud: 4,
    },
  },
  {
    id: "stats",
    method: "GET", path: "/api/v1/stats", auth: true, category: "System",
    summary: "Full system statistics",
    description: "Complete system metrics: conversation/message/document counts, all provider statuses, auto-training stats with per-source breakdown.",
    response: { system: "DLavie OS", conversations: 12, messages: 87, documents: 5, providers: { ollama: { online: true }, kimi: { connected: true } }, autoTraining: { running: true, cyclesCompleted: 5, samplesAdded: 342, sources: ["wikipedia", "hackernews", "reddit", "arxiv"] } },
  },
  // ── Chat ──
  {
    id: "chat",
    method: "POST", path: "/api/v1/chat", auth: true, category: "Chat",
    summary: "Chat with AI — any model (blocking)",
    description: "Send a message and receive a full AI response. Supports ALL model providers: Ollama local models, Kimi K2 (1T MoE via HuggingFace Router), and HuggingFace Inference models. Conversation is saved to database.",
    body: {
      message: "string (required) — user message",
      model: "string (optional, default: tinyllama) — e.g. 'tinyllama', 'qwen2.5:1.5b', 'kimi/kimi-k2-instruct', 'hf/meta-llama/Llama-3.1-8B-Instruct'",
      conversationId: "number (optional) — continue an existing conversation",
      useRAG: "boolean (optional, default: true) — inject knowledge base context",
      systemPrompt: "string (optional) — override system prompt",
    },
    response: { reply: "string", model: "string", provider: "ollama|kimi|hf", conversationId: 1, messageId: 5, tokens: 128, ragContext: true, latencyMs: 342 },
    example: `{ "message": "Explain transformer architecture", "model": "kimi/kimi-k2-instruct", "useRAG": true }`,
  },
  {
    id: "chat-stream",
    method: "POST", path: "/api/v1/chat/stream", auth: true, category: "Chat",
    summary: "Chat — streaming SSE response",
    description: "Returns a Server-Sent Events stream. Each event contains a token chunk. Supports all models. Response header X-Conversation-Id gives you the conversation ID.",
    body: {
      message: "string (required)",
      model: "string (optional) — any supported model",
      conversationId: "number (optional)",
      useRAG: "boolean (optional, default: true)",
    },
    response: "SSE stream: data: {token: 'string', done: false} ... data: {token: '', done: true, fullText: 'complete response'}",
  },
  {
    id: "ask",
    method: "POST", path: "/api/v1/ask", auth: true, category: "Chat",
    summary: "Stateless Q&A — no conversation stored",
    description: "Instant answer to a question. No conversation stored in database. Perfect for integrations like chatbots, WhatsApp bots, Telegram bots.",
    body: {
      question: "string (required)",
      model: "string (optional, default: tinyllama)",
      useRAG: "boolean (optional, default: true)",
      context: "string (optional) — additional context to inject",
    },
    response: { answer: "string", model: "string", provider: "ollama|kimi|hf", ragUsed: true, latencyMs: 285 },
    example: `{ "question": "What is machine learning?", "model": "tinyllama" }`,
  },
  {
    id: "batch",
    method: "POST", path: "/api/v1/batch", auth: true, category: "Chat",
    summary: "Batch Q&A — up to 10 questions at once",
    description: "Send up to 10 questions in one request and get all answers in parallel. Ideal for bulk processing, testing, or data pipelines.",
    badge: "NEW",
    body: {
      questions: "string[] (required) — array of 1–10 questions",
      model: "string (optional, default: tinyllama)",
      useRAG: "boolean (optional, default: false)",
    },
    response: { results: [{ index: 0, question: "What is AI?", answer: "string", model: "tinyllama" }], count: 1, latencyMs: 500 },
    example: `{ "questions": ["What is AI?", "What is deep learning?"], "model": "tinyllama" }`,
  },
  // ── Knowledge ──
  {
    id: "rag-search",
    method: "POST", path: "/api/v1/rag/search", auth: true, category: "Knowledge",
    summary: "Knowledge base search",
    description: "Search your uploaded documents using keyword, semantic, or hybrid matching. Returns ranked results with snippets.",
    body: {
      query: "string (required)",
      topK: "number (optional, default: 5)",
      searchType: "'keyword' | 'semantic' | 'hybrid' (default: 'hybrid')",
    },
    response: [{ documentId: 1, title: "string", snippet: "string", score: 0.85, rank: 1 }],
    example: `{ "query": "machine learning transformers", "topK": 3, "searchType": "hybrid" }`,
  },
  {
    id: "embed",
    method: "POST", path: "/api/v1/embed", auth: true, category: "Knowledge",
    summary: "Generate text embedding vector",
    description: "Convert text to a high-dimensional embedding vector using Ollama (nomic-embed-text). Use for semantic search, clustering, similarity detection.",
    badge: "NEW",
    body: {
      text: "string (required) — text to embed",
      model: "string (optional, default: nomic-embed-text)",
    },
    response: { embedding: "[...384 floats]", dimensions: 384, model: "nomic-embed-text", text: "truncated input..." },
    example: `{ "text": "Explain neural networks" }`,
  },
  {
    id: "generate-image",
    method: "POST", path: "/api/v1/generate/image", auth: true, category: "Knowledge",
    summary: "Generate image from prompt",
    description: "Create an AI-generated image using FLUX.1-schnell or SDXL via HuggingFace. Requires HF_TOKEN configured on the server. Returns base64-encoded PNG.",
    badge: "NEW",
    body: {
      prompt: "string (required)",
      model: "'flux' (default) | 'sdxl' | HuggingFace model ID",
      width: "number (optional, default: 512)",
      height: "number (optional, default: 512)",
      steps: "number (optional, default: 4, max: 8)",
    },
    response: { image: "data:image/png;base64,...", model: "black-forest-labs/FLUX.1-schnell", prompt: "string", width: 512, height: 512 },
    example: `{ "prompt": "A futuristic AI server room, cyberpunk style", "model": "flux", "width": 512, "height": 512 }`,
  },
  // ── Conversations ──
  {
    id: "list-convs",
    method: "GET", path: "/api/v1/conversations", auth: true, category: "Conversations",
    summary: "List all conversations",
    description: "Returns all stored conversations ordered by most recent activity, with message count.",
  },
  {
    id: "create-conv",
    method: "POST", path: "/api/v1/conversations", auth: true, category: "Conversations",
    summary: "Create a new conversation",
    description: "Create an empty conversation. Then send messages to it using /api/v1/chat with conversationId.",
    body: { title: "string (optional)", model: "string (optional)" },
    example: `{ "title": "My AI Project", "model": "tinyllama" }`,
  },
  {
    id: "get-conv",
    method: "GET", path: "/api/v1/conversations/:id", auth: true, category: "Conversations",
    summary: "Get conversation with messages",
    description: "Returns the conversation metadata and complete message history.",
  },
  {
    id: "delete-conv",
    method: "DELETE", path: "/api/v1/conversations/:id", auth: true, category: "Conversations",
    summary: "Delete conversation",
    description: "Permanently deletes the conversation and all its messages.",
  },
];

const METHOD_COLORS: Record<Method, string> = {
  GET:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  POST:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
  DELETE: "bg-red-500/10 text-red-400 border-red-500/20",
};

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${copied ? "text-emerald-400" : "text-slate-500 hover:text-slate-300"} ${className || ""}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function EndpointCard({ endpoint, apiKey, baseUrl }: { endpoint: Endpoint; apiKey: string; baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const curlExample = endpoint.method === "GET"
    ? `curl -s -H "X-API-Key: ${apiKey || "YOUR_KEY"}" "${baseUrl}${endpoint.path}"`
    : `curl -s -X POST "${baseUrl}${endpoint.path}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey || "YOUR_KEY"}" \\
  -d '${endpoint.example || "{}"}' | jq`;

  const jsExample = endpoint.method === "GET"
    ? `const res = await fetch('${baseUrl}${endpoint.path}', {
  headers: { 'X-API-Key': '${apiKey || "YOUR_KEY"}' }
});
const data = await res.json();
console.log(data);`
    : `const res = await fetch('${baseUrl}${endpoint.path}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${apiKey || "YOUR_KEY"}'
  },
  body: JSON.stringify(${endpoint.example || "{}"})
});
const data = await res.json();
console.log(data);`;

  async function runTest() {
    if (!endpoint.auth || apiKey) {
      setTesting(true);
      setTestResult(null);
      try {
        const opts: RequestInit = { headers: { "X-API-Key": apiKey, "Content-Type": "application/json" } };
        if (endpoint.method !== "GET") {
          opts.method = "POST";
          opts.body = endpoint.example || "{}";
        }
        const url = `${API_BASE}${endpoint.path.replace(":id", "1")}`;
        const r = await fetch(url, opts);
        const data = await r.json();
        setTestResult(JSON.stringify(data, null, 2));
      } catch (e) {
        setTestResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setTesting(false);
      }
    }
  }

  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/40 overflow-hidden hover:border-white/10 transition-colors">
      <button
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border flex-shrink-0 ${METHOD_COLORS[endpoint.method]}`}>
          {endpoint.method}
        </span>
        <span className="font-mono text-sm text-slate-300 flex-1 text-left truncate">{endpoint.path}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {endpoint.badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">
              {endpoint.badge}
            </span>
          )}
          {endpoint.auth
            ? <Lock className="w-3.5 h-3.5 text-amber-400/70" />
            : <Globe className="w-3.5 h-3.5 text-emerald-400/70" />}
          {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-5 space-y-4 border-t border-white/5">
              <div className="pt-4">
                <p className="text-sm font-semibold text-white mb-1">{endpoint.summary}</p>
                <p className="text-sm text-slate-400 leading-relaxed">{endpoint.description}</p>
              </div>

              {endpoint.auth && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/8 border border-amber-500/15 rounded-lg px-3 py-2">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  Requires API key in X-API-Key, X-DLavie-Key, or Authorization: Bearer headers
                </div>
              )}

              {endpoint.body && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Request Body</p>
                  <div className="rounded-lg bg-slate-950/60 border border-white/5 p-3 space-y-1.5">
                    {Object.entries(endpoint.body).map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-xs font-mono">
                        <span className="text-blue-400 flex-shrink-0">{k}</span>
                        <span className="text-slate-500">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Code tabs */}
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Examples</p>
                <div className="rounded-lg bg-slate-950/60 border border-white/5 overflow-hidden">
                  {/* cURL */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                    <span className="text-xs font-mono text-slate-500">cURL</span>
                    <CopyButton text={curlExample} />
                  </div>
                  <pre className="text-xs text-slate-300 p-3 overflow-x-auto font-mono leading-relaxed">{curlExample}</pre>

                  {/* JavaScript */}
                  <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
                    <span className="text-xs font-mono text-slate-500">JavaScript / Node.js</span>
                    <CopyButton text={jsExample} />
                  </div>
                  <pre className="text-xs text-slate-300 p-3 overflow-x-auto font-mono leading-relaxed">{jsExample}</pre>
                </div>
              </div>

              {/* Try it */}
              {(endpoint.method === "GET" || endpoint.example) && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Try it live</p>
                    {endpoint.auth && !apiKey && (
                      <span className="text-xs text-amber-400">— enter API key above first</span>
                    )}
                  </div>
                  <button
                    onClick={runTest}
                    disabled={testing || (!!endpoint.auth && !apiKey)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {testing ? "Running…" : "Run Request"}
                  </button>
                  {testResult && (
                    <div className="mt-2 rounded-lg bg-slate-950/80 border border-white/5 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                        <span className="text-xs text-slate-500 font-mono">Response</span>
                        <div className="flex items-center gap-2">
                          <CopyButton text={testResult} />
                          <button onClick={() => setTestResult(null)} className="text-slate-600 hover:text-slate-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <pre className="text-xs text-emerald-300 p-3 overflow-x-auto max-h-48 font-mono">{testResult}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ApiDocs() {
  const [apiKey, setApiKey]     = useState(() => localStorage.getItem(LS_KEY) || "");
  const [activeTab, setActiveTab] = useState<Category>("System");
  const [copied, setCopied]     = useState(false);
  const [healthData, setHealthData] = useState<Record<string, unknown> | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    localStorage.setItem(LS_KEY, apiKey);
  }, [apiKey]);

  const fetchHealth = useCallback(() => {
    setHealthLoading(true);
    fetch(`${API_BASE}/api/v1/health`)
      .then((r) => r.json())
      .then((d) => setHealthData(d))
      .catch(() => setHealthData(null))
      .finally(() => setHealthLoading(false));
  }, []);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 30_000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  const filteredEndpoints = ENDPOINTS.filter((e) => e.category === activeTab);
  const online = healthData?.status === "online";

  return (
    <div className="min-h-full bg-slate-950 p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">DLavie OS API</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Multi-platform AI API · v1 · Rate limit: 120 req/min
            </p>
          </div>
        </motion.div>

        {/* Status bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${
            healthLoading ? "bg-slate-800/50 border-white/5 text-slate-400" :
            online ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
            "bg-red-500/10 border-red-500/20 text-red-400"
          }`}>
            {healthLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
             online ? <CheckCircle2 className="w-3.5 h-3.5" /> :
             <AlertCircle className="w-3.5 h-3.5" />}
            {healthLoading ? "Checking…" : online ? "API Online" : "API Offline"}
          </div>
          {healthData && (
            <>
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${healthData.ollama ? "bg-emerald-500/8 border-emerald-500/15 text-emerald-400" : "bg-slate-800/50 border-white/5 text-slate-500"}`}>
                <Server className="w-3 h-3" />
                Ollama {healthData.ollama ? "online" : "offline"}
              </div>
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${healthData.kimi ? "bg-blue-500/8 border-blue-500/15 text-blue-400" : "bg-slate-800/50 border-white/5 text-slate-500"}`}>
                <Zap className="w-3 h-3" />
                Kimi K2 {healthData.kimi ? "ready" : "not set"}
              </div>
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${healthData.huggingface ? "bg-violet-500/8 border-violet-500/15 text-violet-400" : "bg-slate-800/50 border-white/5 text-slate-500"}`}>
                <Brain className="w-3 h-3" />
                HuggingFace {healthData.huggingface ? "ready" : "not set"}
              </div>
            </>
          )}
          <button onClick={fetchHealth} className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </motion.div>
      </div>

      {/* API Key Input */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-4 h-4 text-amber-400" />
          <p className="text-sm font-semibold text-amber-300">API Key</p>
          <span className="ml-auto text-xs text-slate-500">Saved in browser</span>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="nxs_your_api_key_here..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-slate-300 focus:outline-none focus:border-amber-500/40 placeholder:text-slate-600"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(apiKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="px-3 py-2 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Set <code className="text-amber-400/80">NEXUS_API_KEY</code> in Replit Secrets. The key is used for live testing below.
        </p>
      </motion.div>

      {/* Base URL */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-white/5 bg-slate-900/40 p-4"
      >
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="w-4 h-4 text-slate-400" />
          <p className="text-sm font-semibold text-white">Base URL</p>
          <a
            href="/api/v1/health"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open in browser
          </a>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-emerald-400 bg-slate-950/60 border border-white/5 rounded-lg px-3 py-2 overflow-x-auto">
            {baseUrl}/api/v1
          </code>
          <CopyButton text={`${baseUrl}/api/v1`} />
        </div>
      </motion.div>

      {/* Integration Examples */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-xl border border-white/5 bg-slate-900/40 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <Terminal className="w-4 h-4 text-slate-400" />
          <p className="text-sm font-semibold text-white">Multi-platform Usage</p>
        </div>
        <div className="p-4 space-y-4">
          {[
            {
              label: "WhatsApp / Telegram Bot",
              lang: "JavaScript",
              code: `// Use in any chatbot framework
const { answer } = await fetch('${baseUrl}/api/v1/ask', {
  method: 'POST',
  headers: { 'X-API-Key': '${apiKey || "YOUR_KEY"}', 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: incomingMessage, model: 'tinyllama', useRAG: true }),
}).then(r => r.json());
await bot.sendMessage(chatId, answer);`,
            },
            {
              label: "Python / FastAPI Integration",
              lang: "Python",
              code: `import httpx

client = httpx.Client(
    base_url="${baseUrl}/api/v1",
    headers={"X-API-Key": "${apiKey || "YOUR_KEY"}"}
)

# Single question
resp = client.post("/ask", json={"question": "Explain RAG", "model": "tinyllama"})
print(resp.json()["answer"])

# Kimi K2 (1T MoE)
resp = client.post("/chat", json={
    "message": "Write a detailed analysis",
    "model": "kimi/kimi-k2-instruct"
})
print(resp.json()["reply"])`,
            },
            {
              label: "Streaming (Browser / Node.js)",
              lang: "JavaScript",
              code: `const response = await fetch('${baseUrl}/api/v1/chat/stream', {
  method: 'POST',
  headers: { 'X-API-Key': '${apiKey || "YOUR_KEY"}', 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Explain transformers', model: 'qwen2.5:1.5b' }),
});
const reader = response.body.getReader();
const dec = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const line of dec.decode(value).split('\\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = JSON.parse(line.slice(6));
    if (d.token) process.stdout.write(d.token);
    if (d.done) break;
  }
}`,
            },
          ].map(({ label, lang, code }) => (
            <div key={label} className="rounded-lg bg-slate-950/60 border border-white/5 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">{label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 font-mono">{lang}</span>
                </div>
                <CopyButton text={code} />
              </div>
              <pre className="text-xs text-slate-300 p-3 overflow-x-auto font-mono leading-relaxed">{code}</pre>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Category tabs */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex overflow-x-auto gap-1 pb-1"
      >
        {CATEGORIES.map(({ name, icon: Icon, color }) => (
          <button
            key={name}
            onClick={() => setActiveTab(name)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 flex-shrink-0 ${
              activeTab === name
                ? "bg-white/8 text-white border border-white/10"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/4"
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${activeTab === name ? color : "opacity-60"}`} />
            {name}
            <span className="text-[10px] bg-white/8 text-slate-400 px-1.5 py-0.5 rounded-full">
              {ENDPOINTS.filter((e) => e.category === name).length}
            </span>
          </button>
        ))}
      </motion.div>

      {/* Endpoints */}
      <div className="space-y-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            {filteredEndpoints.map((ep) => (
              <EndpointCard key={ep.id} endpoint={ep} apiKey={apiKey} baseUrl={baseUrl} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Rate limit info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="rounded-xl border border-white/5 bg-slate-900/30 p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-slate-400" />
          <p className="text-sm font-semibold text-white">Rate Limits</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="rounded-lg bg-slate-950/40 border border-white/5 p-3">
            <p className="text-slate-500 mb-1">Requests/minute</p>
            <p className="text-white text-base font-bold">120</p>
            <p className="text-slate-600 mt-0.5">per API key</p>
          </div>
          <div className="rounded-lg bg-slate-950/40 border border-white/5 p-3">
            <p className="text-slate-500 mb-1">Response headers</p>
            <p className="text-emerald-400 text-[10px] leading-5">X-RateLimit-Limit<br/>X-RateLimit-Remaining<br/>X-RateLimit-Reset</p>
          </div>
          <div className="rounded-lg bg-slate-950/40 border border-white/5 p-3">
            <p className="text-slate-500 mb-1">Exceeded response</p>
            <p className="text-red-400 text-[10px]">HTTP 429<br/>retryAfter: seconds</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
