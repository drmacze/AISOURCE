import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, Key, Brain, GitBranch, Zap, Moon, Shield,
  Save, RefreshCw, CheckCircle2, AlertCircle, Eye, EyeOff,
  Server, Database, Clock, ExternalLink, FileJson,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

interface IntegrationStatus {
  name: string;
  description: string;
  configured: boolean;
  maskedKey: string | null;
  source: string;
}

interface SettingsData {
  integrations: Record<string, IntegrationStatus>;
  fileConfig: { exists: boolean; path: string; updatedAt: string | null };
  env: { nodeEnv: string; port: string; ollamaModels: string; ollamaHost: string };
  restartRequired: boolean;
}

const INTEGRATION_ICONS: Record<string, React.ElementType> = {
  huggingface: Brain,
  moonshot: Moon,
  github: GitBranch,
  nexus: Shield,
};

const INTEGRATION_API_KEY: Record<string, string> = {
  huggingface: "hfToken",
  moonshot: "moonshotApiKey",
  github: "githubToken",
  nexus: "nexusApiKey",
};

const INTEGRATION_COLORS: Record<string, string> = {
  huggingface: "text-yellow-400",
  moonshot: "text-violet-400",
  github: "text-pink-400",
  nexus: "text-emerald-400",
};

const INTEGRATION_BG: Record<string, string> = {
  huggingface: "bg-yellow-500/10 border-yellow-500/20",
  moonshot: "bg-violet-500/10 border-violet-500/20",
  github: "bg-pink-500/10 border-pink-500/20",
  nexus: "bg-emerald-500/10 border-emerald-500/20",
};

export default function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);

  const settingsQuery = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: () => apiFetch("/api/settings"),
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiFetch("/api/settings/update", {
        method: "POST",
        body: JSON.stringify({ key, value }),
      }),
    onSuccess: () => {
      toast({
        title: "Key tersimpan",
        description: "API key aktif dan langsung berfungsi.",
      });
      setEditingKey(null);
      setKeyValue("");
      setShowKey(false);
      // Force re-fetch settings so status updates immediately
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.refetchQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: () => apiFetch("/api/settings/reload", { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: "Reloaded",
        description: data.message,
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["v1-health"] });
      qc.invalidateQueries({ queryKey: ["autotraining-status"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Reload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const data = settingsQuery.data;
  const integrations = data?.integrations || {};

  const handleSave = (key: string) => {
    if (!keyValue.trim()) return;
    updateMutation.mutate({ key: INTEGRATION_API_KEY[key] || key, value: keyValue.trim() });
  };

  const handleEdit = (key: string) => {
    setEditingKey(key);
    setKeyValue("");
    setShowKey(false);
  };

  return (
    <div className="min-h-full bg-slate-950 p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2"
          >
            <Settings className="w-6 h-6 text-slate-400" /> Settings
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-sm text-slate-500 mt-0.5"
          >
            Manage API keys, integrations, and system configuration
          </motion.p>
        </div>
        <Button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          variant="outline"
          className="border-white/10 text-slate-300 hover:text-white shrink-0"
        >
          {reloadMutation.isPending ? (
            <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1.5" />
          )}
          Hot Reload
        </Button>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(integrations).map(([key, int], i) => {
          const Icon = INTEGRATION_ICONS[key] || Key;
          const color = INTEGRATION_COLORS[key] || "text-slate-400";
          const bg = INTEGRATION_BG[key] || "bg-slate-800/50 border-white/5";
          const isEditing = editingKey === key;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className={cn(
                "rounded-xl border p-4 space-y-3",
                bg
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", bg.replace("border", "bg").split(" ")[0])}>
                    <Icon className={cn("w-4.5 h-4.5", color)} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{int.name}</h3>
                    <p className="text-xs text-slate-400">{int.description}</p>
                  </div>
                </div>
                {int.configured ? (
                  <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Not set</span>
                  </div>
                )}
              </div>

              {/* Key info */}
              {int.configured && int.maskedKey && (
                <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-black/20 rounded-lg px-3 py-2">
                  <Key className="w-3 h-3 text-slate-500" />
                  <span>{int.maskedKey}</span>
                  <span className="text-slate-600 ml-auto">{int.source}</span>
                </div>
              )}

              {/* Edit / Save area */}
              {isEditing ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={keyValue}
                      onChange={(e) => setKeyValue(e.target.value)}
                      placeholder={`Enter ${int.name} API key`}
                      className="bg-slate-950 border-white/10 text-white font-mono text-sm pr-10"
                      autoFocus
                    />
                    <button
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSave(key)}
                      disabled={!keyValue.trim() || updateMutation.isPending}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                      size="sm"
                    >
                      {updateMutation.isPending ? (
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Save
                    </Button>
                    <Button
                      onClick={() => { setEditingKey(null); setKeyValue(""); }}
                      variant="outline"
                      className="border-white/10 text-slate-300"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => handleEdit(key)}
                  variant="outline"
                  className="w-full border-white/10 text-slate-300 hover:text-white text-sm"
                  size="sm"
                >
                  <Key className="w-3.5 h-3.5 mr-1.5" />
                  {int.configured ? "Update Key" : "Add Key"}
                </Button>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* System Info */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-white">System Configuration</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-sm">
          {[
            { k: "Node Environment", v: data?.env?.nodeEnv || "—" },
            { k: "API Port", v: data?.env?.port || "—" },
            { k: "Ollama Host", v: data?.env?.ollamaHost || "—" },
            { k: "Ollama Models Path", v: data?.env?.ollamaModels || "—" },
            { k: "Config File", v: data?.fileConfig?.exists ? "Yes" : "No", sub: data?.fileConfig?.path },
            { k: "Config Updated", v: data?.fileConfig?.updatedAt ? new Date(data.fileConfig.updatedAt).toLocaleString() : "—" },
          ].map(({ k, v, sub }) => (
            <div key={k} className="flex flex-col gap-0.5 p-2.5 rounded-lg bg-white/[0.02]">
              <span className="text-xs text-slate-500">{k}</span>
              <span className="text-slate-300 text-xs">{v}</span>
              {sub && <span className="text-[10px] text-slate-600 truncate">{sub}</span>}
            </div>
          ))}
        </div>
      </motion.div>

      {/* How to get keys */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <ExternalLink className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-white">Where to get API keys</h2>
        </div>
        <div className="space-y-3">
          {[
            {
              name: "HuggingFace",
              url: "https://huggingface.co/settings/tokens",
              desc: "Create a free account, then generate a Read token for inference",
            },
            {
              name: "Kimi K2 (Moonshot)",
              url: "https://platform.moonshot.cn",
              desc: "Sign up at MoonshotAI platform and create an API key",
            },
            {
              name: "GitHub",
              url: "https://github.com/settings/tokens",
              desc: "Generate a personal access token (no scopes needed for public repos)",
            },
          ].map((item) => (
            <a
              key={item.name}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{item.name}</span>
                  <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-blue-400 transition-colors" />
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
              </div>
            </a>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
