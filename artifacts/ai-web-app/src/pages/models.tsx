import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Trash2, RefreshCw, Search, CheckCircle2, Cpu,
  Zap, Brain, Code2, Globe, Package, AlertCircle, X,
  HardDrive, Clock, ChevronDown, ChevronRight, Star,
  Wifi, WifiOff, Filter, ExternalLink, Server, Settings,
  Link, Copy, Check, FolderOpen, ChevronUp, Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const API_KEY = typeof window !== "undefined" ? (localStorage.getItem("dlavie_api_key") || "") : "";

// ─── API Base — reads from localStorage for runtime override (Vercel deploy) ──
export function getApiBase(): string {
  const stored =
    typeof window !== "undefined" ? (localStorage.getItem("dlavie_api_url") ?? "") : "";
  return (stored || (import.meta.env.VITE_API_URL as string) || "").replace(/\/$/, "");
}

function useApiBase() {
  const [apiBase, _set] = useState<string>(getApiBase);

  const setApiBase = useCallback((url: string) => {
    const clean = url.trim().replace(/\/$/, "");
    if (clean) localStorage.setItem("dlavie_api_url", clean);
    else localStorage.removeItem("dlavie_api_url");
    _set(clean);
  }, []);

  return { apiBase, setApiBase };
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface InstalledModel {
  name: string; label: string; description: string; tag: string;
  icon: string; sizeMB: number; parameterSize: string;
  quantization: string; family: string; modified: string; inCatalogue: boolean;
  ramGb: number | null; contextK: number | null; languages: string[];
}
interface CatalogueModel {
  name: string; label: string; desc: string; paramSize: string;
  sizeMB: number; tag: string; icon: string; installed: boolean;
  ramGb: number; contextK: number; languages: string[]; quantization: string; family: string;
}
interface CatalogueResponse {
  categories: Array<{ id: string; label: string; desc: string; models: CatalogueModel[] }>;
  models: CatalogueModel[];
}
interface DownloadState {
  model: string; lines: Array<{ type: string; text: string }>;
  done: boolean; success: boolean | null; progress: string;
}
interface HealthData {
  ollama: boolean; engine: string; version: string;
  ollamaHost: string; huggingface: boolean; uptime: number;
}
interface StorageData {
  path: string;
  disk: { usedBytes: number; freeBytes: number; totalBytes: number };
  systemRamGb: number;
}

// ─── Tag styles ────────────────────────────────────────────────────────────────
const TAG_STYLES: Record<string, string> = {
  fast:      "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  smart:     "bg-blue-500/10   text-blue-400   border-blue-500/20",
  reasoning: "bg-purple-500/10 text-purple-400  border-purple-500/20",
  coding:    "bg-green-500/10  text-green-400   border-green-500/20",
  multilang: "bg-orange-500/10 text-orange-400  border-orange-500/20",
  custom:    "bg-zinc-500/10   text-zinc-400    border-zinc-500/20",
};
const TAG_ICONS: Record<string, React.ElementType> = {
  fast: Zap, smart: Brain, reasoning: Search,
  coding: Code2, multilang: Globe, custom: Package,
};

function TagBadge({ tag }: { tag: string }) {
  const Icon = TAG_ICONS[tag] || Package;
  return (
    <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-mono", TAG_STYLES[tag] || TAG_STYLES.custom)}>
      <Icon className="w-3 h-3" />{tag}
    </span>
  );
}

function formatBytes(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function formatDiskBytes(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${bytes} B`;
}

// ─── RAM fit indicator ─────────────────────────────────────────────────────────
function RamFitBadge({ ramGb, systemRamGb }: { ramGb: number; systemRamGb: number }) {
  if (!systemRamGb) return null;
  const ratio = ramGb / systemRamGb;
  const color = ratio <= 0.5
    ? "bg-green-500/15 text-green-400 border-green-500/20"
    : ratio <= 0.8
    ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
    : "bg-red-500/15 text-red-400 border-red-500/20";
  const label = ratio <= 0.5 ? "Fits" : ratio <= 0.8 ? "Tight" : "Too large";
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-mono", color)}>
      RAM: {label}
    </span>
  );
}

// ─── Storage Settings Panel ────────────────────────────────────────────────────
function StorageSettingsPanel({ apiBase }: { apiBase: string }) {
  const [open, setOpen] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: storage, isLoading: loadingStorage } = useQuery<StorageData>({
    queryKey: ["models-storage", apiBase],
    queryFn: () => fetch(`${apiBase}/api/models/storage`).then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const usedPctRaw = storage?.disk
    ? (storage.disk.usedBytes / (storage.disk.totalBytes || 1)) * 100
    : 0;
  const usedPct = usedPctRaw;
  const usedPctDisplay = usedPctRaw < 1 && usedPctRaw > 0
    ? usedPctRaw.toFixed(2)
    : Math.round(usedPctRaw).toString();

  async function handleApply() {
    if (!draftPath.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/models/storage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        body: JSON.stringify({ path: draftPath.trim() }),
      });
      const json = await r.json() as { ok?: boolean; message?: string; hint?: string };
      if (r.ok && json.ok) {
        setSaveMsg({ ok: true, text: json.message || "Storage path updated and Ollama restarted." });
        queryClient.invalidateQueries({ queryKey: ["models-storage", apiBase] });
        setDraftPath("");
      } else {
        setSaveMsg({ ok: false, text: json.hint || json.message || "Failed to update path." });
      }
    } catch (err) {
      setSaveMsg({ ok: false, text: `Network error: ${String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/40 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Storage Settings</span>
          {storage && (
            <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 bg-muted/40 rounded-full border border-border">
              {formatDiskBytes(storage.disk.freeBytes)} free
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
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
            <div className="px-5 pb-5 pt-1 space-y-4 border-t border-border">
              {loadingStorage ? (
                <div className="flex items-center gap-2 py-3">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading storage info…</span>
                </div>
              ) : storage ? (
                <>
                  {/* Current path */}
                  <div className="space-y-1">
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Current Model Storage Path</p>
                    <p className="text-sm font-mono text-primary bg-muted/30 px-3 py-2 rounded-lg border border-border truncate">
                      {storage.path}
                    </p>
                  </div>

                  {/* Disk usage bar */}
                  {storage.disk.totalBytes > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                        <span>Disk usage ({usedPctDisplay}%)</span>
                        <span>{formatDiskBytes(storage.disk.usedBytes)} / {formatDiskBytes(storage.disk.totalBytes)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={cn(
                            "h-full rounded-full",
                            usedPct >= 90 ? "bg-red-500" : usedPct >= 70 ? "bg-amber-500" : "bg-green-500"
                          )}
                          initial={{ width: 0 }}
                          animate={{ width: `${usedPct}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                        />
                      </div>
                      {usedPct >= 85 && (
                        <p className="text-xs text-amber-400">
                          ⚠ Disk nearly full ({formatDiskBytes(storage.disk.freeBytes)} free). Configure a custom path below to avoid download failures.
                        </p>
                      )}
                    </div>
                  )}

                  {/* System RAM */}
                  {storage.systemRamGb > 0 && (
                    <p className="text-xs text-muted-foreground font-mono">
                      System RAM: <span className="text-foreground">{storage.systemRamGb} GB</span>
                    </p>
                  )}
                </>
              ) : null}

              {/* Custom path input */}
              <div className="space-y-2">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Set Custom Storage Path (OLLAMA_MODELS)</p>
                <p className="text-xs text-muted-foreground">
                  Model weights are stored here. Set this to a persistent volume or external drive to avoid losing models when Replit reclaims ephemeral storage.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={draftPath}
                    onChange={(e) => setDraftPath(e.target.value)}
                    placeholder="/home/user/.ollama_models  (absolute path)"
                    className="font-mono text-xs bg-background"
                    onKeyDown={(e) => e.key === "Enter" && handleApply()}
                  />
                  <Button
                    size="sm"
                    onClick={handleApply}
                    disabled={saving || !draftPath.trim()}
                    className="shrink-0 gap-1.5"
                  >
                    {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                    Apply
                  </Button>
                </div>
                {saveMsg && (
                  <p className={cn("text-xs font-mono", saveMsg.ok ? "text-green-400" : "text-red-400")}>
                    {saveMsg.ok ? "✓" : "✗"} {saveMsg.text}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground font-mono">
                  Applying this will restart Ollama. Downloads in progress will be interrupted.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Connected Server Panel ────────────────────────────────────────────────────
function ConnectedServerPanel({
  apiBase,
  setApiBase,
}: {
  apiBase: string;
  setApiBase: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(apiBase);
  const [copied, setCopied] = useState(false);

  const { data: health, isLoading } = useQuery<HealthData>({
    queryKey: ["ollama-health", apiBase],
    queryFn: async () => {
      const r = await fetch(`${apiBase}/api/v1/health`);
      if (!r.ok) throw new Error("offline");
      return r.json();
    },
    refetchInterval: 5000,
    retry: 1,
  });

  const ollamaOnline  = health?.ollama    ?? false;
  const hfConnected   = health?.huggingface ?? false;
  const displayUrl    = apiBase || window.location.origin;
  const pullEndpoint  = `${displayUrl}/api/models/pull`;

  function handleSave() {
    setApiBase(draft);
    setEditing(false);
  }

  function handleClear() {
    setApiBase("");
    setDraft("");
    setEditing(false);
  }

  function copyUrl() {
    navigator.clipboard.writeText(displayUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-3 transition-colors",
      ollamaOnline ? "border-green-500/25 bg-green-500/5" : "border-amber-500/25 bg-amber-500/5"
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className={cn("w-4 h-4", ollamaOnline ? "text-green-400" : "text-amber-400")} />
          <span className="text-sm font-semibold">Connected Server</span>
          {isLoading ? (
            <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
          ) : ollamaOnline ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 font-mono">● ONLINE</span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-mono">○ CONNECTING</span>
          )}
        </div>
        <button
          onClick={() => { setEditing(!editing); setDraft(apiBase); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Configure
        </button>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-3 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Server URL:</span>
          <code className="text-primary">{displayUrl}</code>
          <button onClick={copyUrl} className="text-muted-foreground hover:text-foreground ml-0.5">
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Ollama:</span>
          <span className={ollamaOnline ? "text-green-400" : "text-amber-400"}>
            {health?.ollamaHost || "127.0.0.1:11434"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Engine:</span>
          <span className="text-primary">{health?.engine || "—"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hfConnected
            ? <><Wifi className="w-3 h-3 text-green-400" /><span className="text-green-400">HuggingFace connected</span></>
            : <><WifiOff className="w-3 h-3 text-muted-foreground" /><span className="text-muted-foreground">HuggingFace not configured</span></>}
        </div>
      </div>

      {/* Inline status message */}
      {!ollamaOnline && !isLoading && (
        <p className="text-xs text-amber-400">
          Ollama engine is starting up — model downloads available in ~10s. Downloads require Ollama running on the server.
        </p>
      )}
      {ollamaOnline && (
        <p className="text-xs text-muted-foreground">
          Models downloaded here are stored on this server and immediately available in Chat, Training Hub, and the v1 API.
        </p>
      )}

      {/* Config panel */}
      {editing && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Custom API Server URL
            </label>
            <p className="text-xs text-muted-foreground">
              Use this when your frontend (Vercel) and API server are on different URLs.
              Leave blank to use same-origin (default for Replit/local dev).
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://your-api-server.com  (blank = same origin)"
              className="font-mono text-xs bg-background"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <Button size="sm" onClick={handleSave} className="shrink-0">Save</Button>
            {apiBase && (
              <Button size="sm" variant="outline" onClick={handleClear} className="shrink-0 text-muted-foreground">
                Reset
              </Button>
            )}
          </div>
          <div className="bg-zinc-950 rounded-lg p-3 space-y-2 text-xs font-mono">
            <p className="text-muted-foreground">Deploy guide — set this env var on Vercel:</p>
            <pre className="text-blue-300 overflow-x-auto">{`VITE_API_URL=https://your-api-server.com`}</pre>
            <p className="text-muted-foreground mt-1">Or set it at runtime above (saved in browser).</p>
            <p className="text-green-400 mt-1">Model pull endpoint: {pullEndpoint}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Ollama-online hook ─────────────────────────────────────────────────
function useOllamaOnline(apiBase: string) {
  const { data: health } = useQuery<HealthData>({
    queryKey: ["ollama-health", apiBase],
    queryFn: async () => {
      const r = await fetch(`${apiBase}/api/v1/health`);
      if (!r.ok) throw new Error("offline");
      return r.json();
    },
    refetchInterval: 5000,
    staleTime: 4000,
    retry: 1,
  });
  return health?.ollama ?? false;
}

function useStorageData(apiBase: string) {
  const { data } = useQuery<StorageData>({
    queryKey: ["models-storage", apiBase],
    queryFn: () => fetch(`${apiBase}/api/models/storage`).then((r) => r.json()),
    refetchInterval: 30_000,
  });
  return data ?? null;
}

// ─── Download manager ──────────────────────────────────────────────────────────
function useDownloads(apiBase: string) {
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  const startDownload = useCallback((model: string, onComplete?: () => void) => {
    setDownloads((prev) => ({
      ...prev,
      [model]: { model, lines: [{ type: "info", text: `Initiating pull: ${model}…` }], done: false, success: null, progress: "Connecting to Ollama…" },
    }));

    fetch(`${apiBase}/api/models/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify({ model }),
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        setDownloads((prev) => ({
          ...prev,
          [model]: { ...prev[model], done: true, success: false,
            lines: [...(prev[model]?.lines || []), { type: "error", text: `Server error: ${errText}` }] },
        }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        for (const line of text.split("\n").filter((l) => l.startsWith("data:"))) {
          try {
            const evt = JSON.parse(line.slice(5).trim()) as {
              type: string; text?: string; success?: boolean; model?: string; hint?: string;
            };
            if (evt.type === "done") {
              setDownloads((prev) => ({ ...prev, [model]: { ...prev[model], done: true, success: evt.success ?? false } }));
              if (evt.success) onComplete?.();
            } else {
              setDownloads((prev) => {
                const cur = prev[model] || { model, lines: [], done: false, success: null, progress: "" };
                const lineText = evt.hint ? `${evt.text || ""} — ${evt.hint}` : (evt.text || "");
                return {
                  ...prev,
                  [model]: {
                    ...cur,
                    progress: evt.text || cur.progress,
                    lines: [...cur.lines, { type: evt.type, text: lineText }].slice(-20),
                  },
                };
              });
            }
          } catch { /* skip malformed */ }
        }
      }
    }).catch((err) => {
      setDownloads((prev) => ({
        ...prev,
        [model]: { ...prev[model], done: true, success: false,
          lines: [...(prev[model]?.lines || []), { type: "error", text: String(err) }] },
      }));
    });
  }, [apiBase]);

  const dismissDownload = useCallback((model: string) => {
    setDownloads((prev) => { const n = { ...prev }; delete n[model]; return n; });
  }, []);

  return { downloads, startDownload, dismissDownload };
}

// ─── Main page component ───────────────────────────────────────────────────────
export default function Models() {
  const queryClient = useQueryClient();
  const { apiBase, setApiBase } = useApiBase();
  const [activeTab, setActiveTab] = useState<"installed" | "catalogue" | "hf">("installed");
  const [filterTag, setFilterTag] = useState("all");
  const [hfSearch, setHfSearch] = useState("");
  const [hfQuery, setHfQuery] = useState("");
  const { downloads, startDownload, dismissDownload } = useDownloads(apiBase);
  const storageData = useStorageData(apiBase);

  const { data: installed, isLoading: loadingInstalled, refetch: refetchInstalled } = useQuery<{ models: InstalledModel[]; count: number }>({
    queryKey: ["models-list", apiBase],
    queryFn: () => fetch(`${apiBase}/api/models/list`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: catalogueData, isLoading: loadingCatalogue } = useQuery<CatalogueResponse>({
    queryKey: ["models-catalogue", apiBase],
    queryFn: () => fetch(`${apiBase}/api/models/catalogue`).then((r) => r.json()),
    refetchInterval: 5000,
  });
  const catalogue = catalogueData?.models ?? [];

  const { data: hfData, isLoading: loadingHF } = useQuery<{ models: Array<{ id: string; author: string; downloads: number; likes: number; task: string; tags: string[] }> }>({
    queryKey: ["hf-models", hfQuery, apiBase],
    queryFn: () => fetch(`${apiBase}/api/models/hf-search?q=${encodeURIComponent(hfQuery)}&limit=20`).then((r) => r.json()),
    enabled: activeTab === "hf",
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      fetch(`${apiBase}/api/models/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        body: JSON.stringify({ model: name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models-list", apiBase] });
      queryClient.invalidateQueries({ queryKey: ["models-catalogue", apiBase] });
    },
  });

  const handleDownload = (model: string) => {
    startDownload(model, () => {
      queryClient.invalidateQueries({ queryKey: ["models-list", apiBase] });
      queryClient.invalidateQueries({ queryKey: ["models-catalogue", apiBase] });
    });
  };

  const activeDownloadsArr = Object.values(downloads);
  const filteredCatalogue = (catalogue || []).filter((m) => filterTag === "all" || m.tag === filterTag);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Model Manager</h1>
          <p className="text-sm text-muted-foreground font-mono">
            Download · Manage · Use in API — runs locally on the connected server
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchInstalled()} className="gap-2 font-mono">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Installed Models",  value: installed?.count ?? "—",                                                                          icon: Cpu,      color: "text-green-400" },
          { label: "Total Size",        value: installed ? formatBytes((installed.models || []).reduce((s, m) => s + m.sizeMB, 0)) : "—",        icon: HardDrive,color: "text-blue-400" },
          { label: "Downloading Now",   value: activeDownloadsArr.filter((d) => !d.done).length,                                                  icon: Download, color: "text-amber-400" },
          { label: "Model Catalogue",   value: catalogue?.length ?? "—",                                                                          icon: Filter,   color: "text-primary" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card">
            <Icon className={cn("w-5 h-5 flex-shrink-0", color)} />
            <div>
              <p className="text-lg font-bold font-mono">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Active downloads */}
      {activeDownloadsArr.length > 0 && (
        <div className="space-y-2">
          {activeDownloadsArr.map((dl) => (
            <div key={dl.model} className={cn(
              "rounded-xl border p-4 space-y-2",
              dl.done && dl.success ? "border-green-500/30 bg-green-500/5" :
              dl.done && !dl.success ? "border-red-500/30 bg-red-500/5" :
              "border-primary/30 bg-primary/5"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {dl.done
                    ? dl.success
                      ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                      : <AlertCircle className="w-4 h-4 text-red-400" />
                    : <Download className="w-4 h-4 text-primary animate-pulse" />}
                  <span className="text-sm font-mono font-medium">{dl.model}</span>
                  {!dl.done && <span className="text-xs text-muted-foreground animate-pulse">downloading…</span>}
                  {dl.done && dl.success && <span className="text-xs text-green-400">✓ ready — available in Chat & API</span>}
                  {dl.done && !dl.success && <span className="text-xs text-red-400">download failed</span>}
                </div>
                {dl.done && (
                  <button onClick={() => dismissDownload(dl.model)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {!dl.done && dl.progress && (
                <p className="text-xs font-mono text-muted-foreground pl-6 truncate">{dl.progress}</p>
              )}
              <div className="bg-zinc-950 rounded-lg p-2 max-h-24 overflow-y-auto">
                {dl.lines.slice(-6).map((line, i) => (
                  <div key={i} className={cn("text-xs font-mono", {
                    "text-green-400":      line.type === "success" || line.type === "stdout",
                    "text-amber-400":      line.type === "progress",
                    "text-red-400":        line.type === "error"   || line.type === "stderr",
                    "text-muted-foreground": line.type === "info",
                  })}>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Storage Settings panel */}
      <StorageSettingsPanel apiBase={apiBase} />

      {/* Connected server panel */}
      <ConnectedServerPanel apiBase={apiBase} setApiBase={setApiBase} />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted/30 rounded-xl w-fit border border-border">
        {(["installed", "catalogue", "hf"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-mono rounded-lg transition-colors",
              activeTab === tab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "installed" && `Installed (${installed?.count ?? 0})`}
            {tab === "catalogue" && "Model Catalogue"}
            {tab === "hf" && "HuggingFace Hub"}
          </button>
        ))}
      </div>

      {/* ── Installed tab ─────────────────────────────────────────────────────── */}
      {activeTab === "installed" && (
        <div className="space-y-3">
          {loadingInstalled ? (
            <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-primary" /></div>
          ) : !installed?.models?.length ? (
            <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
              <Cpu className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No models installed</p>
              <p className="text-xs mt-1">Switch to "Model Catalogue" to download one</p>
            </div>
          ) : (
            installed.models.map((model) => (
              <InstalledModelCard
                key={model.name}
                model={model}
                apiBase={apiBase}
                systemRamGb={storageData?.systemRamGb ?? 0}
                onDelete={() => deleteMutation.mutate(model.name)}
                deleting={deleteMutation.isPending}
              />
            ))
          )}
        </div>
      )}

      {/* ── Catalogue tab ─────────────────────────────────────────────────────── */}
      {activeTab === "catalogue" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {["all", "fast", "smart", "reasoning", "coding", "multilang"].map((tag) => (
              <button
                key={tag}
                onClick={() => setFilterTag(tag)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full border font-mono transition-colors",
                  filterTag === tag
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {tag === "all" ? "All Models" : tag}
              </button>
            ))}
          </div>

          {loadingCatalogue ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredCatalogue.map((model) => (
                <CatalogueModelCard
                  key={model.name}
                  model={model}
                  apiBase={apiBase}
                  systemRamGb={storageData?.systemRamGb ?? 0}
                  downloading={!!downloads[model.name] && !downloads[model.name].done}
                  onDownload={() => handleDownload(model.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HuggingFace tab ───────────────────────────────────────────────────── */}
      {activeTab === "hf" && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs text-blue-300 font-mono">
            HuggingFace Hub — browse {"{"}25,000+{"}"} public models. To use a model with Ollama, find its GGUF version on{" "}
            <a href="https://ollama.com/search" target="_blank" rel="noreferrer" className="underline">ollama.com/search</a>.
          </div>
          <div className="flex gap-2">
            <Input
              value={hfSearch}
              onChange={(e) => setHfSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setHfQuery(hfSearch)}
              placeholder="Search HuggingFace models (e.g. llama, mistral, qwen)…"
              className="font-mono bg-background"
            />
            <Button onClick={() => setHfQuery(hfSearch)} className="gap-2 shrink-0">
              <Search className="w-4 h-4" />Search
            </Button>
          </div>

          {loadingHF ? (
            <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(hfData?.models || []).map((m) => (
                <div key={m.id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-medium text-primary truncate">{m.id}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Download className="w-3 h-3" />{(m.downloads / 1000).toFixed(0)}k</span>
                        <span className="flex items-center gap-1"><Star className="w-3 h-3" />{m.likes}</span>
                        <span className="font-mono">{m.task}</span>
                      </div>
                    </div>
                    <a
                      href={`https://huggingface.co/${m.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-shrink-0 p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/50 text-muted-foreground font-mono">{tag}</span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Find Ollama-compatible GGUF version:{" "}
                    <a href={`https://ollama.com/search?q=${encodeURIComponent(m.id.split("/")[1] || m.id)}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      Search on Ollama hub →
                    </a>
                  </p>
                </div>
              ))}
              {!hfData?.models?.length && (
                <div className="col-span-2 text-center py-12 text-muted-foreground text-sm">
                  Enter a search query above to browse HuggingFace models.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function InstalledModelCard({ model, apiBase, systemRamGb, onDelete, deleting }: {
  model: InstalledModel; apiBase: string; systemRamGb: number;
  onDelete: () => void; deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const serverUrl = apiBase || window.location.origin;

  return (
    <div className="rounded-xl border border-border bg-card hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 px-5 py-4">
        <span className="text-2xl">{model.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-sm font-medium">{model.name}</span>
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-mono">
              <CheckCircle2 className="w-3 h-3" />READY
            </span>
            <TagBadge tag={model.tag} />
            {model.ramGb != null && (
              <RamFitBadge ramGb={model.ramGb} systemRamGb={systemRamGb} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{model.parameterSize}</span>
            <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{formatBytes(model.sizeMB)}</span>
            {model.ramGb != null && <span>RAM: {model.ramGb}GB min</span>}
            {model.contextK != null && <span>ctx: {model.contextK}K</span>}
            <span>{model.quantization}</span>
            <span className="text-primary">API: /api/v1/chat</span>
          </div>
          {model.languages?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {model.languages.slice(0, 6).map((lang) => (
                <span key={lang} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono border border-border/50">
                  {lang.toUpperCase()}
                </span>
              ))}
              {model.languages.length > 6 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono border border-border/50">
                  +{model.languages.length - 6}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete} disabled={deleting}
          >
            {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">API Usage</h4>
          <div className="bg-zinc-950 rounded-lg p-3">
            <pre className="text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap">{`fetch('${serverUrl}/api/v1/chat', {
  method: 'POST',
  headers: {
    'X-API-Key': '${API_KEY}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: 'Hello!',
    model: '${model.name}'
  })
})`}</pre>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Family: {model.family} · Quantization: {model.quantization}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogueModelCard({ model, apiBase, systemRamGb, downloading, onDownload }: {
  model: CatalogueModel; apiBase: string; systemRamGb: number;
  downloading: boolean; onDownload: () => void;
}) {
  const ollamaOnline = useOllamaOnline(apiBase);

  return (
    <div className={cn(
      "rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors",
      model.installed ? "border-green-500/20" : "border-border"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="text-xl flex-shrink-0">{model.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm">{model.label}</span>
              <TagBadge tag={model.tag} />
              {model.installed && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />Installed
                </span>
              )}
              {systemRamGb > 0 && (
                <RamFitBadge ramGb={model.ramGb} systemRamGb={systemRamGb} />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{model.desc}</p>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs font-mono text-muted-foreground">
              <span>{model.paramSize}</span>
              <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{formatBytes(model.sizeMB)}</span>
              <span>RAM: {model.ramGb}GB</span>
              <span>ctx: {model.contextK}K</span>
              <code className="text-primary/70">{model.name}</code>
            </div>
            {model.languages?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {model.languages.slice(0, 5).map((lang) => (
                  <span key={lang} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono border border-border/50">
                    {lang.toUpperCase()}
                  </span>
                ))}
                {model.languages.length > 5 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono border border-border/50">
                    +{model.languages.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          {model.installed ? (
            <span className="text-xs font-mono text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />Ready
            </span>
          ) : !ollamaOnline ? (
            <span className="text-[10px] font-mono text-amber-400 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
              <WifiOff className="w-3 h-3" />Ollama offline
            </span>
          ) : (
            <Button
              size="sm" variant="outline"
              className="gap-1 font-mono text-xs h-8"
              onClick={onDownload} disabled={downloading}
            >
              {downloading
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Pulling…</>
                : <><Download className="w-3.5 h-3.5" />Download</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
