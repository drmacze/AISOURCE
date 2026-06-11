import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, Key, Plus, Trash2, Eye, EyeOff, RefreshCw,
  Server, CheckCircle2, Copy, Check, Lock, Zap, Github,
  BrainCircuit, AlertCircle, Wifi, WifiOff, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

interface SecretRow {
  name: string;
  masked: string;
  set: boolean;
  active: boolean;
}

interface SystemData {
  env: { nodeEnv: string; port: string; ollamaModels: string; ollamaHost: string };
  fileConfig: { exists: boolean; path: string; updatedAt: string | null };
}

const REQUIRED_KEYS: {
  name: string;
  label: string;
  description: string;
  url: string;
  icon: React.ReactNode;
  required: boolean;
}[] = [
  {
    name: "GROQ_API_KEY",
    label: "Groq",
    description: "Provider AI tercepat (LPU inference)",
    url: "https://console.groq.com/keys",
    icon: <Zap className="w-4 h-4 text-yellow-400" />,
    required: true,
  },
  {
    name: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    description: "Akses 200+ model AI (free tier tersedia)",
    url: "https://openrouter.ai/keys",
    icon: <Zap className="w-4 h-4 text-purple-400" />,
    required: true,
  },
  {
    name: "HF_TOKEN",
    label: "HuggingFace",
    description: "Dataset, model hosting & serverless inference",
    url: "https://huggingface.co/settings/tokens",
    icon: <BrainCircuit className="w-4 h-4 text-orange-400" />,
    required: true,
  },
  {
    name: "GITHUB_TOKEN",
    label: "GitHub",
    description: "Auto-training dari GitHub datasets (5000 req/hr)",
    url: "https://github.com/settings/tokens",
    icon: <Github className="w-4 h-4 text-slate-300" />,
    required: true,
  },
];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
      title="Copy name"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

type TestStatus = { ok: boolean; detail: string } | null;

function QuickKeyRow({
  item,
  isSet,
  onSave,
  isSaving,
}: {
  item: typeof REQUIRED_KEYS[0];
  isSet: boolean;
  onSave: (name: string, value: string) => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    const v = value.trim();
    if (!v) return;
    setIsTesting(true);
    setTestStatus(null);
    try {
      const res = await fetch(`${BASE}/api/settings/secrets/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, value: v }),
      });
      const data = await res.json() as { ok: boolean; detail: string };
      setTestStatus({ ok: data.ok, detail: data.detail });
    } catch {
      setTestStatus({ ok: false, detail: "Tidak bisa terhubung ke server" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2.5 transition-colors",
      isSet
        ? "border-emerald-500/20 bg-emerald-950/20"
        : "border-white/8 bg-slate-900/40",
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {item.icon}
          <span className="text-sm font-semibold text-white">{item.label}</span>
          {item.required && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
              WAJIB
            </span>
          )}
        </div>
        {isSet ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Aktif
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <AlertCircle className="w-3.5 h-3.5" /> Belum diset
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">{item.description}</p>

      <div className="flex items-center gap-1 mb-1">
        <code className="text-xs font-mono text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded">
          {item.name}
        </code>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
        >
          Dapatkan key →
        </a>
      </div>

      {!isSet && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => { setValue(e.target.value); setTestStatus(null); }}
                placeholder={`Paste ${item.name} di sini…`}
                className="bg-slate-950 border-white/10 text-white font-mono text-xs pr-9 h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim()) onSave(item.name, value.trim());
                }}
              />
              <button
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Test button */}
            <Button
              onClick={handleTest}
              disabled={!value.trim() || isTesting}
              size="sm"
              variant="outline"
              className="border-white/10 text-slate-300 hover:text-white h-8 px-3 text-xs shrink-0"
              title="Test koneksi ke provider"
            >
              {isTesting
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Wifi className="w-3 h-3" />
              }
            </Button>

            {/* Save button */}
            <Button
              onClick={() => { if (value.trim()) onSave(item.name, value.trim()); }}
              disabled={!value.trim() || isSaving}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 px-3 text-xs shrink-0"
            >
              {isSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Simpan"}
            </Button>
          </div>

          {/* Test result */}
          <AnimatePresence>
            {testStatus && (
              <motion.div
                initial={{ opacity: 0, y: -4, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -4, height: 0 }}
                className={cn(
                  "flex items-start gap-2 px-2.5 py-2 rounded-md text-xs",
                  testStatus.ok
                    ? "bg-emerald-950/40 border border-emerald-500/20 text-emerald-300"
                    : "bg-red-950/30 border border-red-500/20 text-red-300"
                )}
              >
                {testStatus.ok
                  ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                  : <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" />
                }
                <span>{testStatus.detail}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [newName, setNewName]   = useState("");
  const [newValue, setNewValue] = useState("");
  const [showNew, setShowNew]   = useState(false);
  const [revealMap, setRevealMap] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const secretsQuery = useQuery<{ secrets: SecretRow[]; total: number }>({
    queryKey: ["settings-secrets"],
    queryFn: () => apiFetch("/api/settings/secrets"),
    refetchInterval: 15_000,
  });

  const systemQuery = useQuery<SystemData>({
    queryKey: ["settings-system"],
    queryFn: () => apiFetch("/api/settings"),
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      apiFetch("/api/settings/secrets", { method: "POST", body: JSON.stringify({ name, value }) }),
    onSuccess: (data) => {
      toast({ title: "Secret disimpan", description: `${data.name} aktif sekarang.` });
      setNewName(""); setNewValue(""); setShowNew(false);
      setSavingKey(null);
      qc.invalidateQueries({ queryKey: ["settings-secrets"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setSavingKey(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/api/settings/secrets/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: (_, name) => {
      toast({ title: "Secret dihapus", description: name });
      setDeleteConfirm(null);
      qc.invalidateQueries({ queryKey: ["settings-secrets"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reloadMutation = useMutation({
    mutationFn: () => apiFetch("/api/settings/reload", { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "Reloaded", description: data.message });
      qc.invalidateQueries({ queryKey: ["settings-secrets"] });
    },
  });

  const secrets = secretsQuery.data?.secrets ?? [];
  const sysData = systemQuery.data;
  const setSecretNames = new Set(secrets.map((s) => s.name));

  const handleAdd = () => {
    const name = newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const value = newValue.trim();
    if (!name || !value) return;
    addMutation.mutate({ name, value });
  };

  const handleQuickSave = (name: string, value: string) => {
    setSavingKey(name);
    addMutation.mutate({ name, value });
  };

  const toggleReveal = (name: string) =>
    setRevealMap((m) => ({ ...m, [name]: !m[name] }));

  const missingCount = REQUIRED_KEYS.filter((k) => !setSecretNames.has(k.name)).length;

  return (
    <div className="min-h-full bg-slate-950 p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
            className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2"
          >
            <Lock className="w-5 h-5 text-emerald-400" /> Environment Secrets
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}
            className="text-sm text-slate-500 mt-0.5"
          >
            Simpan API key sebagai environment variable — tersimpan permanen di server
          </motion.p>
        </div>
        <Button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          variant="outline"
          size="sm"
          className="border-white/10 text-slate-400 hover:text-white shrink-0"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", reloadMutation.isPending && "animate-spin")} />
          Reload
        </Button>
      </div>

      {/* Required API Keys — Quick Setup */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
        className="rounded-xl border border-white/8 bg-slate-900/70 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-white">API Keys Wajib</span>
            <span className="text-xs text-slate-500">— diperlukan untuk semua fitur AI</span>
          </div>
          {missingCount > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">
              {missingCount} belum diset
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Semua lengkap
            </span>
          )}
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {REQUIRED_KEYS.map((item) => (
            <QuickKeyRow
              key={item.name}
              item={item}
              isSet={setSecretNames.has(item.name)}
              onSave={handleQuickSave}
              isSaving={savingKey === item.name && addMutation.isPending}
            />
          ))}
        </div>
      </motion.div>

      {/* Add new secret panel */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="rounded-xl border border-white/8 bg-slate-900/70 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
          <Plus className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Tambah Secret Lainnya</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Nama</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                placeholder="NAMA_ENV_VAR"
                className="bg-slate-950 border-white/10 text-white font-mono text-sm uppercase"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <p className="text-[11px] text-slate-600">Huruf kapital, angka, underscore</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Value</label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="Paste API key di sini…"
                  className="bg-slate-950 border-white/10 text-white font-mono text-sm pr-10"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                <button
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <Button
            onClick={handleAdd}
            disabled={!newName.trim() || !newValue.trim() || addMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 text-white w-full sm:w-auto"
            size="sm"
          >
            {addMutation.isPending && !savingKey
              ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <Plus className="w-3.5 h-3.5 mr-1.5" />
            }
            Simpan Secret
          </Button>
        </div>
      </motion.div>

      {/* Secrets list */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
        className="rounded-xl border border-white/8 bg-slate-900/70 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-white">
              {secretsQuery.isLoading ? "Memuat…" : `${secrets.length} Secret${secrets.length !== 1 ? "s" : ""} Tersimpan`}
            </span>
          </div>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["settings-secrets"] })}
            className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-white transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", secretsQuery.isFetching && "animate-spin")} />
          </button>
        </div>

        {secretsQuery.isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Memuat secrets…</div>
        ) : secrets.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Lock className="w-8 h-8 text-slate-700 mx-auto" />
            <p className="text-slate-400 text-sm">Belum ada secrets tersimpan.</p>
            <p className="text-slate-600 text-xs">Isi API Keys Wajib di atas untuk memulai.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            <AnimatePresence>
              {secrets.map((s, i) => (
                <motion.div
                  key={s.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] group"
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    s.active ? "bg-emerald-400" : "bg-amber-400"
                  )} title={s.active ? "Active in process.env" : "Saved but not yet active"} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <code className="text-sm font-mono font-semibold text-emerald-300">{s.name}</code>
                      <CopyBtn text={s.name} />
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-0.5">
                      {revealMap[s.name] ? (
                        <span className="text-slate-300">{s.masked}</span>
                      ) : (
                        <span>••••••••••••••••</span>
                      )}
                    </div>
                  </div>

                  {s.active ? (
                    <span className="text-xs text-emerald-400 flex items-center gap-1 flex-shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Active
                    </span>
                  ) : (
                    <span className="text-xs text-amber-400 flex-shrink-0">Saved</span>
                  )}

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleReveal(s.name)}
                      className="p-1.5 rounded hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                      title={revealMap[s.name] ? "Sembunyikan" : "Lihat value"}
                    >
                      {revealMap[s.name] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>

                    {deleteConfirm === s.name ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMutation.mutate(s.name)}
                          disabled={deleteMutation.isPending}
                          className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          Hapus
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs px-2 py-1 rounded bg-white/5 text-slate-400 hover:bg-white/10 transition-colors"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(s.name)}
                        className="p-1.5 rounded hover:bg-red-500/15 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="Hapus secret"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* Git Push Warning */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
        className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4"
      >
        <div className="flex items-start gap-3">
          <Github className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-300">Aman dari GitHub Secret Scanning</p>
            <p className="text-xs text-slate-400">
              API key yang disimpan di sini disimpan dalam file <code className="text-amber-300 bg-amber-950/40 px-1 rounded">.dlavie-config.json</code> yang
              sudah ditambahkan ke <code className="text-slate-300 bg-white/5 px-1 rounded">.gitignore</code>.
              File ini <strong className="text-white">tidak akan ikut ter-push</strong> ke GitHub — API key kamu aman dari auto-revoke.
            </p>
          </div>
        </div>
      </motion.div>

      {/* System Config */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}
        className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-white">System Configuration</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 font-mono text-xs">
          {[
            { k: "Node Environment", v: sysData?.env?.nodeEnv || "—" },
            { k: "API Port",         v: sysData?.env?.port || "—" },
            { k: "Ollama Host",      v: sysData?.env?.ollamaHost || "—" },
            { k: "Ollama Models",    v: sysData?.env?.ollamaModels || "—" },
            { k: "Config File",      v: sysData?.fileConfig?.exists ? "Found" : "Not found", sub: sysData?.fileConfig?.path },
            { k: "Last Updated",     v: sysData?.fileConfig?.updatedAt ? new Date(sysData.fileConfig.updatedAt).toLocaleString("id-ID") : "—" },
          ].map(({ k, v, sub }) => (
            <div key={k} className="p-2.5 rounded-lg bg-white/[0.025] space-y-0.5">
              <div className="text-slate-500">{k}</div>
              <div className="text-slate-300 truncate">{v}</div>
              {sub && <div className="text-[10px] text-slate-600 truncate">{sub}</div>}
            </div>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
