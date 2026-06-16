import { useState, useEffect } from "react";
import { Copy, Check, ExternalLink, Bot, Zap, Database, BookOpen, RefreshCw, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusData {
  status: string;
  stats?: { conversations: number; documents: number; trainingSamples: number };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="relative group rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30">
        <span className="text-[10px] text-muted-foreground font-mono tracking-wide uppercase">{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-3 text-xs font-mono text-foreground/90 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">{code}</pre>
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

export default function ChatGPTIntegrationPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain.replit.app";
  const openapiUrl  = `${origin}/.well-known/openapi.yaml`;
  const pluginUrl   = `${origin}/.well-known/ai-plugin.json`;
  const apiBase     = `${origin}/api/chatgpt`;

  useEffect(() => {
    setLoading(true);
    fetch("/api/chatgpt/status")
      .then(r => r.json())
      .then((d: StatusData) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  const capabilities = [
    { icon: Bot,      label: "Read & Create Conversations",   desc: "List chats, get message history, create new conversations, add messages" },
    { icon: BookOpen, label: "Manage Documents / Knowledge Base", desc: "List, create, edit, delete documents; search by keyword" },
    { icon: Database, label: "Training Data CRUD",            desc: "Read all training samples, add new input/output pairs for fine-tuning" },
    { icon: Zap,      label: "Trigger Kaggle GPU Training",   desc: "Sync dataset to Kaggle and launch LoRA fine-tuning on GPU" },
  ];

  const examplePrompts = [
    "List all my conversations in DLavie OS",
    "Create a new document titled 'AI Notes' with content about transformer architectures",
    "Search my knowledge base for documents about 'fine-tuning'",
    "Add a training sample: input='What is RAG?', output='Retrieval-Augmented Generation...'",
    "Sync my training dataset to Kaggle and start GPU training",
    "Show me the last 10 training samples in my dataset",
    "Edit document #3 and append this new paragraph: ...",
    "Delete conversation #5 from DLavie OS",
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Plug className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
                ChatGPT Actions Integration
              </h1>
              <p className="text-sm text-muted-foreground">
                Hubungkan ChatGPT ke DLavie OS — AI bisa read, write, dan edit data Anda
              </p>
            </div>
          </div>
        </div>

        {/* Status banner */}
        <div className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl border",
          loading ? "border-border/40 bg-muted/20" :
          status?.status === "online" ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
        )}>
          <div className={cn("w-2 h-2 rounded-full flex-shrink-0",
            loading ? "bg-muted-foreground animate-pulse" :
            status?.status === "online" ? "bg-green-400" : "bg-red-400"
          )} />
          <span className="text-sm text-muted-foreground flex-1">
            {loading ? "Memeriksa status..." : status?.status === "online"
              ? `DLavie OS Online — ${status.stats?.conversations ?? 0} conversations · ${status.stats?.documents ?? 0} documents · ${status.stats?.trainingSamples ?? 0} training samples`
              : "DLavie OS tidak dapat dijangkau"}
          </span>
          <button onClick={() => {
            setLoading(true);
            fetch("/api/chatgpt/status").then(r=>r.json()).then((d: StatusData)=>setStatus(d)).catch(()=>setStatus(null)).finally(()=>setLoading(false));
          }} className="p-1 hover:bg-muted/60 rounded text-muted-foreground">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        </div>

        {/* Capabilities */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">Kemampuan ChatGPT via DLavie OS</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {capabilities.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex gap-3 p-3.5 rounded-lg border border-border/40 bg-muted/10">
                <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-foreground leading-snug">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Setup steps */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Cara Setup di ChatGPT</h2>

          <StepCard step={1} title="Buka ChatGPT → Explore GPTs → Create a GPT">
            <p className="text-sm text-muted-foreground">
              Login ke <a href="https://chat.openai.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">chat.openai.com</a>,
              klik <strong className="text-foreground">Explore GPTs</strong> di sidebar kiri, lalu klik <strong className="text-foreground">+ Create</strong>.
              Isi nama: <code className="bg-muted/50 px-1 rounded text-xs">DLavie OS</code> dan deskripsi singkat.
            </p>
          </StepCard>

          <StepCard step={2} title='Masuk tab "Configure" → scroll ke bagian "Actions"'>
            <p className="text-sm text-muted-foreground">
              Klik tab <strong className="text-foreground">Configure</strong>, scroll ke bawah, lalu klik{" "}
              <strong className="text-foreground">+ Create new action</strong>.
            </p>
          </StepCard>

          <StepCard step={3} title='Import OpenAPI Schema dari URL ini'>
            <p className="text-sm text-muted-foreground">Klik <strong className="text-foreground">Import from URL</strong> dan paste URL berikut:</p>
            <CodeBlock code={openapiUrl} lang="URL" />
            <p className="text-xs text-muted-foreground">
              Atau download manual:{" "}
              <a href="/.well-known/openapi.yaml" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                openapi.yaml <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </StepCard>

          <StepCard step={4} title="Set Authentication (opsional)">
            <p className="text-sm text-muted-foreground">
              Jika <code className="bg-muted/50 px-1 rounded text-xs">DLAVIE_API_KEY</code> di-set di server:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
              <li>Auth Type: <Badge variant="outline" className="text-xs">API Key</Badge></li>
              <li>Auth Header: <code className="bg-muted/50 px-1 rounded text-xs">Authorization</code></li>
              <li>Format: <code className="bg-muted/50 px-1 rounded text-xs">Bearer {"<DLAVIE_API_KEY>"}</code></li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">Jika tidak di-set, biarkan Auth Type: <Badge variant="outline" className="text-xs">None</Badge></p>
          </StepCard>

          <StepCard step={5} title="Simpan & Mulai Pakai!">
            <p className="text-sm text-muted-foreground">
              Klik <strong className="text-foreground">Save</strong>. Sekarang ChatGPT bisa mengakses DLavie OS langsung dari chat.
              Coba prompt di bawah untuk memulai.
            </p>
          </StepCard>
        </div>

        {/* Example prompts */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">Contoh Prompt di ChatGPT</h2>
          <div className="space-y-2">
            {examplePrompts.map((p) => (
              <div key={p} className="flex items-start gap-3 px-4 py-2.5 rounded-lg border border-border/30 bg-muted/10 group">
                <span className="text-primary text-sm mt-0.5 flex-shrink-0">›</span>
                <span className="text-sm text-foreground flex-1 italic">"{p}"</span>
                <CopyButton text={p} />
              </div>
            ))}
          </div>
        </div>

        {/* API reference */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">API Endpoints Lengkap</h2>
          <div className="rounded-xl border border-border/40 overflow-hidden">
            {[
              { method: "GET",    path: "/api/chatgpt/status",                 desc: "Cek status sistem (public)" },
              { method: "GET",    path: "/api/chatgpt/conversations",           desc: "List semua conversations" },
              { method: "GET",    path: "/api/chatgpt/conversations/:id",       desc: "Detail conversation + messages" },
              { method: "POST",   path: "/api/chatgpt/conversations",           desc: "Buat conversation baru" },
              { method: "POST",   path: "/api/chatgpt/conversations/:id/messages", desc: "Tambah pesan ke conversation" },
              { method: "DELETE", path: "/api/chatgpt/conversations/:id",       desc: "Hapus conversation" },
              { method: "GET",    path: "/api/chatgpt/documents",               desc: "List semua dokumen" },
              { method: "POST",   path: "/api/chatgpt/documents",               desc: "Buat dokumen baru" },
              { method: "PATCH",  path: "/api/chatgpt/documents/:id",           desc: "Edit dokumen" },
              { method: "DELETE", path: "/api/chatgpt/documents/:id",           desc: "Hapus dokumen" },
              { method: "GET",    path: "/api/chatgpt/search?q=...",            desc: "Cari di knowledge base" },
              { method: "GET",    path: "/api/chatgpt/training",                desc: "List training samples" },
              { method: "POST",   path: "/api/chatgpt/training",                desc: "Tambah training sample" },
              { method: "POST",   path: "/api/chatgpt/kaggle/sync",             desc: "Sync dataset ke Kaggle" },
              { method: "POST",   path: "/api/chatgpt/kaggle/train",            desc: "Jalankan GPU training" },
            ].map(({ method, path: p, desc }, i, arr) => {
              const rowKey = `${method}-${p}`;
              const colors: Record<string, string> = {
                GET: "text-blue-400", POST: "text-green-400",
                PATCH: "text-yellow-400", DELETE: "text-red-400",
              };
              return (
                <div key={rowKey} className={cn("flex items-start gap-3 px-4 py-2.5", i < arr.length - 1 && "border-b border-border/30")}>
                  <code className={cn("text-xs font-mono font-bold flex-shrink-0 w-14", colors[method] || "text-muted-foreground")}>{method}</code>
                  <code className="text-xs font-mono text-foreground/80 flex-1">{p}</code>
                  <span className="text-xs text-muted-foreground text-right hidden sm:block">{desc}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick test */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">Test Cepat (curl)</h2>
          <CodeBlock
            lang="bash"
            code={`# Cek status (tanpa auth)\ncurl ${apiBase}/status\n\n# List conversations\ncurl -H "Authorization: Bearer YOUR_KEY" ${apiBase}/conversations\n\n# Buat dokumen\ncurl -X POST ${apiBase}/documents \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Catatan AI","content":"Isi dokumen di sini..."}'`}
          />
        </div>

        {/* OpenAPI & Plugin manifest links */}
        <div className="flex flex-wrap gap-3 pb-4">
          <a href="/.well-known/openapi.yaml" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="w-3.5 h-3.5" /> openapi.yaml
            </Button>
          </a>
          <a href="/.well-known/ai-plugin.json" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="w-3.5 h-3.5" /> ai-plugin.json
            </Button>
          </a>
        </div>

      </div>
    </div>
  );
}
