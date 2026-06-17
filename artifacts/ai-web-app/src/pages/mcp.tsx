import { useState, useEffect, useCallback } from "react";
import {
  Server, Wrench, Copy, Check, RefreshCw, ChevronDown, ChevronRight,
  Zap, MessageSquare, Database, BookOpen, Cpu, FlaskConical, Key,
  BarChart2, FolderOpen, PlusCircle, Search, PlayCircle, ExternalLink,
  Shield, CheckCircle2, XCircle, AlertCircle, Plug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────
interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

interface McpStatus {
  status: "online" | "offline" | "loading";
  toolCount: number;
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
}

// ─── Static tool metadata ─────────────────────────────────────────────────────
const TOOL_ICONS: Record<string, typeof Zap> = {
  system_status:        Cpu,
  dashboard_stats:      BarChart2,
  chat:                 MessageSquare,
  list_conversations:   MessageSquare,
  create_conversation:  PlusCircle,
  search_knowledge:     Search,
  list_documents:       FolderOpen,
  upload_document:      Database,
  list_models:          Cpu,
  list_datasets:        BookOpen,
  start_training:       PlayCircle,
  save_secret:          Key,
};

const TOOL_COLORS: Record<string, string> = {
  system_status:        "text-emerald-400",
  dashboard_stats:      "text-blue-400",
  chat:                 "text-primary",
  list_conversations:   "text-primary",
  create_conversation:  "text-green-400",
  search_knowledge:     "text-violet-400",
  list_documents:       "text-amber-400",
  upload_document:      "text-amber-400",
  list_models:          "text-cyan-400",
  list_datasets:        "text-orange-400",
  start_training:       "text-red-400",
  save_secret:          "text-rose-400",
};

const TOOL_CATEGORIES: Record<string, string> = {
  system_status:        "System",
  dashboard_stats:      "System",
  chat:                 "Chat",
  list_conversations:   "Chat",
  create_conversation:  "Chat",
  search_knowledge:     "Knowledge",
  list_documents:       "Knowledge",
  upload_document:      "Knowledge",
  list_models:          "Models",
  list_datasets:        "Training",
  start_training:       "Training",
  save_secret:          "Admin",
};

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
                 bg-muted/40 hover:bg-muted/80 text-muted-foreground hover:text-foreground
                 border border-border/40 transition-all gap-1"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Code block ───────────────────────────────────────────────────────────────
function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  return (
    <div className={cn("relative group rounded-lg border border-border/50 bg-muted/20 overflow-hidden", className)}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30">
        <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 text-xs font-mono text-foreground/90 overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

// ─── Tool card ────────────────────────────────────────────────────────────────
function ToolCard({ tool }: { tool: McpTool }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;
  const color = TOOL_COLORS[tool.name] ?? "text-muted-foreground";
  const category = TOOL_CATEGORIES[tool.name] ?? "Other";
  const params = Object.entries(tool.inputSchema?.properties ?? {});
  const required = tool.inputSchema?.required ?? [];

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden transition-colors hover:border-border/80">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/20 transition-colors"
      >
        <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center border border-border/40", open && "border-border/60")}>
          <Icon className={cn("w-4 h-4", color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono font-semibold text-foreground">{tool.name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground border-border/50">
              {category}
            </Badge>
            {params.length > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground border-border/50">
                {params.length} param{params.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tool.description}</p>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        }
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="p-4 space-y-4 bg-muted/10">
              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>

              {/* Parameters */}
              {params.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Parameters</p>
                  <div className="space-y-2">
                    {params.map(([name, schema]) => (
                      <div key={name} className="flex items-start gap-2.5 rounded-lg px-3 py-2 bg-muted/30 border border-border/30">
                        <code className={cn(
                          "text-xs font-mono font-bold flex-shrink-0 mt-0.5",
                          required.includes(name) ? "text-primary" : "text-muted-foreground"
                        )}>
                          {name}
                        </code>
                        {required.includes(name) && (
                          <Badge className="text-[9px] px-1 py-0 h-3.5 bg-primary/20 text-primary border-primary/30 flex-shrink-0 mt-0.5">
                            required
                          </Badge>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border/40 text-muted-foreground">
                              {schema.type}
                            </Badge>
                            {schema.enum && (
                              <span className="text-[10px] text-muted-foreground">
                                [{schema.enum.join(" | ")}]
                              </span>
                            )}
                          </div>
                          {schema.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{schema.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Example JSON */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">MCP Request Example</p>
                <CodeBlock lang="json" code={JSON.stringify({
                  jsonrpc: "2.0",
                  method: "tools/call",
                  params: {
                    name: tool.name,
                    arguments: params.length === 0 ? {} : Object.fromEntries(
                      params.slice(0, 3).map(([n, s]) => [n, s.type === "number" ? 1 : s.enum ? s.enum[0] : `<${n}>`])
                    ),
                  },
                  id: 1,
                }, null, 2)} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Config card (Claude Desktop / Cursor / VS Code) ─────────────────────────
function ConfigCard({
  icon, title, badge, code, lang, note,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  code: string;
  lang: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-muted/20">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            {badge && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{badge}</Badge>}
          </div>
        </div>
        <CopyButton text={code} label="Copy Config" />
      </div>
      <div className="p-0">
        <pre className="p-4 text-xs font-mono text-foreground/90 overflow-x-auto whitespace-pre leading-relaxed bg-muted/10">
          {code}
        </pre>
        {note && (
          <p className="text-xs text-muted-foreground px-4 pb-3 -mt-1">{note}</p>
        )}
      </div>
    </div>
  );
}

// ─── Category filter ──────────────────────────────────────────────────────────
const CATEGORIES = ["All", "System", "Chat", "Knowledge", "Models", "Training", "Admin"];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function McpPage() {
  const [status, setStatus] = useState<McpStatus>({
    status: "loading", toolCount: 0,
    serverName: "DLavie OS", serverVersion: "1.0.0", protocolVersion: "2024-11-05",
  });
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "https://your.replit.app";
  const mcpUrl = `${origin}/api/mcp`;
  const apiBase = origin;

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      // Initialize
      await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dlavio-ui", version: "1.0.0" } }, id: 0 }),
      });

      // List tools
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: {}, id: 1 }),
      });
      const raw = await r.text();

      let data: { result?: { tools: McpTool[] } } | null = null;
      // Try direct JSON first
      try { data = JSON.parse(raw); }
      catch {
        // SSE format
        const match = raw.split("\n").find((l) => l.startsWith("data:"));
        if (match) data = JSON.parse(match.slice(5));
      }

      if (data?.result?.tools) {
        setTools(data.result.tools);
        setStatus({ status: "online", toolCount: data.result.tools.length, serverName: "DLavie OS MCP", serverVersion: "1.0.0", protocolVersion: "2024-11-05" });
      } else {
        setStatus((s) => ({ ...s, status: "offline" }));
      }
    } catch {
      setStatus((s) => ({ ...s, status: "offline" }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  // Filter
  const filtered = tools.filter((t) => {
    const matchCat = activeCategory === "All" || TOOL_CATEGORIES[t.name] === activeCategory;
    const matchSearch = !search || t.name.includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Config strings
  const claudeConfig = `{
  "mcpServers": {
    "dlavie-os": {
      "url": "${mcpUrl}",
      "transport": "http"
    }
  }
}`;

  const cursorConfig = `// .cursor/mcp.json
{
  "mcpServers": {
    "dlavie-os": {
      "url": "${mcpUrl}",
      "transport": "streamableHttp"
    }
  }
}`;

  const vscodeConfig = `// .vscode/mcp.json
{
  "servers": {
    "dlavie-os": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`;

  const continueCfg = `// ~/.continue/config.json  (add inside "mcpServers")
{
  "name": "dlavie-os",
  "url": "${mcpUrl}",
  "transport": "http"
}`;

  const curlTest = `# 1) Initialize session
curl -X POST ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":0}'

# 2) List all tools
curl -X POST ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'

# 3) Call system_status tool
curl -X POST ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"system_status","arguments":{}},"id":2}'

# 4) Chat with the AI
curl -X POST ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"chat","arguments":{"message":"Hello from MCP!"}},"id":3}'`;

  const StatusIcon = status.status === "online"
    ? CheckCircle2
    : status.status === "offline"
    ? XCircle
    : AlertCircle;

  const statusColor = status.status === "online"
    ? "text-green-400"
    : status.status === "offline"
    ? "text-red-400"
    : "text-amber-400 animate-pulse";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Server className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
                MCP Server
              </h1>
              <p className="text-sm text-muted-foreground">
                Model Context Protocol — hubungkan Claude, Cursor, VS Code ke DLavie OS
              </p>
            </div>
          </div>
        </motion.div>

        {/* ── Status banner ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <div className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl border",
            status.status === "online"  ? "border-green-500/30 bg-green-500/5" :
            status.status === "offline" ? "border-red-500/30 bg-red-500/5"    :
            "border-border/40 bg-muted/20"
          )}>
            <StatusIcon className={cn("w-4 h-4 flex-shrink-0", statusColor)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-sm font-medium", status.status === "online" ? "text-green-400" : status.status === "offline" ? "text-red-400" : "text-muted-foreground")}>
                  {status.status === "loading" ? "Memeriksa MCP server…"
                   : status.status === "online" ? "MCP Server Online"
                   : "MCP Server Offline"}
                </span>
                {status.status === "online" && (
                  <>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-green-400 border-green-500/30">
                      {status.toolCount} tools
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground border-border/40">
                      MCP {status.protocolVersion}
                    </Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <code className="text-xs text-muted-foreground font-mono truncate">{mcpUrl}</code>
                <CopyButton text={mcpUrl} label="Copy URL" />
              </div>
            </div>
            <button
              onClick={fetchTools}
              disabled={loading}
              className="p-1.5 hover:bg-muted/60 rounded text-muted-foreground disabled:opacity-50 flex-shrink-0"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </motion.div>

        {/* ── Quick capabilities ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Yang bisa dilakukan AI Client via MCP</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { Icon: MessageSquare, label: "Chat & Conversations",  desc: "Buat, baca, kirim pesan" },
              { Icon: Database,      label: "Knowledge Base",        desc: "Upload, cari dokumen" },
              { Icon: Cpu,           label: "System Status",         desc: "Monitor server secara real-time" },
              { Icon: FlaskConical,  label: "Training Jobs",         desc: "Dataset & model training" },
              { Icon: BarChart2,     label: "Dashboard Stats",       desc: "Statistik sistem lengkap" },
              { Icon: Shield,        label: "Secret Management",     desc: "Simpan API keys dengan aman" },
            ].map(({ Icon, label, desc }) => (
              <div key={label} className="flex gap-2.5 p-3 rounded-lg border border-border/40 bg-muted/10">
                <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-medium text-foreground leading-snug">{label}</div>
                  <div className="text-[11px] text-muted-foreground">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Client configs ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Config untuk Client</h2>

          <ConfigCard
            icon={<div className="w-6 h-6 rounded bg-[#D97706]/20 flex items-center justify-center text-[#D97706] text-xs font-bold">C</div>}
            title="Claude Desktop"
            badge="claude_desktop_config.json"
            code={claudeConfig}
            lang="json"
            note='Tambahkan ke file: ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) atau %APPDATA%/Claude/claude_desktop_config.json (Windows). Restart Claude setelahnya.'
          />

          <ConfigCard
            icon={<div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">↗</div>}
            title="Cursor"
            badge=".cursor/mcp.json"
            code={cursorConfig}
            lang="json"
            note="Buat file .cursor/mcp.json di root project Anda, atau tambahkan ke Cursor global settings."
          />

          <ConfigCard
            icon={<div className="w-6 h-6 rounded bg-blue-600/20 flex items-center justify-center text-blue-400 text-xs font-bold">⬡</div>}
            title="VS Code (GitHub Copilot)"
            badge=".vscode/mcp.json"
            code={vscodeConfig}
            lang="json"
            note="Membutuhkan VS Code 1.99+ dengan GitHub Copilot. Buat file .vscode/mcp.json di project Anda."
          />

          <ConfigCard
            icon={<div className="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center text-violet-400 text-xs font-bold">▶</div>}
            title="Continue.dev"
            badge="~/.continue/config.json"
            code={continueCfg}
            lang="json"
            note="Tambahkan ke array mcpServers di ~/.continue/config.json. Continue.dev support MCP via HTTP transport."
          />
        </motion.div>

        {/* ── Tools list ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {loading ? "Memuat tools…" : `${tools.length} Tools Tersedia`}
            </h2>
            {/* Search */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/40 bg-muted/20 min-w-0">
              <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari tool…"
                className="text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground w-32"
              />
            </div>
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                  activeCategory === cat
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-muted/20 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {cat}
                {cat !== "All" && tools.filter((t) => TOOL_CATEGORIES[t.name] === cat).length > 0 && (
                  <span className="ml-1 opacity-60">
                    {tools.filter((t) => TOOL_CATEGORIES[t.name] === cat).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tool cards */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[58px] rounded-xl border border-border/30 bg-muted/10 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Tidak ada tool yang cocok dengan filter.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          )}
        </motion.div>

        {/* ── curl test ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Test Manual via curl</h2>
          <CodeBlock lang="bash" code={curlTest} />
        </motion.div>

        {/* ── Transport info ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
          <div className="rounded-xl border border-border/50 bg-muted/10 p-4 space-y-3">
            <h3 className="text-xs font-semibold text-foreground">Info Teknis</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                { key: "Endpoint",           val: `POST ${mcpUrl}` },
                { key: "Transport",          val: "Streamable HTTP (MCP 2025-03-26)" },
                { key: "Protocol Version",   val: "2024-11-05 compatible" },
                { key: "Content-Type",       val: "application/json" },
                { key: "Accept",             val: "application/json, text/event-stream" },
                { key: "Auth",               val: "None required (local server)" },
              ].map(({ key, val }) => (
                <div key={key} className="flex gap-2">
                  <span className="text-muted-foreground w-32 flex-shrink-0">{key}:</span>
                  <span className="font-mono text-foreground/80 break-all">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Footer links ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="flex flex-wrap gap-3 pb-6"
        >
          <a href="/api/mcp" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> MCP Endpoint
            </Button>
          </a>
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> MCP Docs
            </Button>
          </a>
          <a href="/api-docs" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <BookOpen className="w-3.5 h-3.5" /> REST API Docs
            </Button>
          </a>
          <a href="/chatgpt" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <Plug className="w-3.5 h-3.5" /> ChatGPT Actions
            </Button>
          </a>
        </motion.div>

      </div>
    </div>
  );
}

