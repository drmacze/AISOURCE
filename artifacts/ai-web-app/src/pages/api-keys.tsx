import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Activity,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  Brain,
  Server,
  ChevronRight,
  ExternalLink,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const masterKey = localStorage.getItem("nexus_master_key") || "";
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(masterKey ? { "X-API-Key": masterKey } : {}),
    ...(opts?.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

interface ApiKeyRow {
  id: number;
  name: string;
  key: string;
  permissions: "read" | "write" | "admin";
  active: boolean;
  defaultModel: string | null;
  requestCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  parameters: string;
  ready: boolean;
  description: string;
}

interface ModelCatalogue {
  local: ModelInfo[];
  cloud: ModelInfo[];
  totalLocal: number;
  totalCloud: number;
}

const PERM_COLORS: Record<string, string> = {
  read:  "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  write: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  admin: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
      className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function ApiKeysPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [masterKey, setMasterKey] = useState(
    () => localStorage.getItem("nexus_master_key") || ""
  );
  const [showMaster, setShowMaster] = useState(false);
  const [autoAuthStatus, setAutoAuthStatus] = useState<"loading" | "found" | "not-found">("loading");

  // Auto-load primary admin key from database on mount
  useEffect(() => {
    fetch(`${BASE}/api/auth/session`)
      .then((r) => r.json())
      .then((data: { found: boolean; key: string | null; name?: string }) => {
        if (data.found && data.key) {
          const stored = localStorage.getItem("nexus_master_key");
          if (stored !== data.key) {
            localStorage.setItem("nexus_master_key", data.key);
            setMasterKey(data.key);
            qc.invalidateQueries({ queryKey: ["api-keys"] });
          }
          setPrimaryKeyName(data.name ?? null);
          setAutoAuthStatus("found");
        } else {
          setAutoAuthStatus("not-found");
        }
      })
      .catch(() => setAutoAuthStatus("not-found"));
  }, [qc]);

  const [genOpen, setGenOpen] = useState(false);
  const [genName, setGenName] = useState("");
  const [genPerm, setGenPerm] = useState<"read" | "write" | "admin">("write");
  const [genModel, setGenModel] = useState("kimi/kimi-k2-instruct");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [generatedData, setGeneratedData] = useState<{ key: string; defaultModel: string | null } | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [primaryKeyName, setPrimaryKeyName] = useState<string | null>(null);

  const keysQuery = useQuery<{ keys: ApiKeyRow[]; total: number }>({
    queryKey: ["api-keys", masterKey],
    queryFn: () => apiFetch("/api/keys"),
    retry: false,
    refetchInterval: 30_000,
  });

  const modelsQuery = useQuery<ModelCatalogue>({
    queryKey: ["models-catalogue"],
    queryFn: () => apiFetch("/api/v1/models/catalogue"),
    staleTime: 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: genName.trim(), permissions: genPerm, defaultModel: genModel }),
      }),
    onSuccess: (data: { key: string; defaultModel: string | null }) => {
      setNewKey(data.key);
      setGeneratedData(data);
      setGenName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Key revoked", description: "API key permanently deleted." });
      setRevokeTarget(null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiFetch(`/api/keys/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch("/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ keyId: id }),
      }),
    onSuccess: () => {
      // Re-fetch session to update UI and localStorage
      fetch(`${BASE}/api/auth/session`)
        .then((r) => r.json())
        .then((data: { found: boolean; key: string | null; name?: string }) => {
          if (data.found && data.key) {
            localStorage.setItem("nexus_master_key", data.key);
            setMasterKey(data.key);
            setPrimaryKeyName(data.name ?? null);
            setAutoAuthStatus("found");
            qc.invalidateQueries({ queryKey: ["api-keys"] });
          }
        });
      toast({ title: "Primary key diubah", description: "Key ini sekarang tersimpan permanen sebagai admin utama." });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveMasterKey = () => {
    localStorage.setItem("nexus_master_key", masterKey);
    qc.invalidateQueries({ queryKey: ["api-keys"] });
    toast({ title: "Master key saved", description: "Dashboard will now use this key." });
  };

  const keys = keysQuery.data?.keys ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Key className="w-6 h-6 text-violet-400" /> API Keys
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Generate <code className="bg-white/5 px-1 rounded text-violet-300">nxs_...</code> keys for WhatsApp bots,
            websites, and any external integration. All keys are stored in the database.
          </p>
        </div>
        <Button
          onClick={() => { setNewKey(null); setGenOpen(true); }}
          className="bg-violet-600 hover:bg-violet-500 text-white shrink-0"
        >
          <Plus className="w-4 h-4 mr-1.5" /> New Key
        </Button>
      </div>

      {/* Dashboard Auth */}
      <div className="bg-slate-900/60 border border-white/8 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-white">Dashboard Auth</span>
          <span className="ml-auto">
            {autoAuthStatus === "loading" && (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" /> Checking database…
              </span>
            )}
            {autoAuthStatus === "found" && (
              <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Auto-authenticated dari database
              </span>
            )}
            {autoAuthStatus === "not-found" && (
              <span className="text-xs text-amber-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Belum ada primary key — buat admin key dulu
              </span>
            )}
          </span>
        </div>

        {autoAuthStatus === "found" ? (
          <div className="flex items-center gap-3 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2">
            <div className="flex-1">
              <p className="text-xs text-emerald-300 font-medium">
                Tersimpan permanen di database
                {primaryKeyName && <span className="text-slate-400 font-normal"> — <span className="text-white">{primaryKeyName}</span></span>}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Admin key aktif tersimpan di DB — tidak akan hilang walau browser di-clear atau server restart.
              </p>
            </div>
            <button
              onClick={() => setShowMaster((v) => !v)}
              className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-white/10"
              title={showMaster ? "Sembunyikan key" : "Lihat key"}
            >
              {showMaster ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type={showMaster ? "text" : "password"}
                value={masterKey}
                onChange={(e) => setMasterKey(e.target.value)}
                placeholder="Paste admin nxs_... key di sini"
                className="bg-slate-800 border-white/10 text-white font-mono text-sm pr-10"
              />
              <button
                onClick={() => setShowMaster((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showMaster ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button onClick={saveMasterKey} variant="outline" className="border-white/10 text-slate-300 hover:text-white">
              Simpan
            </Button>
          </div>
        )}

        {showMaster && masterKey && (
          <div className="flex items-center gap-2 bg-slate-950 border border-white/5 rounded px-3 py-2">
            <code className="flex-1 text-xs text-emerald-300 font-mono break-all">{masterKey}</code>
            <CopyButton text={masterKey} />
          </div>
        )}
      </div>

      {/* Keys Table */}
      <div className="bg-slate-900/60 border border-white/8 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <span className="text-sm font-medium text-white">
            {keysQuery.isLoading ? "Loading…" : `${keys.length} key${keys.length !== 1 ? "s" : ""}`}
          </span>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["api-keys"] })}
            className="p-1.5 rounded hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", keysQuery.isFetching && "animate-spin")} />
          </button>
        </div>

        {keysQuery.isError ? (
          <div className="p-8 text-center space-y-2">
            <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-slate-300 font-medium">Auth required</p>
            <p className="text-slate-500 text-sm">
              Enter your admin API key above (NEXUS_API_KEY or an admin nxs_ key) and click Save.
            </p>
          </div>
        ) : keys.length === 0 && !keysQuery.isLoading ? (
          <div className="p-8 text-center space-y-2">
            <Key className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">No API keys yet. Click "New Key" to generate one.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/2 transition-colors">

                {/* Status dot */}
                <div className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  k.active ? "bg-emerald-400" : "bg-slate-600"
                )} />

                {/* Name + masked key */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{k.name}</span>
                    <span className={cn("text-xs px-1.5 py-0.5 rounded font-mono", PERM_COLORS[k.permissions])}>
                      {k.permissions}
                    </span>
                    {!k.active && (
                      <Badge variant="secondary" className="text-xs text-slate-500">revoked</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <code className="text-xs text-slate-400 font-mono">{k.key}</code>
                    <CopyButton text={k.key} />
                  </div>
                </div>

                {/* Stats */}
                <div className="hidden md:flex flex-col items-end gap-0.5 text-right min-w-[120px]">
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <Activity className="w-3 h-3" />
                    {k.requestCount.toLocaleString()} requests
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    {k.lastUsedAt ? fmtDate(k.lastUsedAt) : "never used"}
                  </div>
                </div>

                {/* Created date */}
                <div className="hidden lg:block text-xs text-slate-500 min-w-[90px] text-right">
                  {fmtDate(k.createdAt)}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {k.permissions === "admin" && k.active && (
                    <button
                      onClick={() => setPrimaryMutation.mutate(k.id)}
                      className={cn(
                        "p-1.5 rounded transition-colors",
                        primaryKeyName === k.name
                          ? "text-amber-400"
                          : "text-slate-600 hover:text-amber-400 hover:bg-white/10"
                      )}
                      title={primaryKeyName === k.name ? "Key utama saat ini" : "Jadikan primary key (tersimpan permanen)"}
                    >
                      <Star className={cn("w-3.5 h-3.5", primaryKeyName === k.name && "fill-amber-400")} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleMutation.mutate({ id: k.id, active: !k.active })}
                    className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                    title={k.active ? "Disable key" : "Enable key"}
                  >
                    {k.active
                      ? <ToggleRight className="w-4 h-4 text-emerald-400" />
                      : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setRevokeTarget(k)}
                    className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Delete key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage example */}
      <div className="bg-slate-900/60 border border-white/8 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-medium text-white">How to use your key</h3>
        <div className="space-y-2">
          {[
            ["Ask (simple)", `curl -X POST https://YOUR_DOMAIN/api/v1/ask \\
  -H "X-API-Key: nxs_..." \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What is AI?","model":"tinyllama"}'`],
            ["Chat (with history)", `const res = await fetch('/api/v1/chat', {
  method: 'POST',
  headers: { 'X-API-Key': 'nxs_...' },
  body: JSON.stringify({ message: 'Hello', model: 'tinyllama' })
});`],
            ["WhatsApp Bot", `const { reply } = await fetch('/api/v1/ask', {
  method: 'POST',
  headers: { 'X-API-Key': 'nxs_...' },
  body: JSON.stringify({ question: incomingMsg, useRAG: true })
}).then(r => r.json());
await sendWhatsAppMessage(reply);`],
          ].map(([label, code]) => (
            <div key={label} className="space-y-1">
              <p className="text-xs text-slate-500">{label}</p>
              <div className="relative group">
                <pre className="bg-slate-950 border border-white/5 rounded-lg p-3 text-xs text-emerald-300 font-mono overflow-x-auto leading-relaxed">{code}</pre>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyButton text={code as string} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Generate Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={genOpen} onOpenChange={(o) => { setGenOpen(o); if (!o) { setNewKey(null); setGeneratedData(null); } }}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>{newKey ? "Key Generated — Ready to Use" : "Generate New API Key"}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {newKey
                ? "Your key is configured with the selected model. Copy-paste the code below into your bot."
                : "Create a key for external platforms. Select a default AI model so your key works instantly."}
            </DialogDescription>
          </DialogHeader>

          {newKey && generatedData ? (
            <div className="space-y-4">
              {/* Key display */}
              <div className="bg-slate-950 rounded-lg border border-emerald-500/20 p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm text-emerald-300 font-mono break-all">{newKey}</code>
                  <CopyButton text={newKey} />
                </div>
              </div>

              {/* Model badge */}
              <div className="flex items-center gap-2 text-xs">
                <Brain className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-slate-400">Default model:</span>
                <span className="text-violet-300 font-mono bg-violet-500/10 px-2 py-0.5 rounded">{generatedData.defaultModel || "tinyllama"}</span>
                <span className="text-slate-600">(set per key — no need to pass in every request)</span>
              </div>

              {/* WhatsApp Bot tutorial */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-emerald-400" />
                  <p className="text-sm font-semibold text-white">WhatsApp Bot — Copy & Paste</p>
                </div>
                <div className="relative group">
                  <pre className="bg-slate-950 border border-white/5 rounded-lg p-3 text-xs text-emerald-300 font-mono overflow-x-auto leading-relaxed">{`const API_KEY = "${newKey}";
const API_URL = "https://your-app-url.replit.app/api/v1/ask";

async function botReply(message) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify({ question: message, useRAG: true }),
  });
  const data = await res.json();
  return data.answer;  // ← kirim ke WhatsApp
}`}</pre>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={`const API_KEY = "${newKey}";
const API_URL = "https://your-app-url.replit.app/api/v1/ask";

async function botReply(message) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify({ question: message, useRAG: true }),
  });
  const data = await res.json();
  return data.answer;
}`} />
                  </div>
                </div>
              </div>

              {/* Node.js / Baileys tutorial */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-blue-400" />
                  <p className="text-sm font-semibold text-white">Node.js + Baileys (WhatsApp Library)</p>
                </div>
                <div className="relative group">
                  <pre className="bg-slate-950 border border-white/5 rounded-lg p-3 text-xs text-blue-300 font-mono overflow-x-auto leading-relaxed">{`const { default: makeWASocket } = require("@whiskeysockets/baileys");

// Saat menerima pesan WhatsApp
sock.ev.on("messages.upsert", async ({ messages }) => {
  const msg = messages[0];
  if (!msg.message || msg.key.fromMe) return;

  const text = msg.message.conversation || "";
  const { answer } = await fetch("${BASE}/api/v1/ask", {
    method: "POST",
    headers: { "X-API-Key": "${newKey}", "Content-Type": "application/json" },
    body: JSON.stringify({ question: text, useRAG: true }),
  }).then(r => r.json());

  await sock.sendMessage(msg.key.remoteJid, { text: answer });
});`}</pre>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={`const { default: makeWASocket } = require("@whiskeysockets/baileys");

sock.ev.on("messages.upsert", async ({ messages }) => {
  const msg = messages[0];
  if (!msg.message || msg.key.fromMe) return;

  const text = msg.message.conversation || "";
  const { answer } = await fetch("${BASE}/api/v1/ask", {
    method: "POST",
    headers: { "X-API-Key": "${newKey}", "Content-Type": "application/json" },
    body: JSON.stringify({ question: text, useRAG: true }),
  }).then(r => r.json());

  await sock.sendMessage(msg.key.remoteJid, { text: answer });
});`} />
                  </div>
                </div>
              </div>

              <p className="text-xs text-amber-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                This is the only time this full key will be shown.
              </p>
              <Button
                onClick={() => { setGenOpen(false); setNewKey(null); setGeneratedData(null); }}
                className="w-full bg-emerald-600 hover:bg-emerald-500"
              >
                Done — I saved my key
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Key Name</label>
                <Input
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                  placeholder="e.g. WhatsApp Bot, My Website, Dev Test"
                  className="bg-slate-800 border-white/10 text-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && genName.trim()) generateMutation.mutate();
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Permission Level</label>
                <Select value={genPerm} onValueChange={(v) => setGenPerm(v as "read" | "write" | "admin")}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10 text-white">
                    <SelectItem value="read">read — query & search only</SelectItem>
                    <SelectItem value="write">write — chat, generate, RAG (recommended)</SelectItem>
                    <SelectItem value="admin">admin — full access incl. key management</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5 text-violet-400" />
                  Default AI Model
                </label>
                <Select value={genModel} onValueChange={(v) => setGenModel(v)}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10 text-white max-h-60">
                    {/* Cloud models */}
                    <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Cloud (No install needed)</div>
                    {(modelsQuery.data?.cloud ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <div className="flex items-center gap-2">
                          <span>{m.name}</span>
                          <span className="text-[10px] text-slate-500 ml-auto">{m.parameters}</span>
                        </div>
                      </SelectItem>
                    ))}
                    {/* Local models */}
                    {(modelsQuery.data?.local ?? []).length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-t border-white/5 mt-1">Local (Ollama)</div>
                        {(modelsQuery.data?.local ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <div className="flex items-center gap-2">
                              <span>{m.name}</span>
                              <span className="text-[10px] text-slate-500 ml-auto">{m.parameters}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {modelsQuery.isLoading && (
                      <div className="px-3 py-2 text-xs text-slate-500">Loading models...</div>
                    )}
                    {(modelsQuery.data?.cloud ?? []).length === 0 && !modelsQuery.isLoading && (
                      <div className="px-3 py-2 text-xs text-slate-500">No cloud models available</div>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-500">
                  This model becomes the default for all requests using this key. You can override per-request.
                </p>
              </div>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={!genName.trim() || generateMutation.isPending}
                className="w-full bg-violet-600 hover:bg-violet-500"
              >
                {generateMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Key className="w-4 h-4 mr-2" />
                )}
                Generate Key
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Revoke Confirm Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke API Key?</DialogTitle>
            <DialogDescription className="text-slate-400">
              <strong className="text-white">{revokeTarget?.name}</strong> will stop working immediately.
              Any integration using this key will get 401 errors. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1 border-white/10 text-slate-300"
              onClick={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
            >
              {revokeMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Yes, Revoke"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
