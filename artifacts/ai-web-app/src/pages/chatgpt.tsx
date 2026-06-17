import { useState, useEffect, useCallback } from "react";
import {
  Copy, Check, ExternalLink, Bot, Zap, Database, BookOpen, RefreshCw,
  Plug, MessageSquare, Key, Shield, Users, BarChart2, Settings,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────
interface StatusData {
  status: string;
  version?: string;
  providers?: Record<string, boolean>;
  stats?: { conversations: number; documents: number; trainingSamples: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-1.5 transition-colors",
        label
          ? "px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted/40 hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/40"
          : "p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground",
      )}
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {label && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="relative rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30">
        <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 text-xs font-mono text-foreground/90 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
    </div>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 bg-muted/20">
        <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
          {step}
        </div>
        <span className="font-semibold text-sm text-foreground">{title}</span>
      </div>
      <div className="p-5 space-y-3">{children}</div>
    </div>
  );
}

function ProviderDot({ active }: { active: boolean }) {
  return (
    <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", active ? "bg-green-400" : "bg-muted-foreground/40")} />
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 w-full mb-3 group">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest group-hover:text-foreground transition-colors">
          {title}
        </span>
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Live Chat Test ───────────────────────────────────────────────────────────
function LiveChatTest({ apiBase }: { apiBase: string }) {
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ reply: string; provider: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!msg.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const d = await r.json() as { reply?: string; provider?: string; error?: string };
      if (d.error) setError(d.error);
      else setResult({ reply: d.reply ?? "", provider: d.provider ?? "unknown" });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/20">
        <MessageSquare className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground">Test Live — Kirim pesan ke DLavie OS AI</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && send()}
            placeholder="Coba: 'Berapa training samples saya?' atau 'Apa itu RAG?'"
            className="flex-1 px-3 py-2 text-xs bg-muted/30 border border-border/40 rounded-lg outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={send}
            disabled={loading || !msg.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {loading ? "..." : "Kirim"}
          </button>
        </div>
        {result && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-green-400" />
              <span className="text-[10px] text-muted-foreground">via {result.provider}</span>
            </div>
            <div className="px-3 py-2.5 rounded-lg bg-muted/30 border border-border/30 text-xs text-foreground/90 leading-relaxed">
              {result.reply}
            </div>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ChatGPTIntegrationPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain.replit.app";
  const openapiUrl = `${origin}/.well-known/openapi.yaml`;
  const pluginUrl  = `${origin}/.well-known/ai-plugin.json`;
  const apiBase    = `${origin}/api/chatgpt`;

  const fetchStatus = useCallback(() => {
    setLoading(true);
    fetch("/api/chatgpt/status")
      .then((r) => r.json())
      .then((d: StatusData) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Capabilities ──────────────────────────────────────────────────────────
  const capabilities = [
    { icon: MessageSquare, label: "Chat AI Langsung",           desc: "Tanya DLavie OS AI & dapatkan respons real-time via /chat" },
    { icon: Bot,           label: "Kelola Conversations",       desc: "List, buat, hapus conversations + baca message history" },
    { icon: BookOpen,      label: "Knowledge Base CRUD",        desc: "Upload, edit, hapus, dan cari dokumen RAG" },
    { icon: Database,      label: "Training Data",              desc: "Tambah & baca training samples untuk fine-tuning" },
    { icon: Key,           label: "Simpan API Keys",            desc: "Set GROQ_API_KEY, HF_TOKEN, dll via ChatGPT" },
    { icon: Shield,        label: "Provider Status",            desc: "Cek Groq, OpenRouter, HuggingFace, Ollama" },
    { icon: Users,         label: "Agent System",               desc: "Monitor 24 AI agent yang berjalan 24/7" },
    { icon: Zap,           label: "Kaggle GPU Training",        desc: "Sync dataset & trigger LoRA training di Kaggle GPU" },
  ];

  // ── Endpoints ─────────────────────────────────────────────────────────────
  const endpoints = [
    { method: "GET",    path: "/api/chatgpt/status",                     desc: "Status sistem (public, no auth)" },
    { method: "POST",   path: "/api/chatgpt/chat",                       desc: "Chat dengan DLavie OS AI ← BARU" },
    { method: "GET",    path: "/api/chatgpt/conversations",               desc: "List conversations" },
    { method: "GET",    path: "/api/chatgpt/conversations/:id",           desc: "Conversation + messages" },
    { method: "POST",   path: "/api/chatgpt/conversations",               desc: "Buat conversation baru" },
    { method: "POST",   path: "/api/chatgpt/conversations/:id/messages",  desc: "Tambah pesan" },
    { method: "DELETE", path: "/api/chatgpt/conversations/:id",           desc: "Hapus conversation" },
    { method: "GET",    path: "/api/chatgpt/documents",                   desc: "List dokumen knowledge base" },
    { method: "POST",   path: "/api/chatgpt/documents",                   desc: "Upload dokumen baru" },
    { method: "PATCH",  path: "/api/chatgpt/documents/:id",               desc: "Edit dokumen" },
    { method: "DELETE", path: "/api/chatgpt/documents/:id",               desc: "Hapus dokumen" },
    { method: "GET",    path: "/api/chatgpt/search?q=...",                desc: "Cari di knowledge base" },
    { method: "GET",    path: "/api/chatgpt/training",                    desc: "List training samples" },
    { method: "POST",   path: "/api/chatgpt/training",                    desc: "Tambah training sample" },
    { method: "GET",    path: "/api/chatgpt/settings",                    desc: "Baca settings & provider keys ← BARU" },
    { method: "POST",   path: "/api/chatgpt/settings",                    desc: "Simpan API keys ke server ← BARU" },
    { method: "GET",    path: "/api/chatgpt/models",                      desc: "List Ollama + provider models ← BARU" },
    { method: "GET",    path: "/api/chatgpt/agents",                      desc: "Status 24 AI agents ← BARU" },
    { method: "GET",    path: "/api/chatgpt/providers",                   desc: "Health check semua provider ← BARU" },
    { method: "POST",   path: "/api/chatgpt/kaggle/sync",                 desc: "Sync dataset ke Kaggle" },
    { method: "POST",   path: "/api/chatgpt/kaggle/train",                desc: "Jalankan GPU training" },
  ];

  const methodColor: Record<string, string> = {
    GET: "text-blue-400", POST: "text-green-400",
    PATCH: "text-yellow-400", DELETE: "text-red-400",
  };

  // ── Example prompts ───────────────────────────────────────────────────────
  const prompts = [
    "Cek status DLavie OS — berapa conversations, dokumen, dan training samples yang ada?",
    "Tanya AI DLavie OS: 'Apa itu Retrieval-Augmented Generation?'",
    "Buat dokumen baru di knowledge base dengan judul 'Catatan Setup' dan isi instruksi setup ini",
    "Tambahkan training sample: input='Apa itu DLavie OS?', output='DLavie OS adalah AI Command Center lokal...'",
    "Cari dokumen di knowledge base yang membahas 'fine-tuning'",
    "Simpan API key ini ke server: GROQ_API_KEY=gsk_xxxxxxxxxxxx",
    "Tampilkan status semua AI provider: Groq, OpenRouter, HuggingFace, Ollama",
    "List 5 conversation terbaru di DLavie OS beserta judul dan tanggal",
    "Sync training dataset ke Kaggle dan mulai GPU training",
    "Tampilkan status 24 AI agent yang berjalan di DLavie OS",
  ];

  const isOnline = !loading && status?.status === "online";
  const isOffline = !loading && status?.status !== "online";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Plug className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
                ChatGPT Actions Integration
              </h1>
              <p className="text-sm text-muted-foreground">
                Hubungkan ChatGPT Anda ke DLavie OS — read, write, chat, dan kelola semuanya
              </p>
            </div>
          </div>
        </motion.div>

        {/* ── Status banner ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <div className={cn(
            "rounded-xl border px-4 py-3 space-y-2",
            loading  ? "border-border/40 bg-muted/20"      :
            isOnline ? "border-green-500/30 bg-green-500/5" :
            "border-red-500/30 bg-red-500/5",
          )}>
            {/* Top row */}
            <div className="flex items-center gap-3">
              {loading
                ? <AlertCircle className="w-4 h-4 text-muted-foreground animate-pulse flex-shrink-0" />
                : isOnline
                ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <span className={cn("text-sm font-medium",
                  loading ? "text-muted-foreground" : isOnline ? "text-green-400" : "text-red-400"
                )}>
                  {loading ? "Memeriksa server…" : isOnline ? "DLavie OS Online" : "Server tidak dapat dijangkau"}
                </span>
                {isOnline && status?.stats && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {status.stats.conversations} conversations · {status.stats.documents} docs · {status.stats.trainingSamples} training samples
                  </span>
                )}
              </div>
              <button onClick={fetchStatus} className="p-1 hover:bg-muted/60 rounded text-muted-foreground flex-shrink-0">
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              </button>
            </div>

            {/* Provider dots */}
            {isOnline && status?.providers && (
              <div className="flex flex-wrap gap-3 pt-0.5">
                {Object.entries(status.providers).map(([name, active]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <ProviderDot active={!!active} />
                    <span className="text-[11px] text-muted-foreground capitalize">{name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Live test ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <LiveChatTest apiBase="/api/chatgpt" />
        </motion.div>

        {/* ── Capabilities ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Section title="Yang bisa ChatGPT lakukan via DLavie OS">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {capabilities.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex gap-3 p-3 rounded-lg border border-border/40 bg-muted/10">
                  <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold text-foreground">{label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>

        {/* ── Setup steps ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <Section title="Cara Setup di ChatGPT (5 langkah)">
            <div className="space-y-3">

              <StepCard step={1} title="Buka chatgpt.com → klik nama Anda → My GPTs → Create a GPT">
                <p className="text-sm text-muted-foreground">
                  Login ke{" "}
                  <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    chatgpt.com
                  </a>
                  , klik nama Anda di sidebar kiri → <strong className="text-foreground">My GPTs</strong> → <strong className="text-foreground">+ Create a GPT</strong>.
                  Beri nama: <code className="bg-muted/50 px-1 rounded text-xs">DLavie OS</code>.
                </p>
              </StepCard>

              <StepCard step={2} title='Tab "Configure" → scroll ke "Actions" → Create new action'>
                <p className="text-sm text-muted-foreground">
                  Klik tab <strong className="text-foreground">Configure</strong>, scroll ke bawah, klik{" "}
                  <strong className="text-foreground">+ Create new action</strong>.
                </p>
              </StepCard>

              <StepCard step={3} title="Import OpenAPI schema dari URL ini">
                <p className="text-sm text-muted-foreground">
                  Klik <strong className="text-foreground">Import from URL</strong>, paste URL di bawah, klik <strong className="text-foreground">Import</strong>:
                </p>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 font-mono text-xs text-primary truncate flex items-center">
                    {openapiUrl}
                  </div>
                  <CopyButton text={openapiUrl} label="Copy" />
                </div>
                <div className="flex gap-2 pt-1">
                  <a href="/.well-known/openapi.yaml" target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                      <ExternalLink className="w-3 h-3" /> openapi.yaml
                    </Button>
                  </a>
                  <a href="/.well-known/ai-plugin.json" target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                      <ExternalLink className="w-3 h-3" /> ai-plugin.json
                    </Button>
                  </a>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  ChatGPT akan otomatis membaca semua {endpoints.length} endpoint dari spec ini.
                </p>
              </StepCard>

              <StepCard step={4} title="Authentication — pilih None (default) atau Bearer token">
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-2.5 rounded-lg border border-green-500/20 bg-green-500/5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-foreground">Tanpa auth (rekomendasi untuk dev)</p>
                      <p className="text-[11px] text-muted-foreground">Auth Type: <Badge variant="outline" className="text-[10px] px-1 py-0">None</Badge> — biarkan kosong jika DLAVIE_API_KEY tidak di-set</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2.5 rounded-lg border border-border/40 bg-muted/10">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-foreground">Dengan API Key (opsional)</p>
                      <p className="text-[11px] text-muted-foreground">
                        Auth Type: <Badge variant="outline" className="text-[10px] px-1 py-0">API Key</Badge> · Header:{" "}
                        <code className="bg-muted/50 px-1 rounded text-[10px]">Authorization</code> · Format:{" "}
                        <code className="bg-muted/50 px-1 rounded text-[10px]">Bearer &lt;DLAVIE_API_KEY&gt;</code>
                      </p>
                    </div>
                  </div>
                </div>
              </StepCard>

              <StepCard step={5} title="Save & mulai pakai ChatGPT untuk kelola DLavie OS!">
                <p className="text-sm text-muted-foreground">
                  Klik <strong className="text-foreground">Save</strong>. ChatGPT sekarang bisa membaca dan menulis semua data DLavie OS.
                  Coba prompt-prompt di bawah untuk mulai.
                </p>
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 mt-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-amber-300/80">
                    <strong>Catatan:</strong> ChatGPT Actions hanya bekerja dengan URL yang bisa diakses dari internet.
                    Jika menggunakan Replit dev URL (*.pike.replit.dev), pastikan server sedang running.
                    Untuk produksi, deploy app agar dapat URL permanen.
                  </p>
                </div>
              </StepCard>
            </div>
          </Section>
        </motion.div>

        {/* ── Example prompts ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Section title={`Contoh Prompt di ChatGPT (${prompts.length} contoh)`}>
            <div className="space-y-1.5">
              {prompts.map((p) => (
                <div key={p} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/30 bg-muted/10 group">
                  <span className="text-primary text-sm mt-0.5 flex-shrink-0">›</span>
                  <span className="text-xs text-foreground flex-1 italic">"{p}"</span>
                  <CopyButton text={p} />
                </div>
              ))}
            </div>
          </Section>
        </motion.div>

        {/* ── Endpoints table ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <Section title={`${endpoints.length} API Endpoints`} defaultOpen={false}>
            <div className="rounded-xl border border-border/40 overflow-hidden">
              {endpoints.map(({ method, path: p, desc }, i) => (
                <div key={`${method}-${p}`} className={cn(
                  "flex items-start gap-3 px-4 py-2.5",
                  i < endpoints.length - 1 && "border-b border-border/25",
                  desc.includes("← BARU") && "bg-primary/3",
                )}>
                  <code className={cn("text-[11px] font-mono font-bold flex-shrink-0 w-14 mt-0.5", methodColor[method] ?? "text-muted-foreground")}>
                    {method}
                  </code>
                  <code className="text-[11px] font-mono text-foreground/80 flex-1 leading-relaxed">{p}</code>
                  <span className="text-[11px] text-muted-foreground text-right hidden sm:block flex-shrink-0 max-w-[200px]">
                    {desc.replace(" ← BARU", "")}
                    {desc.includes("← BARU") && (
                      <Badge className="ml-1 text-[9px] px-1 py-0 h-3.5 bg-primary/20 text-primary border-primary/30">new</Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>

        {/* ── Settings via ChatGPT ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Section title="Simpan API Keys via ChatGPT" defaultOpen={false}>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                ChatGPT bisa langsung menyimpan API keys ke DLavie OS — tidak perlu buka Settings manual.
                Cukup perintahkan ChatGPT:
              </p>
              <CodeBlock lang="prompt" code={`Simpan key ini ke DLavie OS:
GROQ_API_KEY = gsk_xxxxxxxxxxxxxxxxxxxx

# ChatGPT akan call POST /api/chatgpt/settings secara otomatis`} />
              <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-foreground">Keys yang bisa disimpan:</p>
                {[
                  ["GROQ_API_KEY",       "Groq (free, tercepat)        — console.groq.com"],
                  ["OPENROUTER_API_KEY", "OpenRouter (banyak model)    — openrouter.ai/keys"],
                  ["HF_TOKEN",           "HuggingFace (model download) — hf.co/settings/tokens"],
                  ["GITHUB_TOKEN",       "GitHub (auto-training data)  — github.com/settings/tokens"],
                  ["DLAVIE_API_KEY",     "DLavie API Key (auth)        — buat sendiri, string apapun"],
                  ["KAGGLE_USERNAME",    "Kaggle username              — kaggle.com/settings"],
                  ["KAGGLE_KEY",         "Kaggle API key               — kaggle.com/settings"],
                  ["TELEGRAM_BOT_TOKEN", "Telegram Bot token           — t.me/BotFather"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="text-[11px] font-mono text-primary flex-shrink-0 w-44">{key}</code>
                    <span className="text-[11px] text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </motion.div>

        {/* ── Quick curl test ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
          <Section title="Test Manual via curl" defaultOpen={false}>
            <CodeBlock lang="bash" code={
`# Status (public, no auth)
curl ${apiBase}/status

# Chat dengan AI
curl -X POST ${apiBase}/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Halo DLavie OS, apa yang bisa kamu lakukan?"}'

# Simpan API key
curl -X POST ${apiBase}/settings \\
  -H "Content-Type: application/json" \\
  -d '{"GROQ_API_KEY":"gsk_xxx"}'

# Buat dokumen
curl -X POST ${apiBase}/documents \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Catatan Setup","content":"Dokumentasi setup DLavie OS..."}'

# Cari di knowledge base
curl "${apiBase}/search?q=fine-tuning"

# List training samples
curl "${apiBase}/training?limit=10"

# Status provider
curl ${apiBase}/providers`
            } />
          </Section>
        </motion.div>

        {/* ── Footer links ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
          className="flex flex-wrap gap-3 pb-6"
        >
          <a href="/.well-known/openapi.yaml" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> openapi.yaml
            </Button>
          </a>
          <a href="/.well-known/ai-plugin.json" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> ai-plugin.json
            </Button>
          </a>
          <a href="/api-docs">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <BarChart2 className="w-3.5 h-3.5" /> API Docs
            </Button>
          </a>
          <a href="/mcp">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <Settings className="w-3.5 h-3.5" /> MCP Server
            </Button>
          </a>
        </motion.div>

      </div>
    </div>
  );
}
