import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  useListTrainingDatasets,
  useListTrainingJobs,
  useListModels,
  useCreateTrainingDataset,
  useAddTrainingSample,
  useStartTrainingJob,
  useRegisterModel,
  getListTrainingDatasetsQueryKey,
  getListTrainingJobsQueryKey,
  getListModelsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Network, Cpu, Database, Play, Loader2, AlertCircle, CheckCircle2,
  Plus, Download, Trash2, RefreshCw, Zap, Square, Terminal,
  ChevronRight, Package, Brain, Code2, Globe, Sparkles, X,
  Github, BookOpen, Newspaper, FlaskConical, MessageSquare, Activity,
  HardDrive, Languages, Shield, Settings, Link,
  BarChart2, RotateCcw, Filter, Clock, ChevronDown, ChevronUp,
  Target, Gauge, TrendingUp, Eraser, Power, ExternalLink, Layers,
  Radar, FolderKanban, Calendar, Crosshair, GitMerge, Share2,
  ThumbsUp, ThumbsDown,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

// ── Auto-Training Live Panel ──────────────────────────────────────────────────
interface AutoTrainingStatus {
  running: boolean;
  currentlyCycling: boolean;
  totalCyclesCompleted: number;
  totalSamplesAdded: number;
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  activityLog: Array<{ at: string; msg: string; type: "info" | "success" | "error" }>;
  sourceStats: Record<string, number>;
  sourceEnabled: Record<string, boolean>;
  hfConnected: boolean;
  githubConnected: boolean;
  githubToken: string;
  deduplicationActive: boolean;
  totalDedupCacheSize: number;
  languages: string[];
  config?: {
    intervalMinutes: number;
    microIntervalSeconds: number;
    sourceEnabled: Record<string, boolean>;
    autoTrigger: { enabled: boolean; threshold: number; samplesCollected: number; samplesUntilTrigger: number };
  };
}

interface QualityReport {
  total: number;
  avgQuality: number;
  distribution: { excellent: number; good: number; fair: number; poor: number };
  avgInputLen: number;
  avgOutputLen: number;
  sourceCounts: Record<string, number>;
  lowQualityCount: number;
  recommendation: string;
}

interface BenchmarkResult {
  model: string;
  results: Array<{ id: string; prompt: string; response: string; latencyMs: number; tokensPerSec: number | null; passed: boolean | null }>;
  summary: { accuracy: number | null; avgLatencyMs: number; totalTokens: number; passed: number; failed: number; grade: string };
  ranAt: string;
}

interface DatasetStats {
  totalSamples: number;
  datasets: Array<{ id: number; name: string; sampleCount: number; updatedAt: string }>;
  sourceBreakdown: Record<string, number>;
}

function getApiBase(): string {
  const env = (import.meta as { env?: { VITE_API_URL?: string } }).env;
  return (env?.VITE_API_URL || "").replace(/\/$/, "");
}

const SOURCE_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  "wikipedia-en":           { icon: <BookOpen className="w-3 h-3" />, label: "Wikipedia EN",       color: "text-blue-400" },
  "wikipedia-multilingual": { icon: <Languages className="w-3 h-3" />, label: "Wikipedia Multi",   color: "text-cyan-400" },
  "wikipedia":              { icon: <BookOpen className="w-3 h-3" />, label: "Wikipedia",           color: "text-blue-400" },
  hackernews:               { icon: <Newspaper className="w-3 h-3" />, label: "HackerNews",        color: "text-orange-400" },
  reddit:                   { icon: <MessageSquare className="w-3 h-3" />, label: "Reddit",        color: "text-orange-500" },
  arxiv:                    { icon: <FlaskConical className="w-3 h-3" />, label: "arXiv Papers",   color: "text-purple-400" },
  rss:                      { icon: <Newspaper className="w-3 h-3" />, label: "RSS Feeds",         color: "text-yellow-400" },
  huggingface:              { icon: <Brain className="w-3 h-3" />, label: "HuggingFace",           color: "text-yellow-300" },
  openassistant:            { icon: <MessageSquare className="w-3 h-3" />, label: "OpenAssistant", color: "text-pink-400" },
  curated:                  { icon: <Shield className="w-3 h-3" />, label: "Curated AI Q&A",       color: "text-green-400" },
  github:                   { icon: <Github className="w-3 h-3" />, label: "GitHub Trending",       color: "text-white" },
  "github-datasets":        { icon: <Database className="w-3 h-3" />, label: "GitHub Datasets",    color: "text-green-300" },
  "github-issues":          { icon: <MessageSquare className="w-3 h-3" />, label: "GitHub Issues", color: "text-gray-300" },
  devto:                    { icon: <Code2 className="w-3 h-3" />, label: "DEV.to Articles",       color: "text-indigo-400" },
};

function AutoTrainingPanel() {
  const [status, setStatus] = useState<AutoTrainingStatus | null>(null);
  const [dbStats, setDbStats] = useState<DatasetStats | null>(null);
  const [running, setRunning] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [configInterval, setConfigInterval] = useState("180");
  const [configMicro, setConfigMicro] = useState("60");
  const [autoTriggerEnabled, setAutoTriggerEnabled] = useState(false);
  const [autoTriggerThreshold, setAutoTriggerThreshold] = useState("500");
  const [configSaving, setConfigSaving] = useState(false);
  const BASE = (window as Window & { _apiBase?: string })._apiBase || getApiBase();

  const fetchStatus = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch(`${BASE}/api/autotraining/status`).then((r) => r.json()) as Promise<AutoTrainingStatus>,
        fetch(`${BASE}/api/autotraining/dataset-stats`).then((r) => r.json()) as Promise<DatasetStats>,
      ]);
      setStatus(s);
      setDbStats(d);
    } catch { /* ignore */ }
  }, [BASE]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleRunCycle = async () => {
    setRunning(true);
    try {
      await fetch(`${BASE}/api/autotraining/run`, { method: "POST" });
      setTimeout(() => { fetchStatus(); setRunning(false); }, 2000);
    } catch { setRunning(false); }
  };

  const handleToggle = async () => {
    if (status?.running) {
      await fetch(`${BASE}/api/autotraining/stop`, { method: "POST" });
    } else {
      await fetch(`${BASE}/api/autotraining/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalMinutes: 180 }) });
    }
    setTimeout(fetchStatus, 500);
  };

  const totalFromBreakdown = dbStats ? Object.values(dbStats.sourceBreakdown).reduce((a, b) => a + b, 0) : 0;

  // Sync config state from status
  useEffect(() => {
    if (status?.config) {
      setConfigInterval(String(status.config.intervalMinutes));
      setConfigMicro(String(status.config.microIntervalSeconds));
      setAutoTriggerEnabled(status.config.autoTrigger.enabled);
      setAutoTriggerThreshold(String(status.config.autoTrigger.threshold));
    }
  }, [status?.config?.intervalMinutes]);

  const handleToggleSource = async (source: string, enabled: boolean) => {
    await fetch(`${BASE}/api/autotraining/toggle-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, enabled }),
    });
    fetchStatus();
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      await fetch(`${BASE}/api/autotraining/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intervalMinutes: parseInt(configInterval, 10),
          microIntervalSeconds: parseInt(configMicro, 10),
          autoTrigger: { enabled: autoTriggerEnabled, threshold: parseInt(autoTriggerThreshold, 10) },
        }),
      });
      fetchStatus();
    } finally {
      setConfigSaving(false);
    }
  };

  const ALL_SOURCES = [
    "wikipedia-en", "wikipedia-multilingual", "hackernews", "reddit",
    "arxiv", "rss", "huggingface", "openassistant", "curated",
    "github", "github-datasets", "github-issues", "devto", "stackexchange",
  ];
  const SOURCE_EXTRA: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    stackexchange:          { icon: <Layers className="w-3 h-3" />, label: "StackExchange",  color: "text-orange-300" },
    openassistant:          { icon: <MessageSquare className="w-3 h-3" />, label: "OpenAssistant", color: "text-pink-400" },
    ...Object.fromEntries(Object.entries(SOURCE_META)),
  };

  return (
    <Card className="glass-panel border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4 text-primary animate-pulse" />
            Live Auto-Training Engine
            <span className="text-xs font-mono font-normal text-muted-foreground ml-1">
              — 24/7 knowledge acquisition
            </span>
            {status?.currentlyCycling && (
              <span className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                <Loader2 className="w-3 h-3 animate-spin" /> cycling…
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              className="gap-1.5 font-mono text-xs h-7"
              onClick={handleRunCycle}
              disabled={running || status?.currentlyCycling}
            >
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              Run Cycle
            </Button>
            <Button
              size="sm"
              variant={status?.running ? "destructive" : "default"}
              className="gap-1.5 font-mono text-xs h-7"
              onClick={handleToggle}
            >
              {status?.running ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {status?.running ? "Stop" : "Start"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Samples", value: dbStats?.totalSamples?.toLocaleString() ?? "—", sub: "in database", color: "text-green-400" },
            { label: "Cycles Done", value: status?.totalCyclesCompleted ?? "—", sub: "full cycles", color: "text-primary" },
            { label: "Sources Active", value: status?.sourceEnabled ? Object.values(status.sourceEnabled).filter(Boolean).length : 14, sub: "data streams", color: "text-blue-400" },
            { label: "Dedup Cache", value: status?.totalDedupCacheSize?.toLocaleString() ?? "—", sub: "unique hashes", color: "text-purple-400" },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-lg border border-border bg-background/50 text-center">
              <div className={`text-xl font-bold font-mono ${s.color}`}>{String(s.value)}</div>
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{s.label}</div>
              <div className="text-[9px] text-muted-foreground/60">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Connection badges */}
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          <span className={`flex items-center gap-1 px-2 py-1 rounded border ${status?.githubConnected ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"}`}>
            <Github className="w-3 h-3" />
            {status?.githubToken ?? "GitHub"}
          </span>
          <span className={`flex items-center gap-1 px-2 py-1 rounded border ${status?.hfConnected ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-300" : "border-border text-muted-foreground"}`}>
            <Brain className="w-3 h-3" />
            {status?.hfConnected ? "HuggingFace connected" : "HF not configured"}
          </span>
          {(status?.languages || []).map((lang) => (
            <span key={lang} className="flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
              <Globe className="w-3 h-3" />
              {lang.toUpperCase()}
            </span>
          ))}
          <span className="flex items-center gap-1 px-2 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400">
            <Shield className="w-3 h-3" />
            dedup active
          </span>
          <span className="flex items-center gap-1 px-2 py-1 rounded border border-border text-muted-foreground">
            <HardDrive className="w-3 h-3" />
            disk: /workspace/.ollama-models
          </span>
        </div>

        {/* Source breakdown */}
        {dbStats?.sourceBreakdown && Object.keys(dbStats.sourceBreakdown).length > 0 && (
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-2">Sample distribution by source ({totalFromBreakdown} total)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {Object.entries(dbStats.sourceBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([src, cnt]) => {
                  const meta = SOURCE_META[src] || { icon: <Database className="w-3 h-3" />, label: src, color: "text-muted-foreground" };
                  const pct = totalFromBreakdown > 0 ? Math.round((cnt / totalFromBreakdown) * 100) : 0;
                  return (
                    <div key={src} className="flex items-center gap-2 p-2 rounded border border-border bg-background/40 text-[10px] font-mono">
                      <span className={meta.color}>{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="truncate text-foreground/80">{meta.label}</span>
                          <span className={`shrink-0 font-bold ${meta.color}`}>{cnt}</span>
                        </div>
                        <div className="mt-0.5 h-0.5 rounded-full bg-border overflow-hidden">
                          <div className="h-full bg-primary/50 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Schedule info + controls */}
        <div className="flex flex-wrap gap-3 text-[10px] font-mono text-muted-foreground border-t border-border pt-3">
          <span>Last: <span className="text-foreground">{status?.lastCycleAt ? format(new Date(status.lastCycleAt), "HH:mm:ss") : "—"}</span></span>
          <span>Next: <span className="text-foreground">{status?.nextCycleAt ? format(new Date(status.nextCycleAt), "HH:mm:ss") : "—"}</span></span>
          <span>Status: <span className={status?.running ? "text-green-400" : "text-yellow-400"}>{status?.running ? "● RUNNING" : "○ PAUSED"}</span></span>
          <div className="ml-auto flex gap-2">
            <button className="text-primary hover:text-primary/80 underline-offset-2 hover:underline" onClick={() => setShowSources(!showSources)}>
              {showSources ? "▲ sources" : "▼ sources"}
            </button>
            <button className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline" onClick={() => setShowConfig(!showConfig)}>
              {showConfig ? "▲ config" : "▼ config"}
            </button>
            <button className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline" onClick={() => setShowLog(!showLog)}>
              {showLog ? "▲ log" : "▼ log"}
            </button>
          </div>
        </div>

        {/* Source toggle panel */}
        {showSources && (
          <div className="border border-border rounded-lg bg-background/40 p-3 space-y-2">
            <p className="text-xs font-mono font-medium text-muted-foreground flex items-center gap-1.5">
              <Power className="w-3 h-3" /> Source Controls — toggle data streams on/off
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {ALL_SOURCES.map((src) => {
                const meta = SOURCE_EXTRA[src] || { icon: <Database className="w-3 h-3" />, label: src, color: "text-muted-foreground" };
                const enabled = status?.sourceEnabled?.[src] ?? true;
                const samplesFromSrc = dbStats?.sourceBreakdown?.[src] || status?.sourceStats?.[src] || 0;
                return (
                  <button
                    key={src}
                    onClick={() => handleToggleSource(src, !enabled)}
                    className={`flex items-center gap-2 p-2 rounded border text-[10px] font-mono transition-all ${
                      enabled
                        ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
                        : "border-border bg-background/20 opacity-50 hover:opacity-70"
                    }`}
                  >
                    <span className={enabled ? meta.color : "text-muted-foreground/40"}>{meta.icon}</span>
                    <div className="flex-1 text-left min-w-0">
                      <div className="truncate text-foreground/80">{meta.label}</div>
                      <div className={`font-bold ${enabled ? meta.color : "text-muted-foreground/40"}`}>
                        {samplesFromSrc > 0 ? `${samplesFromSrc} samples` : enabled ? "enabled" : "disabled"}
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${enabled ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Config panel */}
        {showConfig && (
          <div className="border border-blue-500/20 rounded-lg bg-blue-500/5 p-3 space-y-3">
            <p className="text-xs font-mono font-medium text-blue-400 flex items-center gap-1.5">
              <Settings className="w-3 h-3" /> Engine Configuration
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Main cycle interval (minutes)
                </label>
                <input
                  type="number" min="1" max="1440"
                  value={configInterval}
                  onChange={(e) => setConfigInterval(e.target.value)}
                  className="w-full h-7 px-2 rounded border border-border bg-background text-xs font-mono text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Micro cycle interval (seconds)
                </label>
                <input
                  type="number" min="10" max="3600"
                  value={configMicro}
                  onChange={(e) => setConfigMicro(e.target.value)}
                  className="w-full h-7 px-2 rounded border border-border bg-background text-xs font-mono text-foreground"
                />
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="space-y-1 flex-1">
                <label className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" /> Auto-trigger training after N new samples
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAutoTriggerEnabled(!autoTriggerEnabled)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                      autoTriggerEnabled
                        ? "border-green-500/40 bg-green-500/10 text-green-400"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {autoTriggerEnabled ? "● ENABLED" : "○ DISABLED"}
                  </button>
                  <input
                    type="number" min="50" max="100000"
                    value={autoTriggerThreshold}
                    onChange={(e) => setAutoTriggerThreshold(e.target.value)}
                    disabled={!autoTriggerEnabled}
                    className="w-24 h-7 px-2 rounded border border-border bg-background text-xs font-mono text-foreground disabled:opacity-40"
                  />
                  {status?.config?.autoTrigger.enabled && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {status.config.autoTrigger.samplesCollected}/{status.config.autoTrigger.threshold} collected
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button size="sm" className="h-7 text-xs font-mono gap-1.5" onClick={handleSaveConfig} disabled={configSaving}>
              {configSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Save Config
            </Button>
          </div>
        )}

        {/* Activity log */}
        {showLog && status?.activityLog && status.activityLog.length > 0 && (
          <div className="bg-black/60 rounded-lg p-3 font-mono text-[10px] max-h-48 overflow-y-auto space-y-0.5 border border-border">
            {status.activityLog.slice(0, 50).map((entry, i) => (
              <div key={i} className={`flex gap-2 ${
                entry.type === "success" ? "text-green-400/90" :
                entry.type === "error" ? "text-red-400/90" : "text-muted-foreground"
              }`}>
                <span className="text-muted-foreground/50 shrink-0">{entry.at.slice(11, 19)}</span>
                <span>{entry.msg}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ── Types ────────────────────────────────────────────────────────────────────
interface OllamaModel {
  name: string;
  size: number;
  parameterSize: string;
  quantization: string;
  family: string;
  modified: string;
}

interface CliLine {
  id: number;
  type: "info" | "stdout" | "stderr" | "error" | "progress" | "user" | "system";
  text: string;
  ts: number;
}

// ── Hooks ────────────────────────────────────────────────────────────────────
function useOllamaModels() {
  return useQuery<OllamaModel[]>({
    queryKey: ["ollama-models"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ollama-models`);
      if (!res.ok) return [];
      return res.json() as Promise<OllamaModel[]>;
    },
    refetchInterval: 8000,
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── One-click download button for model catalogue ─────────────────────────────
function DownloadButton({ model, onDone }: { model: string; onDone?: () => void }) {
  const BASE = getApiBase();
  const [status, setStatus] = useState<"idle" | "pulling" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const handleClick = () => {
    if (status === "pulling") return;
    setStatus("pulling");
    setMsg("Starting...");

    fetch(`${BASE}/api/models/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        setStatus("error");
        setMsg("Failed to start");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.startsWith("data:"));
        for (const line of lines) {
          try {
            const evt = JSON.parse(line.slice(5).trim()) as { type: string; text?: string; success?: boolean };
            if (evt.type === "done") {
              if (evt.success) {
                setStatus("done");
                setMsg("Done");
                onDone?.();
              } else {
                setStatus("error");
                setMsg("Failed");
              }
            } else if (evt.type === "error" || evt.type === "stderr") {
              setMsg(evt.text || "Error");
            } else {
              setMsg(evt.text || "Downloading...");
            }
          } catch { /* skip */ }
        }
      }
    }).catch((err) => {
      setStatus("error");
      setMsg(String(err));
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={status === "pulling"}
      className={`flex items-center gap-0.5 text-[10px] font-mono shrink-0 mt-0.5 transition-colors ${
        status === "done" ? "text-green-500" :
        status === "error" ? "text-red-400 hover:text-red-300" :
        "text-primary/70 hover:text-primary"
      }`}
      title={msg}
    >
      {status === "pulling" ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : status === "done" ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : status === "error" ? (
        <AlertCircle className="w-3 h-3" />
      ) : (
        <Download className="w-3 h-3" />
      )}
      {status === "pulling" ? (msg || "pulling...") : status === "done" ? "done" : status === "error" ? "retry" : "pull"}
    </button>
  );
}

// ── Extended model catalogue (works within available RAM) ────────────────────
const MODEL_CATALOGUE = [
  // Ultrafast (<1GB)
  { name: "tinyllama:latest",  desc: "1B · 637MB · TinyLlama — ultra-fast general chat",       size: "637MB",  tag: "fast",      icon: "⚡" },
  { name: "smollm2:1.7b",      desc: "1.7B · 1.1GB · SmolLM2 — compact & efficient",           size: "1.1GB",  tag: "fast",      icon: "⚡" },
  { name: "llama3.2:1b",       desc: "1B · 1.3GB · Meta Llama 3.2 — very fast",                size: "1.3GB",  tag: "fast",      icon: "⚡" },
  // Smart (1-2GB)
  { name: "qwen2.5:1.5b",      desc: "1.5B · 986MB · Qwen 2.5 — fast & capable (installed)",  size: "986MB",  tag: "smart",     icon: "🧠" },
  { name: "deepseek-r1:1.5b",  desc: "1.5B · 1.1GB · DeepSeek-R1 — reasoning model",          size: "1.1GB",  tag: "reasoning", icon: "🔍" },
  { name: "gemma2:2b",         desc: "2B · 1.6GB · Google Gemma 2 — very accurate",            size: "1.6GB",  tag: "smart",     icon: "🧠" },
  { name: "phi3.5:3.8b",       desc: "3.8B · 2.2GB · Microsoft Phi-3.5 — excellent reasoning", size: "2.2GB",  tag: "reasoning", icon: "🔍" },
  // Balanced (2-3GB)
  { name: "llama3.2:3b",       desc: "3B · 2.0GB · Meta Llama 3.2 — well-rounded",             size: "2.0GB",  tag: "smart",     icon: "🧠" },
  { name: "qwen2.5:3b",        desc: "3B · 2.0GB · Qwen 2.5 3B — great multilingual",          size: "2.0GB",  tag: "multilang", icon: "🌍" },
  { name: "mistral:7b",        desc: "7B · 4.1GB · Mistral 7B v0.3 — powerful",                size: "4.1GB",  tag: "smart",     icon: "🧠" },
  // Coding
  { name: "qwen2.5-coder:1.5b",desc: "1.5B · 986MB · Qwen Coder — specialized for code",      size: "986MB",  tag: "coding",    icon: "💻" },
  { name: "codegemma:2b",       desc: "2B · 1.6GB · Google CodeGemma — code generation",       size: "1.6GB",  tag: "coding",    icon: "💻" },
  { name: "deepseek-coder:1.3b",desc: "1.3B · 776MB · DeepSeek Coder — fast coding AI",       size: "776MB",  tag: "coding",    icon: "💻" },
  // Multilingual
  { name: "aya:8b",             desc: "8B · 4.8GB · Aya — 23-language multilingual model",     size: "4.8GB",  tag: "multilang", icon: "🌍" },
  { name: "qwen3:1.7b",         desc: "1.7B · 1.1GB · Qwen 3 latest — latest generation",      size: "1.1GB",  tag: "smart",     icon: "🧠" },
  // Reasoning
  { name: "deepseek-r1:7b",    desc: "7B · 4.7GB · DeepSeek-R1 7B — deep reasoning",          size: "4.7GB",  tag: "reasoning", icon: "🔍" },
  { name: "qwq:latest",         desc: "32B · 20GB · QwQ — advanced reasoning (needs RAM)",     size: "20GB",   tag: "reasoning", icon: "🔍" },
];

const TAG_COLORS: Record<string, string> = {
  fast:      "bg-green-500/15 text-green-400 border-green-500/30",
  smart:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  reasoning: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  coding:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  multilang: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

// ── CLI Terminal Component ───────────────────────────────────────────────────
function CliTerminal({
  installedModels,
  onModelsChanged,
}: {
  installedModels: string[];
  onModelsChanged: () => void;
}) {
  const [lines, setLines] = useState<CliLine[]>([
    { id: 0, type: "system", text: "DLavie OS Ollama CLI — type 'help' for commands", ts: Date.now() },
    { id: 1, type: "system", text: "Commands: pull <model>, list, rm <model>, show <model>, ps, version", ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lineId = useRef(2);

  const addLine = useCallback((type: CliLine["type"], text: string) => {
    setLines((prev) => [...prev, { id: lineId.current++, type, text, ts: Date.now() }]);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleTabComplete = () => {
    const parts = input.trim().split(/\s+/);
    if (parts.length >= 2) {
      const partial = parts[parts.length - 1].toLowerCase();
      const matches = installedModels.filter((m) => m.toLowerCase().startsWith(partial));
      if (matches.length === 1) {
        setInput(parts.slice(0, -1).join(" ") + " " + matches[0]);
        setSuggestions([]);
      } else if (matches.length > 1) {
        setSuggestions(matches);
      }
    }
  };

  const runCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    addLine("user", `dlavie@ollama:~$ ${cmd}`);
    setSuggestions([]);

    if (history[0] !== cmd) setHistory((h) => [cmd, ...h.slice(0, 49)]);
    setHistoryIdx(-1);

    // Local commands
    const parts = cmd.trim().toLowerCase().split(/\s+/);
    const verb = parts[0];

    if (verb === "help" || verb === "?") {
      addLine("stdout", "Available commands:");
      addLine("stdout", "  pull <model>   — Download model from ollama.com/library");
      addLine("stdout", "  list / ls      — List all installed models");
      addLine("stdout", "  rm <model>     — Remove an installed model");
      addLine("stdout", "  show <model>   — Show model info");
      addLine("stdout", "  ps             — Show loaded models");
      addLine("stdout", "  version        — Show Ollama version");
      addLine("stdout", "  clear          — Clear terminal");
      addLine("stdout", "");
      addLine("stdout", "Examples:");
      addLine("stdout", "  pull qwen2.5:1.5b");
      addLine("stdout", "  rm tinyllama:latest");
      return;
    }

    if (verb === "clear" || verb === "cls") {
      setLines([{ id: lineId.current++, type: "system", text: "Terminal cleared.", ts: Date.now() }]);
      return;
    }

    setRunning(true);
    try {
      const response = await fetch(`${BASE}/api/cli/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });

      if (!response.ok || !response.body) {
        addLine("error", `❌ Server error: HTTP ${response.status}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const sseLines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const sseLine of sseLines) {
          try {
            const data = JSON.parse(sseLine.slice(6)) as {
              type: string;
              text?: string;
              exitCode?: number;
              error?: boolean;
              needsModelRefresh?: boolean;
            };

            if (data.type === "done") {
              if (data.exitCode === 0) {
                addLine("stdout", `✅ Done (exit 0)`);
              } else if (data.error) {
                addLine("error", `❌ Command failed (exit ${data.exitCode ?? "?"})`);
              }
              if (data.needsModelRefresh) {
                onModelsChanged();
                addLine("system", "⟳ Model list refreshed");
              }
            } else if (data.text) {
              addLine(data.type as CliLine["type"], data.text);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      addLine("error", `❌ ${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!running && input.trim()) {
        runCommand(input.trim());
        setInput("");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      handleTabComplete();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      if (history[nextIdx]) setInput(history[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(nextIdx);
      setInput(nextIdx === -1 ? "" : history[nextIdx] || "");
    } else if (e.key === "c" && e.ctrlKey) {
      setRunning(false);
      addLine("system", "^C");
      setInput("");
    }
  };

  const lineColor = (type: CliLine["type"]) => {
    switch (type) {
      case "user":     return "text-primary font-semibold";
      case "system":   return "text-muted-foreground/70 italic";
      case "stdout":   return "text-green-400/90";
      case "stderr":   return "text-yellow-400/90";
      case "progress": return "text-blue-400/90";
      case "error":    return "text-red-400";
      case "info":     return "text-cyan-400/90";
      default:         return "text-foreground/80";
    }
  };

  return (
    <div
      className="bg-black/90 rounded-xl border border-border/60 font-mono text-xs flex flex-col h-72 overflow-hidden"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Terminal header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10 bg-white/5 shrink-0">
        <span className="w-3 h-3 rounded-full bg-red-500/80" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <span className="w-3 h-3 rounded-full bg-green-500/80" />
        <span className="ml-3 text-white/40 text-[10px] uppercase tracking-widest">
          dlavie_os — ollama terminal
        </span>
        <button
          onClick={() => setLines([{ id: lineId.current++, type: "system", text: "Terminal cleared.", ts: Date.now() }])}
          className="ml-auto text-white/30 hover:text-white/60 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-0.5 terminal-scrollbar"
      >
        {lines.map((line) => (
          <div key={line.id} className={`leading-5 whitespace-pre-wrap break-all ${lineColor(line.type)}`}>
            {line.text}
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2 text-primary">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-primary"
              style={{ animation: "neural-pulse 0.8s ease-in-out infinite" }}
            />
            <span className="animate-pulse">running...</span>
          </div>
        )}
      </div>

      {/* Tab-complete suggestions */}
      {suggestions.length > 0 && (
        <div className="px-3 py-1 bg-white/5 border-t border-white/10 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => {
                const parts = input.trim().split(/\s+/);
                setInput(parts.slice(0, -1).join(" ") + " " + s);
                setSuggestions([]);
              }}
              className="text-[10px] text-primary/80 hover:text-primary underline-offset-2 hover:underline"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 bg-white/3 shrink-0">
        <span className="text-primary shrink-0">dlavie@ollama:~$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setSuggestions([]); }}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder={running ? "" : "type a command..."}
          className="flex-1 bg-transparent outline-none text-white placeholder:text-white/25 caret-primary"
          autoComplete="off"
          spellCheck={false}
        />
        {running ? (
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
        ) : (
          <span
            className="w-0.5 h-4 bg-primary/70 rounded-sm shrink-0"
            style={{ animation: "terminal-blink 1s step-end infinite" }}
          />
        )}
      </div>
    </div>
  );
}

// ── HF AutoTrain Panel ───────────────────────────────────────────────────────
interface HFInfo {
  configured: boolean; username?: string; fullname?: string; plan?: string; message?: string;
}
interface HFPushResult {
  ok: boolean; repoId?: string; repoUrl?: string; samplesUploaded?: number; error?: string;
}
interface HFTrainResult {
  ok: boolean; method?: string; projectName?: string; outputModelUrl?: string; launchUrl?: string; configYaml?: string; error?: string; message?: string;
}
interface HFBaseModel {
  id: string; label: string; vram: string; recommended: boolean;
}

function HFAutoTrainPanel({ datasets }: { datasets?: Array<{ id: number; name: string }> }) {
  const BASE = (window as Window & { _apiBase?: string })._apiBase || getApiBase();
  const [hfInfo, setHfInfo] = useState<HFInfo | null>(null);
  const [baseModels, setBaseModels] = useState<HFBaseModel[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedBase, setSelectedBase] = useState("unsloth/Qwen2.5-7B-Instruct");
  const [repoName, setRepoName] = useState("");
  const [epochs, setEpochs] = useState("3");
  const [manualUsername, setManualUsername] = useState("");

  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<HFPushResult | null>(null);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainResult, setTrainResult] = useState<HFTrainResult | null>(null);
  const [showYaml, setShowYaml] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/hf/autotrain/info`).then((r) => r.json()).then(setHfInfo).catch(() => {});
    fetch(`${BASE}/api/hf/autotrain/models`).then((r) => r.json()).then(setBaseModels).catch(() => {});
  }, [BASE]);

  // Effective username: from HF profile or manual input
  const effectiveUsername = hfInfo?.username || manualUsername.trim();
  const needsUsername = hfInfo?.configured && !hfInfo?.username;

  const handlePush = async () => {
    if (!selectedDatasetId) return;
    setPushLoading(true); setPushResult(null); setTrainResult(null);
    try {
      const r = await fetch(`${BASE}/api/hf/dataset/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: Number(selectedDatasetId),
          repoName: repoName || undefined,
          private: false,
          hfUsername: manualUsername.trim() || undefined,
        }),
      });
      const data = await r.json() as HFPushResult;
      setPushResult(data);
    } catch (err) {
      setPushResult({ ok: false, error: String(err) });
    } finally {
      setPushLoading(false);
    }
  };

  const handleTrain = async () => {
    if (!pushResult?.repoId) return;
    setTrainLoading(true); setTrainResult(null);
    try {
      const r = await fetch(`${BASE}/api/hf/autotrain/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetRepoId: pushResult.repoId,
          baseModel: selectedBase,
          epochs: Number(epochs),
          hfUsername: manualUsername.trim() || undefined,
        }),
      });
      const data = await r.json() as HFTrainResult;
      setTrainResult(data);
    } catch (err) {
      setTrainResult({ ok: false, error: String(err) });
    } finally {
      setTrainLoading(false);
    }
  };

  const notConfigured = hfInfo && !hfInfo.configured;

  return (
    <Card className="glass-panel border-violet-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="w-4 h-4 text-violet-400" />
          HuggingFace AutoTrain
          <span className="text-[10px] font-mono font-normal text-muted-foreground ml-1">
            fine-tuning di GPU HF — gratis
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* HF Token Status */}
        <div className={`flex items-center gap-2 p-2.5 rounded border text-xs font-mono ${
          hfInfo?.configured
            ? "border-green-500/30 bg-green-500/5 text-green-400"
            : "border-amber-500/30 bg-amber-500/5 text-amber-400"
        }`}>
          {hfInfo?.configured
            ? hfInfo.username
              ? <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /><span>Terhubung sebagai <b>{hfInfo.username}</b> (plan: {hfInfo.plan})</span></>
              : <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /><span>HF_TOKEN aktif — profil terbatas (fine-grained token). Masukkan username HF di bawah.</span></>
            : <><AlertCircle className="w-3.5 h-3.5 shrink-0" /><span>{hfInfo?.message ?? "Memeriksa HF_TOKEN…"} → Tambahkan di Settings → API Keys → HuggingFace</span></>
          }
          {!hfInfo && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>

        {/* Manual username input — shown when token valid but profile not accessible */}
        {needsUsername && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Username HuggingFace</label>
            <Input
              placeholder="contoh: johndoe  (lihat huggingface.co/settings/profile)"
              value={manualUsername}
              onChange={(e) => setManualUsername(e.target.value)}
              className="h-8 text-xs font-mono"
            />
            {manualUsername && (
              <p className="text-[10px] text-muted-foreground">
                Dataset akan diupload ke: <code className="text-violet-400">huggingface.co/datasets/{manualUsername}/…</code>
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Step 1 */}
          <div className="space-y-3 p-3 rounded border border-white/5 bg-white/2">
            <p className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] flex items-center justify-center font-bold">1</span>
              Push Dataset ke HF Hub
            </p>
            <div className="space-y-2">
              <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId} disabled={notConfigured ?? false}>
                <SelectTrigger className="h-8 text-xs font-mono">
                  <SelectValue placeholder="Pilih dataset…" />
                </SelectTrigger>
                <SelectContent>
                  {(datasets ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)} className="text-xs font-mono">{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Nama repo HF (opsional)"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                className="h-8 text-xs font-mono"
                disabled={notConfigured ?? false}
              />
              <Button
                size="sm" className="w-full gap-1.5 text-xs"
                disabled={!selectedDatasetId || pushLoading || (notConfigured ?? false)}
                onClick={handlePush}
              >
                {pushLoading
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                  : <><Download className="w-3 h-3" /> Push ke HF Hub</>
                }
              </Button>
            </div>
            {pushResult && (
              <div className={`p-2 rounded text-[11px] font-mono ${pushResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                {pushResult.ok
                  ? <><CheckCircle2 className="w-3 h-3 inline mr-1" />{pushResult.samplesUploaded} samples → <a href={pushResult.repoUrl} target="_blank" rel="noreferrer" className="underline">{pushResult.repoId}</a></>
                  : <><AlertCircle className="w-3 h-3 inline mr-1" />{pushResult.error}</>
                }
              </div>
            )}
          </div>

          {/* Step 2 */}
          <div className="space-y-3 p-3 rounded border border-white/5 bg-white/2">
            <p className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] flex items-center justify-center font-bold">2</span>
              Launch AutoTrain di GPU HF
            </p>
            <div className="space-y-2">
              <Select value={selectedBase} onValueChange={setSelectedBase} disabled={!pushResult?.ok}>
                <SelectTrigger className="h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {baseModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs font-mono">
                      {m.label} {m.recommended ? "⭐" : ""} · {m.vram} VRAM
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-mono text-muted-foreground shrink-0">Epochs</label>
                <Input value={epochs} onChange={(e) => setEpochs(e.target.value)} className="h-8 text-xs font-mono" type="number" min="1" max="10" disabled={!pushResult?.ok} />
              </div>
              <Button
                size="sm" className="w-full gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                disabled={!pushResult?.ok || trainLoading}
                onClick={handleTrain}
              >
                {trainLoading
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Launching…</>
                  : <><Zap className="w-3 h-3" /> Launch AutoTrain Job</>
                }
              </Button>
            </div>
            {trainResult && (
              <div className={`p-2 rounded text-[11px] font-mono space-y-1 ${trainResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                {trainResult.ok ? (
                  <>
                    <div><CheckCircle2 className="w-3 h-3 inline mr-1" />
                      {trainResult.method === "autotrain-api"
                        ? `Job dibuat: ${trainResult.projectName}`
                        : trainResult.message ?? "Config siap"}
                    </div>
                    {trainResult.outputModelUrl && (
                      <div><a href={trainResult.outputModelUrl} target="_blank" rel="noreferrer" className="underline">{trainResult.outputModelUrl}</a></div>
                    )}
                    <div className="flex gap-2 mt-1">
                      {trainResult.launchUrl && (
                        <a href={trainResult.launchUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-violet-500/20 text-violet-400 text-[10px] hover:bg-violet-500/30">
                          <ExternalLink className="w-2.5 h-2.5" /> Buka AutoTrain
                        </a>
                      )}
                      {trainResult.configYaml && (
                        <button onClick={() => setShowYaml(!showYaml)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-muted-foreground text-[10px] hover:bg-white/10">
                          <Terminal className="w-2.5 h-2.5" /> {showYaml ? "Sembunyikan" : "Lihat"} Config YAML
                        </button>
                      )}
                    </div>
                    {showYaml && trainResult.configYaml && (
                      <pre className="mt-2 p-2 rounded bg-black/30 text-[10px] font-mono text-slate-300 overflow-x-auto whitespace-pre">{trainResult.configYaml}</pre>
                    )}
                  </>
                ) : (
                  <div><AlertCircle className="w-3 h-3 inline mr-1" />{trainResult.error}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground font-mono text-center">
          Training berjalan di <b className="text-violet-400">GPU HuggingFace</b> — 0% RAM lokal digunakan. Model hasil training otomatis tersimpan di HF Hub kamu.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Quick Create Wizard ───────────────────────────────────────────────────────
type QCStep = 1 | 2 | 3 | 4;

interface QCSample { input: string; output: string }

function QuickCreateWizard() {
  const queryClient = useQueryClient();
  const BASE = (window as Window & { _apiBase?: string })._apiBase || getApiBase();

  const { data: ollamaModels } = useOllamaModels();

  const createDataset = useCreateTrainingDataset();
  const registerModel = useRegisterModel();
  const addSample = useAddTrainingSample();
  const startJob = useStartTrainingJob();

  // Wizard step state
  const [step, setStep] = useState<QCStep>(1);

  // Step 1
  const [modelName, setModelName] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [taskType, setTaskType] = useState("instruction_following");

  // Step 2
  const [addMode, setAddMode] = useState<"manual" | "bulk">("manual");
  const [manualInput, setManualInput] = useState("");
  const [manualOutput, setManualOutput] = useState("");
  const [samples, setSamples] = useState<QCSample[]>([]);
  const [bulkText, setBulkText] = useState("");

  // Step 3
  const [backend, setBackend] = useState<"local_cpu" | "hf_api">("local_cpu");
  const [epochs, setEpochs] = useState(3);
  const [loraRank, setLoraRank] = useState(16);

  // Step 4 launch
  const [launching, setLaunching] = useState(false);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const [launchDone, setLaunchDone] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [launchError, setLaunchError] = useState("");

  // Parsed bulk samples
  const parsedBulk: QCSample[] = bulkText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|||"))
    .map((line) => {
      const idx = line.indexOf("|||");
      return { input: line.slice(0, idx).trim(), output: line.slice(idx + 3).trim() };
    })
    .filter((s) => s.input && s.output);

  const allSamples = addMode === "manual" ? samples : parsedBulk;

  const addManualSample = () => {
    if (!manualInput.trim() || !manualOutput.trim()) return;
    setSamples((prev) => [...prev, { input: manualInput.trim(), output: manualOutput.trim() }]);
    setManualInput("");
    setManualOutput("");
  };

  const removeSample = (i: number) => setSamples((prev) => prev.filter((_, idx) => idx !== i));

  const log = (msg: string) => setLaunchLog((prev) => [...prev, msg]);

  const handleLaunch = async () => {
    if (allSamples.length === 0) return;
    setLaunching(true);
    setLaunchError("");
    setLaunchLog([]);
    try {
      log("📁 Membuat dataset training...");
      const dsResult = await createDataset.mutateAsync({
        data: { name: `${modelName.trim()}_data`, description: `Dataset untuk ${modelName}`, taskType },
      });
      const dsId = (dsResult as { id: number }).id;
      log(`✅ Dataset dibuat (ID: ${dsId})`);

      log("🤖 Mendaftarkan model...");
      const mdResult = await registerModel.mutateAsync({
        data: {
          name: modelName.trim(),
          type: "llm",
          version: "v1.0",
          architecture: baseModel || "tinyllama",
          ollamaName: baseModel || "tinyllama",
          baseOllamaModel: baseModel || "tinyllama",
          description: `Model ${taskType} — dibuat via Quick Create`,
        },
      });
      const mdId = (mdResult as { id: number }).id;
      log(`✅ Model didaftarkan (ID: ${mdId})`);

      log(`📝 Menambahkan ${allSamples.length} sampel data...`);
      for (let i = 0; i < allSamples.length; i++) {
        const s = allSamples[i];
        await addSample.mutateAsync({ id: dsId, data: { input: s.input, output: s.output } });
        if ((i + 1) % 5 === 0 || i === allSamples.length - 1) {
          log(`  → ${i + 1}/${allSamples.length} sampel ditambahkan`);
        }
      }

      log("🚀 Memulai proses fine-tuning LoRA...");
      const jobResult = await startJob.mutateAsync({
        data: {
          modelId: mdId,
          datasetId: dsId,
          epochs,
          trainingBackend: backend,
          loraRank,
          learningRate: 0.0002,
          batchSize: 2,
          maxSeqLength: 512,
        },
      });
      const jId = (jobResult as { id: number }).id;
      setJobId(jId);
      log(`✅ Training job dimulai (ID: ${jId})`);

      queryClient.invalidateQueries({ queryKey: getListTrainingJobsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListTrainingDatasetsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListModelsQueryKey() });

      // Poll progress
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`${BASE}/api/training-jobs/${jId}`);
          const job = await r.json() as { status: string; progress: number };
          setJobProgress(Math.round((job.progress ?? 0) * 100));
          setJobStatus(job.status);
          if (job.status === "completed" || job.status === "failed") {
            clearInterval(poll);
            setLaunchDone(true);
            log(job.status === "completed" ? "🎉 Training selesai! Model siap digunakan." : `❌ Training gagal.`);
          }
        } catch { /* ignore poll errors */ }
      }, 2500);
    } catch (e) {
      setLaunchError(String(e));
      log(`❌ Error: ${String(e)}`);
    } finally {
      setLaunching(false);
    }
  };

  const estimatedMinutes = Math.round(allSamples.length * epochs * 0.15);

  const taskOptions = [
    { value: "instruction_following", label: "Ikuti Instruksi" },
    { value: "chat", label: "Percakapan / Chat" },
    { value: "code_generation", label: "Generate Kode" },
    { value: "qa", label: "Tanya Jawab (Q&A)" },
    { value: "summarization", label: "Ringkasan Teks" },
    { value: "reasoning", label: "Penalaran / Reasoning" },
  ];

  const step1Valid = modelName.trim().length >= 2 && (baseModel || true);
  const step2Valid = allSamples.length >= 1;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {([
          { n: 1, label: "Model" },
          { n: 2, label: "Data" },
          { n: 3, label: "Konfigurasi" },
          { n: 4, label: "Launch" },
        ] as const).map((s, idx) => (
          <React.Fragment key={s.n}>
            <div className="flex flex-col items-center gap-1 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                step === s.n ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                : step > s.n ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {step > s.n ? <CheckCircle2 className="w-4 h-4" /> : s.n}
              </div>
              <span className={`text-[10px] font-mono ${step === s.n ? "text-primary" : "text-muted-foreground"}`}>{s.label}</span>
            </div>
            {idx < 3 && <div className={`h-0.5 flex-1 mb-5 transition-all ${step > s.n ? "bg-primary/50" : "bg-border"}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* ── STEP 1: Model Info ─────────────────────────────────────────── */}
      {step === 1 && (
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="w-4 h-4 text-primary" /> Nama & Base Model
            </CardTitle>
            <p className="text-xs text-muted-foreground">Beri nama modelmu dan pilih model dasar yang akan dilatih ulang.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Model AI</label>
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="Contoh: Asisten Toko Online, DLavie Chat Bot..."
                className="bg-background"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Model Dasar</label>
              <Select value={baseModel} onValueChange={setBaseModel}>
                <SelectTrigger className="bg-background font-mono text-sm">
                  <SelectValue placeholder="Pilih model yang sudah ter-install..." />
                </SelectTrigger>
                <SelectContent>
                  {ollamaModels && ollamaModels.length > 0 ? (
                    ollamaModels.map((m) => (
                      <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="tinyllama">tinyllama (default — selalu tersedia)</SelectItem>
                  )}
                  <SelectItem value="tinyllama">tinyllama (1B, cepat)</SelectItem>
                  <SelectItem value="qwen2.5:1.5b">qwen2.5:1.5b (1.5B, bagus)</SelectItem>
                  <SelectItem value="qwen2.5:3b">qwen2.5:3b (3B, lebih pintar)</SelectItem>
                  <SelectItem value="llama3.2:3b">llama3.2:3b (3B, Meta)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Tidak ada di daftar? Download dulu dari tab <b>Catalogue</b>, lalu kembali ke sini.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tujuan / Task</label>
              <div className="grid grid-cols-2 gap-2">
                {taskOptions.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTaskType(t.value)}
                    className={`p-2.5 rounded-lg border text-left text-sm transition-all ${
                      taskType === t.value
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={() => setStep(2)} disabled={!step1Valid} className="w-full gap-2">
              Selanjutnya <ChevronRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Data Training ──────────────────────────────────────── */}
      {step === 2 && (
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4 text-primary" /> Data Training
            </CardTitle>
            <p className="text-xs text-muted-foreground">Masukkan contoh pertanyaan &amp; jawaban. Minimal 1 pasang, makin banyak makin pintar.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-1 p-1 rounded-lg bg-muted">
              {(["manual", "bulk"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAddMode(m)}
                  className={`flex-1 py-1.5 rounded text-sm font-medium transition-all ${
                    addMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {m === "manual" ? "✍️ Manual" : "📋 Tempel Massal"}
                </button>
              ))}
            </div>

            {addMode === "manual" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Pertanyaan / Input</label>
                  <textarea
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    rows={3}
                    placeholder="Contoh: Apa itu machine learning?"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Jawaban / Output</label>
                  <textarea
                    value={manualOutput}
                    onChange={(e) => setManualOutput(e.target.value)}
                    rows={3}
                    placeholder="Contoh: Machine learning adalah cabang AI yang membuat komputer belajar dari data tanpa diprogram secara eksplisit."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addManualSample}
                  disabled={!manualInput.trim() || !manualOutput.trim()}
                  className="w-full gap-2"
                >
                  <Plus className="w-4 h-4" /> Tambah Pasangan Data
                </Button>
                {samples.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    <p className="text-xs text-muted-foreground font-medium">{samples.length} pasang data ditambahkan:</p>
                    {samples.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 p-2.5 rounded border border-border bg-background/50 text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="text-muted-foreground truncate">Q: {s.input}</p>
                          <p className="text-foreground truncate">A: {s.output}</p>
                        </div>
                        <button onClick={() => removeSample(i)} className="text-muted-foreground hover:text-destructive shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tempel data (format: input|||output per baris)</label>
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    rows={10}
                    placeholder={"Apa itu AI?|||AI adalah kecerdasan buatan yang dibuat oleh manusia.\nBagaimana cara kerja neural network?|||Neural network terdiri dari lapisan-lapisan neuron buatan yang saling terhubung..."}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {parsedBulk.length > 0 && (
                  <div className="flex items-center gap-2 p-2.5 rounded border border-primary/30 bg-primary/5 text-sm text-primary">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {parsedBulk.length} pasang data berhasil dikenali
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                <ChevronRight className="w-4 h-4 rotate-180" /> Kembali
              </Button>
              <Button onClick={() => setStep(3)} disabled={!step2Valid} className="flex-1 gap-2">
                Selanjutnya ({allSamples.length} data) <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: Konfigurasi ────────────────────────────────────────── */}
      {step === 3 && (
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="w-4 h-4 text-primary" /> Konfigurasi Training
            </CardTitle>
            <p className="text-xs text-muted-foreground">Semua nilai sudah diset optimal. Ubah hanya jika perlu.</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Backend */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Metode Training</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "local_cpu", icon: "🖥️", title: "Local CPU", desc: "Gratis, lebih lambat. Cocok untuk dataset kecil." },
                  { value: "hf_api", icon: "🤗", title: "HuggingFace GPU", desc: "Butuh HF_TOKEN. Jauh lebih cepat." },
                ] as const).map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => setBackend(b.value)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      backend === b.value
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:border-primary/40"
                    }`}
                  >
                    <div className="text-base mb-1">{b.icon} <span className="text-sm font-medium">{b.title}</span></div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed">{b.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Epochs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Jumlah Epoch</label>
                <span className="text-sm font-mono text-primary font-bold">{epochs}</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>1 (cepat)</span>
                <span>5 (seimbang)</span>
                <span>10 (maksimal)</span>
              </div>
            </div>

            {/* LoRA Rank */}
            <div className="space-y-2">
              <label className="text-sm font-medium">LoRA Rank</label>
              <div className="grid grid-cols-4 gap-2">
                {([4, 8, 16, 32] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setLoraRank(r)}
                    className={`py-2 rounded border text-sm font-mono transition-all ${
                      loraRank === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    r={r}
                    {r === 4 && <div className="text-[9px] opacity-60">cepat</div>}
                    {r === 16 && <div className="text-[9px] opacity-60">default</div>}
                    {r === 32 && <div className="text-[9px] opacity-60">detail</div>}
                  </button>
                ))}
              </div>
            </div>

            {/* Estimate */}
            <div className="p-3 rounded border border-border bg-background/50 text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between"><span>Jumlah data</span><span className="text-foreground font-mono">{allSamples.length} pasang</span></div>
              <div className="flex justify-between"><span>Epoch</span><span className="text-foreground font-mono">{epochs}×</span></div>
              <div className="flex justify-between"><span>Estimasi waktu</span><span className="text-primary font-mono">~{estimatedMinutes < 1 ? "< 1" : estimatedMinutes} menit</span></div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                <ChevronRight className="w-4 h-4 rotate-180" /> Kembali
              </Button>
              <Button onClick={() => setStep(4)} className="flex-1 gap-2">
                Lanjut ke Review <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 4: Launch ─────────────────────────────────────────────── */}
      {step === 4 && (
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4 text-primary" /> Review & Launch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Summary */}
            {!launching && !launchLog.length && (
              <div className="space-y-2 p-4 rounded-lg border border-border bg-background/50">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Ringkasan</p>
                {[
                  { label: "Nama Model", value: modelName },
                  { label: "Base Model", value: baseModel || "tinyllama" },
                  { label: "Task", value: taskOptions.find((t) => t.value === taskType)?.label || taskType },
                  { label: "Jumlah Data", value: `${allSamples.length} pasang` },
                  { label: "Training", value: backend === "local_cpu" ? "Local CPU" : "HuggingFace GPU" },
                  { label: "Epoch", value: `${epochs}× (LoRA r=${loraRank})` },
                  { label: "Estimasi Waktu", value: `~${estimatedMinutes < 1 ? "< 1" : estimatedMinutes} menit` },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium text-foreground">{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Launch log */}
            {launchLog.length > 0 && (
              <div className="space-y-1.5 p-3 rounded-lg border border-border bg-background/80 font-mono text-xs max-h-52 overflow-y-auto">
                {launchLog.map((l, i) => (
                  <div key={i} className={l.startsWith("❌") ? "text-destructive" : l.startsWith("🎉") ? "text-green-400" : "text-foreground"}>{l}</div>
                ))}
                {launching && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Memproses...</div>}
              </div>
            )}

            {/* Job progress bar */}
            {jobId && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="font-mono">JOB_{String(jobId).padStart(4, "0")}</span>
                  <span className={`capitalize font-mono ${jobStatus === "completed" ? "text-green-400" : jobStatus === "failed" ? "text-destructive" : "text-primary"}`}>{jobStatus}</span>
                </div>
                <Progress value={jobProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">{jobProgress}%</p>
              </div>
            )}

            {launchError && (
              <div className="p-3 rounded border border-destructive/30 bg-destructive/5 text-destructive text-xs font-mono">{launchError}</div>
            )}

            {launchDone && jobStatus === "completed" && (
              <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto" />
                <p className="text-green-400 font-medium">Model <b>{modelName}</b> berhasil dilatih!</p>
                <p className="text-xs text-muted-foreground">Lihat di tab Advanced → Model Registry untuk menggunakannya.</p>
              </div>
            )}

            <div className="flex gap-3">
              {!launchLog.length && (
                <Button variant="outline" onClick={() => setStep(3)} className="gap-2">
                  <ChevronRight className="w-4 h-4 rotate-180" /> Kembali
                </Button>
              )}
              {!launchDone && (
                <Button
                  onClick={handleLaunch}
                  disabled={launching || launchLog.length > 0}
                  className="flex-1 gap-2"
                >
                  {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {launchLog.length > 0 ? "Sedang Berjalan..." : "🚀 Mulai Training Sekarang"}
                </Button>
              )}
              {launchDone && (
                <Button variant="outline" onClick={() => {
                  setStep(1); setModelName(""); setBaseModel(""); setSamples([]); setBulkText("");
                  setLaunchLog([]); setLaunchDone(false); setJobId(null); setJobProgress(0); setJobStatus(""); setLaunchError("");
                }} className="w-full gap-2">
                  <Plus className="w-4 h-4" /> Buat Model Lagi
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main Training Hub Page ───────────────────────────────────────────────────
export default function Training() {
  const queryClient = useQueryClient();

  const { data: datasets, isLoading: datasetsLoading } = useListTrainingDatasets();
  const { data: jobs, isLoading: jobsLoading } = useListTrainingJobs({
    query: { refetchInterval: 3000 },
  });
  const { data: models } = useListModels();
  const { data: ollamaModels, isLoading: ollamaLoading, refetch: refetchOllama } = useOllamaModels();

  // Dialogs
  const [createDatasetOpen, setCreateDatasetOpen] = useState(false);
  const [dsName, setDsName] = useState("");
  const [dsDesc, setDsDesc] = useState("");
  const [dsTaskType, setDsTaskType] = useState("instruction_following");

  const [startJobOpen, setStartJobOpen] = useState(false);
  const [jobModelId, setJobModelId] = useState("");
  const [jobDatasetId, setJobDatasetId] = useState("");
  const [jobEpochs, setJobEpochs] = useState("3");
  const [jobBackend, setJobBackend] = useState<"hf_api" | "local_cpu">("local_cpu");
  const [jobLoraRank, setJobLoraRank] = useState("16");
  const [jobLearningRate, setJobLearningRate] = useState("0.0002");
  const [jobBatchSize, setJobBatchSize] = useState("2");
  const [jobMaxSeq, setJobMaxSeq] = useState("512");
  const [autoConfigInfo, setAutoConfigInfo] = useState<{ family: string; notes: string; chatTemplate: string } | null>(null);

  const [registerModelOpen, setRegisterModelOpen] = useState(false);
  const [rmName, setRmName] = useState("");
  const [rmType, setRmType] = useState<"llm"|"embedding"|"classification"|"summarization"|"custom">("llm");
  const [rmVersion, setRmVersion] = useState("v1.0");
  const [rmArch, setRmArch] = useState("tinyllama");
  const [rmDesc, setRmDesc] = useState("");

  const [addSampleOpen, setAddSampleOpen] = useState(false);
  const [addSampleDatasetId, setAddSampleDatasetId] = useState<number | null>(null);
  const [sampleInput, setSampleInput] = useState("");
  const [sampleOutput, setSampleOutput] = useState("");

  const [modelFilter, setModelFilter] = useState<string>("all");
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [cliOpen, setCliOpen] = useState(true);
  const [mainTab, setMainTab] = useState<"quick" | "advanced">("quick");

  // New feature state
  const [qualityReport, setQualityReport] = useState<{ datasetId: number; datasetName: string; report: QualityReport } | null>(null);
  const [importUrlDialogDatasetId, setImportUrlDialogDatasetId] = useState<number | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importUrlLoading, setImportUrlLoading] = useState(false);
  const [importUrlResult, setImportUrlResult] = useState<{ added: number; skipped: number } | null>(null);
  const [benchmarkModel, setBenchmarkModel] = useState<string | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  // Mutations
  const createDatasetMutation = useCreateTrainingDataset({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTrainingDatasetsQueryKey() });
        setCreateDatasetOpen(false);
        setDsName(""); setDsDesc("");
      },
    },
  });

  const startJobMutation = useStartTrainingJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTrainingJobsQueryKey() });
        setStartJobOpen(false);
      },
    },
  });

  const registerModelMutation = useRegisterModel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListModelsQueryKey() });
        setRegisterModelOpen(false);
        setRmName(""); setRmDesc("");
      },
    },
  });

  const addSampleMutation = useAddTrainingSample({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTrainingDatasetsQueryKey() });
        setAddSampleOpen(false);
        setSampleInput(""); setSampleOutput("");
      },
    },
  });

  const handleCreateDataset = (e: React.FormEvent) => {
    e.preventDefault();
    createDatasetMutation.mutate({ data: { name: dsName, description: dsDesc || undefined, taskType: dsTaskType } });
  };

  const handleStartJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobModelId || !jobDatasetId) return;
    startJobMutation.mutate({
      data: {
        modelId: Number(jobModelId),
        datasetId: Number(jobDatasetId),
        epochs: Number(jobEpochs) || 3,
        trainingBackend: jobBackend,
        loraRank: Number(jobLoraRank) || 16,
        learningRate: parseFloat(jobLearningRate) || 0.0002,
        batchSize: Number(jobBatchSize) || 2,
        maxSeqLength: Number(jobMaxSeq) || 512,
      },
    });
  };

  const handleModelSelectForJob = async (modelId: string) => {
    setJobModelId(modelId);
    const model = models?.find((m) => m.id === Number(modelId));
    if (!model) return;
    const ollamaName = model.ollamaName || model.architecture || model.name;
    try {
      const res = await fetch(`${BASE}/api/training-datasets/1/auto-config?modelName=${encodeURIComponent(ollamaName)}`);
      const cfg = await res.json() as { modelFamily: string; notes: string; chatTemplate: string };
      setAutoConfigInfo({ family: cfg.modelFamily, notes: cfg.notes, chatTemplate: cfg.chatTemplate });
    } catch { setAutoConfigInfo(null); }
  };

  const handleRegisterModel = (e: React.FormEvent) => {
    e.preventDefault();
    registerModelMutation.mutate({
      data: {
        name: rmName,
        type: rmType,
        version: rmVersion,
        architecture: rmArch || undefined,
        description: rmDesc || undefined,
        ollamaName: rmArch || undefined,
        baseOllamaModel: rmArch || undefined,
      },
    });
  };

  const handleAddSample = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addSampleDatasetId || !sampleInput || !sampleOutput) return;
    addSampleMutation.mutate({
      id: addSampleDatasetId,
      data: { input: sampleInput, output: sampleOutput },
    });
  };

  const handleDeleteOllamaModel = async (name: string) => {
    await fetch(`${BASE}/api/ollama-models/${encodeURIComponent(name)}`, { method: "DELETE" });
    refetchOllama();
  };

  const handleCancelJob = async (jobId: number) => {
    await fetch(`${BASE}/api/training-jobs/${jobId}/cancel`, { method: "POST" });
    queryClient.invalidateQueries({ queryKey: getListTrainingJobsQueryKey() });
  };

  const BASE = (window as Window & { _apiBase?: string })._apiBase || getApiBase();

  const activeJobs = jobs?.filter((j) => j.status === "running" || j.status === "pending") || [];
  const completedJobs = jobs?.filter((j) => j.status === "completed" || j.status === "failed") || [];

  const installedNames = (ollamaModels || []).map((m) => m.name);

  const filteredCatalogue = MODEL_CATALOGUE.filter((m) => {
    const matchesFilter = modelFilter === "all" || m.tag === modelFilter;
    const matchesSearch = !catalogueSearch || m.name.includes(catalogueSearch.toLowerCase()) || m.desc.toLowerCase().includes(catalogueSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-sans tracking-tight mb-1">Training Hub</h1>
          <p className="text-muted-foreground font-mono text-sm">
            Fine-tuning pipelines · Model registry · Ollama CLI · Model catalogue
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={registerModelOpen} onOpenChange={setRegisterModelOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 font-mono text-xs">
                <Plus className="w-3.5 h-3.5" /> REGISTER_MODEL
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card">
              <DialogHeader><DialogTitle>Register AI Model</DialogTitle></DialogHeader>
              <form onSubmit={handleRegisterModel} className="space-y-4 pt-3">
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">MODEL_NAME</label>
                  <Input value={rmName} onChange={(e) => setRmName(e.target.value)} required className="font-mono text-sm bg-background" placeholder="e.g. MyModel-v1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-muted-foreground">TYPE</label>
                    <Select value={rmType} onValueChange={(v) => setRmType(v as typeof rmType)}>
                      <SelectTrigger className="font-mono text-sm bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["llm","embedding","classification","summarization","custom"].map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-muted-foreground">VERSION</label>
                    <Input value={rmVersion} onChange={(e) => setRmVersion(e.target.value)} className="font-mono text-sm bg-background" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">BASE_ARCH (Ollama model name)</label>
                  <Input value={rmArch} onChange={(e) => setRmArch(e.target.value)} className="font-mono text-sm bg-background" placeholder="tinyllama, qwen2.5:1.5b, ..." />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">DESCRIPTION</label>
                  <Input value={rmDesc} onChange={(e) => setRmDesc(e.target.value)} className="font-mono text-sm bg-background" />
                </div>
                <Button type="submit" className="w-full" disabled={registerModelMutation.isPending || !rmName}>
                  {registerModelMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Register Model
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={startJobOpen} onOpenChange={(v) => { setStartJobOpen(v); if (!v) setAutoConfigInfo(null); }}>
            <DialogTrigger asChild>
              <Button className="gap-2 font-mono" variant="default">
                <Play className="w-4 h-4" /> START_JOB
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card max-w-lg">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> Real LoRA Fine-Tuning</DialogTitle></DialogHeader>
              <form onSubmit={handleStartJob} className="space-y-4 pt-2">
                {/* Model selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">BASE_MODEL</label>
                  <Select value={jobModelId} onValueChange={handleModelSelectForJob}>
                    <SelectTrigger className="font-mono text-sm bg-background"><SelectValue placeholder="Select registered model" /></SelectTrigger>
                    <SelectContent>
                      {models?.map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.name} · {m.ollamaName || m.architecture || "—"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {autoConfigInfo && (
                    <div className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-1.5 rounded border border-cyan-500/20 leading-relaxed">
                      <span className="text-cyan-300 font-bold">Family: {autoConfigInfo.family}</span> · Template: {autoConfigInfo.chatTemplate}<br />
                      {autoConfigInfo.notes}
                    </div>
                  )}
                </div>

                {/* Dataset selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">DATASET</label>
                  <Select value={jobDatasetId} onValueChange={setJobDatasetId}>
                    <SelectTrigger className="font-mono text-sm bg-background"><SelectValue placeholder="Select dataset" /></SelectTrigger>
                    <SelectContent>
                      {datasets?.map((d) => (
                        <SelectItem key={d.id} value={d.id.toString()}>
                          {d.name} · {d.sampleCount} samples · {d.taskType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Backend selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">TRAINING_BACKEND</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "local_cpu", label: "Local CPU", icon: "🖥️", desc: "Real LoRA, CPU (slower)" },
                      { value: "hf_api", label: "HF API", icon: "🤗", desc: "HuggingFace libs + local" },
                    ] as const).map((b) => (
                      <button
                        key={b.value}
                        type="button"
                        onClick={() => setJobBackend(b.value)}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          jobBackend === b.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <div className="text-sm font-mono">{b.icon} {b.label}</div>
                        <div className="text-[10px] mt-0.5 opacity-70">{b.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* LoRA hyperparameters */}
                <div className="p-3 rounded-lg border border-border bg-accent/20 space-y-3">
                  <div className="text-xs font-mono text-muted-foreground font-semibold">LORA_HYPERPARAMETERS</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-muted-foreground">EPOCHS</label>
                      <Input type="number" min="1" max="20" value={jobEpochs} onChange={(e) => setJobEpochs(e.target.value)} className="font-mono text-sm bg-background h-8" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-muted-foreground">LORA_RANK (r)</label>
                      <Select value={jobLoraRank} onValueChange={setJobLoraRank}>
                        <SelectTrigger className="font-mono text-sm bg-background h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["4","8","16","32","64"].map((r) => (
                            <SelectItem key={r} value={r}>r={r}{r === "16" ? " (default)" : r === "4" ? " (fast)" : r === "64" ? " (detailed)" : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-muted-foreground">LEARNING_RATE</label>
                      <Select value={jobLearningRate} onValueChange={setJobLearningRate}>
                        <SelectTrigger className="font-mono text-sm bg-background h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[["0.0001","1e-4 (conservative)"],["0.0002","2e-4 (default)"],["0.0005","5e-4 (aggressive)"],["0.001","1e-3 (fast)"]].map(([v, l]) => (
                            <SelectItem key={v} value={v}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-muted-foreground">BATCH_SIZE</label>
                      <Select value={jobBatchSize} onValueChange={setJobBatchSize}>
                        <SelectTrigger className="font-mono text-sm bg-background h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[["1","1 (memory safe)"],["2","2 (default)"],["4","4 (faster)"],["8","8 (GPU)"]].map(([v, l]) => (
                            <SelectItem key={v} value={v}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground font-mono bg-primary/5 px-3 py-2 rounded border border-primary/20">
                  ⚡ <span className="text-primary">Real LoRA fine-tuning</span> — actual gradient descent using PEFT + transformers.
                  Saves adapter weights to disk + registers in Ollama.
                </div>

                <Button type="submit" className="w-full gap-2" disabled={startJobMutation.isPending || !jobModelId || !jobDatasetId}>
                  {startJobMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Launch Real Fine-Tuning
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Tab Navigation ───────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border w-fit">
        {([
          { id: "quick", label: "⚡ Quick Create", desc: "Wizard 4 langkah" },
          { id: "advanced", label: "🔬 Advanced", desc: "Semua fitur lengkap" },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setMainTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex flex-col items-start gap-0.5 ${
              mainTab === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{t.label}</span>
            <span className="text-[10px] font-mono opacity-60">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* ── Quick Create Wizard ───────────────────────────────────────────── */}
      {mainTab === "quick" && <QuickCreateWizard />}

      {/* ── Advanced: Live Auto-Training Engine ──────────────────────────── */}
      {mainTab === "advanced" && <AutoTrainingPanel />}

      {/* ── Advanced: Main grid ──────────────────────────────────────────── */}
      {mainTab === "advanced" && <div className="space-y-6">
      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left column */}
        <div className="xl:col-span-2 space-y-6">

          {/* Active Jobs */}
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="w-4 h-4 text-primary" />
                Active Pipelines
                {activeJobs.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-mono bg-primary/20 text-primary">
                    {activeJobs.length} running
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {jobsLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : jobs?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg bg-background/50">
                  No training jobs yet — click START_JOB above
                </div>
              ) : (
                <div className="space-y-3">
                  {[...activeJobs, ...completedJobs].map((job) => {
                    const lossPoints: Array<{ step: number; loss: number }> = (() => {
                      try { return job.lossHistory ? JSON.parse(job.lossHistory) : []; } catch { return []; }
                    })();
                    const maxLoss = lossPoints.length > 0 ? Math.max(...lossPoints.map((p) => p.loss)) : 1;
                    const minLoss = lossPoints.length > 0 ? Math.min(...lossPoints.map((p) => p.loss)) : 0;
                    const lossRange = maxLoss - minLoss || 1;
                    return (
                    <div key={job.id} className="p-4 rounded-lg border border-border bg-background space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {job.status === "running" ? (
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                          ) : job.status === "completed" ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : job.status === "failed" ? (
                            <AlertCircle className="w-5 h-5 text-destructive" />
                          ) : (
                            <Play className="w-5 h-5 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-mono text-sm font-medium flex items-center gap-2">
                              JOB_{job.id.toString().padStart(4, "0")}
                              {job.trainingBackend && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                  job.trainingBackend === "hf_api" ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400"
                                }`}>
                                  {job.trainingBackend === "hf_api" ? "🤗 HF" : "🖥️ LoRA"}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Model #{job.modelId} · Dataset #{job.datasetId} · {job.epochs} ep
                              {job.loraRank ? ` · r=${job.loraRank}` : ""}
                              {job.learningRate ? ` · lr=${job.learningRate}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono px-2 py-1 rounded uppercase ${
                            job.status === "running" ? "bg-primary/20 text-primary"
                            : job.status === "completed" ? "bg-green-500/20 text-green-500"
                            : job.status === "failed" ? "bg-destructive/20 text-destructive"
                            : "bg-muted text-muted-foreground"
                          }`}>{job.status}</span>
                          {(job.status === "running" || job.status === "pending") && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleCancelJob(job.id)}>
                              <Square className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {job.status === "failed" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                              title="Retry this job"
                              onClick={async () => {
                                await fetch(`${BASE}/api/training-jobs/${job.id}/retry`, { method: "POST" });
                                queryClient.invalidateQueries({ queryKey: getListTrainingJobsQueryKey() });
                              }}>
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {job.status === "running" && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs font-mono">
                            <span>Epoch {job.currentEpoch}/{job.epochs}</span>
                            <span>{Math.round((job.progress || 0) * 100)}%</span>
                          </div>
                          <Progress value={(job.progress || 0) * 100} className="h-1.5 bg-accent" />
                        </div>
                      )}
                      {/* Loss sparkline */}
                      {lossPoints.length > 2 && (
                        <div className="flex items-end gap-px h-10 px-1 bg-accent/10 rounded border border-border/50">
                          {lossPoints.slice(-60).map((p, i) => {
                            const heightPct = ((p.loss - minLoss) / lossRange);
                            const barH = Math.max(2, Math.round(heightPct * 36));
                            return (
                              <div
                                key={i}
                                title={`step ${p.step}: loss=${p.loss.toFixed(4)}`}
                                className="flex-1 min-w-0 rounded-t-sm bg-primary/70 hover:bg-primary transition-colors cursor-default"
                                style={{ height: `${barH}px`, alignSelf: "flex-end" }}
                              />
                            );
                          })}
                        </div>
                      )}
                      <div className="flex gap-4 flex-wrap text-xs font-mono text-muted-foreground border-t border-border pt-2">
                        <span className="text-green-400">Loss: {job.loss?.toFixed(4) || "—"}</span>
                        <span className="text-blue-400">Acc: {job.accuracy ? `${(job.accuracy * 100).toFixed(1)}%` : "—"}</span>
                        {job.outputModelPath && <span className="text-primary">✓ adapter saved</span>}
                        {job.error && <span className="text-destructive truncate max-w-48">⚠ {job.error}</span>}
                        <span className="ml-auto">{job.startedAt ? format(new Date(job.startedAt), "HH:mm:ss") : "—"}</span>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── CLI Terminal ────────────────────────────────────────────────── */}
          <Card className="glass-panel border-primary/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Terminal className="w-4 h-4 text-primary" />
                  Ollama CLI Terminal
                  <span className="text-xs font-mono text-muted-foreground font-normal ml-1">
                    — install & manage models
                  </span>
                </CardTitle>
                <Button
                  variant="ghost" size="sm"
                  className="text-muted-foreground h-7 px-2 font-mono text-xs"
                  onClick={() => setCliOpen(!cliOpen)}
                >
                  {cliOpen ? "collapse" : "expand"}
                </Button>
              </div>
            </CardHeader>
            {cliOpen && (
              <CardContent className="pt-0">
                <CliTerminal
                  installedModels={installedNames}
                  onModelsChanged={() => refetchOllama()}
                />
                <p className="text-[10px] text-muted-foreground font-mono mt-2">
                  Try: <span className="text-primary">pull qwen2.5:1.5b</span> · <span className="text-primary">list</span> · <span className="text-primary">rm tinyllama:latest</span> · Tab to autocomplete
                </p>
              </CardContent>
            )}
          </Card>

          {/* Datasets */}
          <Card className="glass-panel">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="w-4 h-4 text-primary" />
                  Training Datasets
                </CardTitle>
                <Dialog open={createDatasetOpen} onOpenChange={setCreateDatasetOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 font-mono text-xs h-7">
                      <Plus className="w-3 h-3" /> New Dataset
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="border-border bg-card">
                    <DialogHeader><DialogTitle>Create Training Dataset</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreateDataset} className="space-y-4 pt-3">
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-muted-foreground">DATASET_NAME</label>
                        <Input value={dsName} onChange={(e) => setDsName(e.target.value)} required className="font-mono text-sm bg-background" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-muted-foreground">DESCRIPTION</label>
                        <Input value={dsDesc} onChange={(e) => setDsDesc(e.target.value)} className="font-mono text-sm bg-background" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-mono text-muted-foreground">TASK_TYPE</label>
                        <Select value={dsTaskType} onValueChange={setDsTaskType}>
                          <SelectTrigger className="font-mono text-sm bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">General</div>
                            {[
                              ["instruction_following","📋 Instruction Following"],
                              ["chat","💬 Chat / Dialogue"],
                              ["multilingual","🌐 Multilingual"],
                            ].map(([v, l]) => <SelectItem key={v} value={v} className="font-mono text-xs">{l}</SelectItem>)}
                            <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider border-t border-border mt-1 pt-2">Code</div>
                            {[
                              ["code_generation","💻 Code Generation"],
                              ["code_review","🔍 Code Review"],
                              ["text_to_sql","🗄️ Text-to-SQL"],
                            ].map(([v, l]) => <SelectItem key={v} value={v} className="font-mono text-xs">{l}</SelectItem>)}
                            <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider border-t border-border mt-1 pt-2">Reasoning</div>
                            {[
                              ["reasoning","🧠 Reasoning"],
                              ["math","➗ Math / STEM"],
                              ["chain_of_thought","🔗 Chain of Thought"],
                            ].map(([v, l]) => <SelectItem key={v} value={v} className="font-mono text-xs">{l}</SelectItem>)}
                            <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider border-t border-border mt-1 pt-2">NLP Tasks</div>
                            {[
                              ["ner","🏷️ Named Entity Recognition"],
                              ["sentiment","❤️ Sentiment Analysis"],
                              ["data_extraction","📤 Data Extraction"],
                            ].map(([v, l]) => <SelectItem key={v} value={v} className="font-mono text-xs">{l}</SelectItem>)}
                            <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider border-t border-border mt-1 pt-2">Creative / Agentic</div>
                            {[
                              ["creative_writing","✍️ Creative Writing"],
                              ["question_generation","❓ Question Generation"],
                              ["function_calling","⚙️ Function Calling"],
                            ].map(([v, l]) => <SelectItem key={v} value={v} className="font-mono text-xs">{l}</SelectItem>)}
                            <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider border-t border-border mt-1 pt-2">Classic</div>
                            {[
                              ["classification","📊 Classification"],
                              ["generation","🪄 Generation"],
                              ["summarization","📝 Summarization"],
                              ["qa","❓ Q&A"],
                              ["translation","🌍 Translation"],
                            ].map(([v, l]) => <SelectItem key={v} value={v} className="font-mono text-xs">{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="submit" className="w-full" disabled={createDatasetMutation.isPending || !dsName}>
                        {createDatasetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Create Dataset
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {datasetsLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : !datasets?.length ? (
                <p className="text-sm text-muted-foreground font-mono text-center py-6 border border-dashed border-border rounded-lg">No datasets yet</p>
              ) : (
                <div className="space-y-2">
                  {datasets.map((ds) => (
                    <div key={ds.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:border-primary/40 transition-colors">
                      <div>
                        <p className="text-sm font-medium">{ds.name}</p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {ds.taskType} · {ds.sampleCount} samples
                          {ds.sampleCount === 0 && (
                            <span className="ml-2 text-yellow-500">⚠ Add samples before training</span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        <Button
                          variant="ghost" size="sm"
                          className="gap-1 font-mono text-xs h-7 text-muted-foreground hover:text-primary"
                          title="Download as JSONL (OpenAI fine-tuning format)"
                          onClick={() => window.open(`${BASE}/api/training-datasets/${ds.id}/export`, "_blank")}
                          disabled={ds.sampleCount === 0}
                        >
                          <Download className="w-3 h-3" /> JSONL
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="gap-1 font-mono text-xs h-7 text-muted-foreground hover:text-amber-400"
                          title="Quality report"
                          disabled={ds.sampleCount === 0}
                          onClick={async () => {
                            const r = await fetch(`${BASE}/api/training-datasets/${ds.id}/quality`);
                            if (r.ok) {
                              const data = await r.json() as QualityReport;
                              setQualityReport({ datasetId: ds.id, datasetName: ds.name, report: data });
                            }
                          }}
                        >
                          <BarChart2 className="w-3 h-3" /> Quality
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="gap-1 font-mono text-xs h-7 text-muted-foreground hover:text-orange-400"
                          title="Clean low-quality samples"
                          disabled={ds.sampleCount === 0}
                          onClick={async () => {
                            if (!confirm(`Clean low-quality samples from "${ds.name}"?`)) return;
                            const r = await fetch(`${BASE}/api/training-datasets/${ds.id}/clean`, { method: "POST" });
                            if (r.ok) {
                              const d = await r.json() as { removed: number };
                              alert(`Removed ${d.removed} low-quality samples.`);
                              queryClient.invalidateQueries({ queryKey: getListTrainingDatasetsQueryKey() });
                            }
                          }}
                        >
                          <Eraser className="w-3 h-3" /> Clean
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="gap-1 font-mono text-xs h-7 text-muted-foreground hover:text-cyan-400"
                          title="Import samples from a URL"
                          onClick={() => setImportUrlDialogDatasetId(ds.id)}
                        >
                          <Link className="w-3 h-3" /> Import URL
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete dataset"
                          onClick={async () => {
                            if (!confirm(`Delete dataset "${ds.name}"? This also deletes all its samples.`)) return;
                            await fetch(`${BASE}/api/training-datasets/${ds.id}`, { method: "DELETE" });
                            queryClient.invalidateQueries({ queryKey: getListTrainingDatasetsQueryKey() });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="gap-1 font-mono text-xs h-7"
                          onClick={() => { setAddSampleDatasetId(ds.id); setAddSampleOpen(true); }}
                        >
                          <Plus className="w-3 h-3" /> Sample
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Installed Ollama Models */}
          <Card className="glass-panel border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="w-4 h-4 text-primary" />
                Installed Models
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                onClick={() => refetchOllama()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              {ollamaLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : !ollamaModels?.length ? (
                <p className="text-xs text-muted-foreground font-mono text-center py-4">No models installed<br/>Pull one from the catalogue</p>
              ) : (
                <div className="space-y-2">
                  {ollamaModels.map((m) => (
                    <div key={m.name} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {m.parameterSize} · {m.quantization} · {formatBytes(m.size)}
                        </p>
                        <span className="text-[10px] font-mono text-green-500">● READY</span>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm"
                          className="h-7 px-2 text-xs font-mono text-muted-foreground hover:text-blue-400"
                          title="Run benchmark on this model"
                          onClick={() => { setBenchmarkModel(m.name); setBenchmarkResult(null); }}
                        >
                          <Gauge className="w-3.5 h-3.5 mr-1" /> Bench
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteOllamaModel(m.name)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Model Registry */}
          <Card className="glass-panel">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="w-4 h-4 text-primary" />
                Model Registry
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!models?.length ? (
                <p className="text-xs text-muted-foreground font-mono text-center py-4">No registered models</p>
              ) : (
                <div className="space-y-2">
                  {models.map((m) => (
                    <div key={m.id} className="p-2.5 rounded border border-border bg-background">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-mono font-medium">{m.name}</p>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          m.status === "active" ? "bg-green-500/15 text-green-400"
                          : m.status === "training" ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                        }`}>{m.status}</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{m.type} · {m.version}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── HF AutoTrain ─────────────────────────────────────────────────────── */}
      <HFAutoTrainPanel datasets={(datasets ?? []).map((d) => ({ id: d.id, name: d.name }))} />

      {/* ── Model Catalogue ──────────────────────────────────────────────────── */}
      <Card className="glass-panel">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="w-4 h-4 text-primary" />
              Model Catalogue
              <span className="text-xs font-mono text-muted-foreground font-normal">
                — click pull to download
              </span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                value={catalogueSearch}
                onChange={(e) => setCatalogueSearch(e.target.value)}
                placeholder="Search models..."
                className="h-7 text-xs font-mono bg-background w-40"
              />
              <div className="flex items-center gap-1">
                {["all","fast","smart","reasoning","coding","multilang"].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setModelFilter(tag)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                      modelFilter === tag
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {filteredCatalogue.map((m) => {
              const installed = installedNames.some((n) => n === m.name || n.startsWith(m.name.split(":")[0]));
              return (
                <div
                  key={m.name}
                  className={`flex items-start justify-between p-3 rounded-lg border transition-colors ${
                    installed
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border bg-background hover:border-primary/40 cursor-pointer"
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base leading-none">{m.icon}</span>
                      <span className="text-sm font-mono font-medium truncate">{m.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{m.desc}</p>
                    <span className={`inline-block mt-1.5 text-[9px] font-mono px-1.5 py-0.5 rounded border ${TAG_COLORS[m.tag] || "bg-muted text-muted-foreground border-border"}`}>
                      {m.tag}
                    </span>
                  </div>
                  {installed ? (
                    <span className="text-[10px] font-mono text-green-500 shrink-0 mt-0.5">READY</span>
                  ) : (
                    <DownloadButton model={m.name} onDone={() => refetchOllama()} />
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-3 text-center">
            Click <span className="text-primary">pull</span> on any model above to download instantly. Or use the CLI Terminal for advanced commands.
          </p>
        </CardContent>
      </Card>

      {/* Add Sample Dialog */}
      <Dialog open={addSampleOpen} onOpenChange={setAddSampleOpen}>
        <DialogContent className="sm:max-w-[560px] border-border bg-card">
          <DialogHeader><DialogTitle>Add Training Sample</DialogTitle></DialogHeader>
          <form onSubmit={handleAddSample} className="space-y-4 pt-3">
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">INPUT (question / prompt)</label>
              <textarea
                value={sampleInput}
                onChange={(e) => setSampleInput(e.target.value)}
                required
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="e.g. What is machine learning?"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">OUTPUT (expected answer)</label>
              <textarea
                value={sampleOutput}
                onChange={(e) => setSampleOutput(e.target.value)}
                required
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="e.g. Machine learning is a subset of AI..."
              />
            </div>
            <Button type="submit" className="w-full" disabled={addSampleMutation.isPending || !sampleInput || !sampleOutput}>
              {addSampleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Sample to Dataset
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Quality Report Modal ─────────────────────────────────────────────── */}
      <Dialog open={!!qualityReport} onOpenChange={(o) => { if (!o) setQualityReport(null); }}>
        <DialogContent className="border-border bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-amber-400" />
              Quality Report — {qualityReport?.datasetName}
            </DialogTitle>
          </DialogHeader>
          {qualityReport?.report && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Total Samples", value: qualityReport.report.total, color: "text-foreground" },
                  { label: "Avg Quality", value: `${(qualityReport.report.avgQuality * 100).toFixed(0)}%`, color: qualityReport.report.avgQuality >= 0.7 ? "text-green-400" : qualityReport.report.avgQuality >= 0.4 ? "text-amber-400" : "text-red-400" },
                  { label: "Low Quality", value: qualityReport.report.lowQualityCount, color: qualityReport.report.lowQualityCount > 0 ? "text-red-400" : "text-green-400" },
                ].map((s) => (
                  <div key={s.label} className="p-3 rounded border border-border bg-background/60 text-center">
                    <div className={`text-xl font-bold font-mono ${s.color}`}>{String(s.value)}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-mono text-muted-foreground">Quality distribution</p>
                {[
                  { label: "Excellent (≥80%)", value: qualityReport.report.distribution.excellent, color: "bg-green-500" },
                  { label: "Good (60–79%)", value: qualityReport.report.distribution.good, color: "bg-blue-500" },
                  { label: "Fair (40–59%)", value: qualityReport.report.distribution.fair, color: "bg-amber-500" },
                  { label: "Poor (<40%)", value: qualityReport.report.distribution.poor, color: "bg-red-500" },
                ].map((b) => {
                  const pct = qualityReport.report.total > 0 ? Math.round((b.value / qualityReport.report.total) * 100) : 0;
                  return (
                    <div key={b.label} className="flex items-center gap-2 text-xs font-mono">
                      <span className="w-36 text-muted-foreground text-[10px]">{b.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                        <div className={`h-full rounded-full ${b.color}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right text-muted-foreground">{b.value}</span>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground">
                <span>Avg input length: <span className="text-foreground">{qualityReport.report.avgInputLen} chars</span></span>
                <span>Avg output length: <span className="text-foreground">{qualityReport.report.avgOutputLen} chars</span></span>
              </div>
              {qualityReport.report.recommendation && (
                <div className="p-3 rounded border border-amber-500/20 bg-amber-500/5 text-xs font-mono text-amber-300">
                  ⚡ {qualityReport.report.recommendation}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Import URL Dialog ────────────────────────────────────────────────── */}
      <Dialog open={importUrlDialogDatasetId !== null} onOpenChange={(o) => { if (!o) { setImportUrlDialogDatasetId(null); setImportUrl(""); setImportUrlResult(null); } }}>
        <DialogContent className="border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link className="w-4 h-4 text-cyan-400" />
              Import Samples from URL
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground font-mono">
              Scrapes a webpage and imports its content as training samples into the selected dataset.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">URL to scrape</label>
              <Input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://..."
                className="font-mono text-sm bg-background"
              />
            </div>
            {importUrlResult && (
              <div className="p-3 rounded border border-green-500/20 bg-green-500/5 text-xs font-mono text-green-400">
                ✓ Added {importUrlResult.added} samples · Skipped {importUrlResult.skipped} duplicates
              </div>
            )}
            <Button
              className="w-full gap-2"
              disabled={importUrlLoading || !importUrl}
              onClick={async () => {
                if (!importUrlDialogDatasetId) return;
                setImportUrlLoading(true);
                setImportUrlResult(null);
                try {
                  const r = await fetch(`${BASE}/api/training-datasets/${importUrlDialogDatasetId}/import-url`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: importUrl }),
                  });
                  if (r.ok) {
                    const d = await r.json() as { added: number; skipped: number };
                    setImportUrlResult(d);
                    queryClient.invalidateQueries({ queryKey: getListTrainingDatasetsQueryKey() });
                  }
                } finally {
                  setImportUrlLoading(false);
                }
              }}
            >
              {importUrlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              {importUrlLoading ? "Importing…" : "Import"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Benchmark Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={benchmarkModel !== null} onOpenChange={(o) => { if (!o) { setBenchmarkModel(null); setBenchmarkResult(null); } }}>
        <DialogContent className="border-border bg-card max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-blue-400" />
              Benchmark — {benchmarkModel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!benchmarkResult && !benchmarkLoading && (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground font-mono mb-4">
                  Runs 5 real prompts through the model and measures accuracy, latency, and throughput.
                </p>
                <Button className="gap-2" onClick={async () => {
                  if (!benchmarkModel) return;
                  setBenchmarkLoading(true);
                  try {
                    const r = await fetch(`${BASE}/api/models/benchmark`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ model: benchmarkModel }),
                    });
                    if (r.ok) setBenchmarkResult(await r.json() as BenchmarkResult);
                  } finally {
                    setBenchmarkLoading(false);
                  }
                }}>
                  <Play className="w-4 h-4" /> Run Benchmark
                </Button>
              </div>
            )}
            {benchmarkLoading && (
              <div className="text-center py-10 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground font-mono">Running 5 prompts… this may take 30–60 seconds</p>
              </div>
            )}
            {benchmarkResult && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Grade", value: benchmarkResult.summary.grade, color: benchmarkResult.summary.grade === "A" ? "text-green-400" : benchmarkResult.summary.grade === "B" ? "text-blue-400" : benchmarkResult.summary.grade === "C" ? "text-amber-400" : "text-red-400" },
                    { label: "Accuracy", value: benchmarkResult.summary.accuracy !== null ? `${benchmarkResult.summary.accuracy}%` : "N/A", color: "text-foreground" },
                    { label: "Avg Latency", value: `${benchmarkResult.summary.avgLatencyMs}ms`, color: "text-purple-400" },
                    { label: "Tokens", value: benchmarkResult.summary.totalTokens, color: "text-cyan-400" },
                  ].map((s) => (
                    <div key={s.label} className="p-3 rounded border border-border bg-background/60 text-center">
                      <div className={`text-xl font-bold font-mono ${s.color}`}>{String(s.value)}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
                {/* Results */}
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {benchmarkResult.results.map((res) => (
                    <div key={res.id} className={`p-2.5 rounded border text-xs font-mono ${
                      res.passed === true ? "border-green-500/30 bg-green-500/5" :
                      res.passed === false ? "border-red-500/30 bg-red-500/5" :
                      "border-border bg-background/40"
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-2">
                            <span className="uppercase text-primary/70">{res.id}</span>
                            <span>{res.latencyMs}ms</span>
                            {res.tokensPerSec !== null && <span>{res.tokensPerSec} tok/s</span>}
                          </div>
                          <div className="text-muted-foreground mb-0.5 truncate">Q: {res.prompt}</div>
                          <div className="text-foreground/80 line-clamp-2">A: {res.response || "(no response)"}</div>
                        </div>
                        <span className="shrink-0">
                          {res.passed === true ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                           res.passed === false ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                           <span className="text-muted-foreground">—</span>}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs font-mono h-7 gap-1.5" onClick={() => { setBenchmarkResult(null); }}>
                    <RotateCcw className="w-3 h-3" /> Run Again
                  </Button>
                  <span className="text-[10px] font-mono text-muted-foreground self-center">
                    ran at {format(new Date(benchmarkResult.ranAt), "HH:mm:ss")}
                  </span>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── BLOK B: Capability Radar ──────────────────────────────────────── */}
      <CapabilityRadarPanel BASE={BASE} models={models} />

      {/* ── BLOK D: Projects ─────────────────────────────────────────────── */}
      <ProjectsPanel BASE={BASE} />

      {/* ── BLOK G: System Events ────────────────────────────────────────── */}
      <SystemEventsPanel BASE={BASE} />

      {/* ── BLOK H: Distillation Jobs ────────────────────────────────────── */}
      <DistillationPanel BASE={BASE} />

      {/* ── BLOK K: Red-Team Results ─────────────────────────────────────── */}
      <RedTeamPanel BASE={BASE} />

      {/* ── BLOK M: Knowledge Graph ──────────────────────────────────────── */}
      <KnowledgeGraphPanel BASE={BASE} />

      </div>}
      {/* end advanced tab wrapper */}

    </div>
  );
}

// ── BLOK B: Capability Radar ──────────────────────────────────────────────────
interface RadarData { model: string; scores: Record<string, number>; grade: string; ranAt: string }
function CapabilityRadarPanel({ BASE, models }: { BASE: string; models: { id: number; name: string; ollamaName?: string | null }[] | undefined }) {
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchRadar = async (model: string) => {
    if (!model) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/benchmarks/radar/${encodeURIComponent(model)}`);
      const data = await res.json() as RadarData;
      setRadar(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const DIMS = ["reasoning", "coding", "factual", "language", "math", "safety"];
  const colors: Record<string, string> = { reasoning: "text-blue-400", coding: "text-green-400", factual: "text-yellow-400", language: "text-purple-400", math: "text-pink-400", safety: "text-cyan-400" };

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Radar className="w-4 h-4 text-primary" /> CAPABILITY_RADAR
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-48 font-mono text-xs bg-background">
                <SelectValue placeholder="Select model…" />
              </SelectTrigger>
              <SelectContent>
                {(models || []).map(m => (
                  <SelectItem key={m.id} value={m.ollamaName || m.name} className="font-mono text-xs">{m.name}</SelectItem>
                ))}
                <SelectItem value="tinyllama" className="font-mono text-xs">tinyllama (default)</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="font-mono text-xs h-9 gap-1.5" disabled={loading || !selectedModel} onClick={() => fetchRadar(selectedModel)}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />} Run Radar
            </Button>
          </div>
          {radar && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{radar.model}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  radar.grade === "A" ? "bg-green-500/20 text-green-400" :
                  radar.grade === "B" ? "bg-blue-500/20 text-blue-400" :
                  radar.grade === "C" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"
                }`}>Grade: {radar.grade}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{format(new Date(radar.ranAt), "HH:mm:ss")}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DIMS.map(dim => {
                  const score = radar.scores[dim] ?? 0;
                  return (
                    <div key={dim} className="p-2.5 rounded border border-border bg-background/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-[10px] font-mono uppercase ${colors[dim] || "text-muted-foreground"}`}>{dim}</span>
                        <span className="text-xs font-mono font-bold">{(score * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={score * 100} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!radar && !loading && (
            <p className="text-xs text-muted-foreground font-mono text-center py-4 border border-dashed border-border rounded-lg">
              Select a model and run radar to see capability scores
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── BLOK D: Projects ──────────────────────────────────────────────────────────
interface Project { id: number; name: string; status: string; priority: string; createdAt: string; completedAt?: string | null; description?: string | null }
function ProjectsPanel({ BASE }: { BASE: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/projects`);
      const data = await res.json() as Project[];
      setProjects(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [BASE]);

  useEffect(() => { if (open) fetchProjects(); }, [open, fetchProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await fetch(`${BASE}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDesc || undefined }),
      });
      setNewName(""); setNewDesc(""); setCreateOpen(false);
      fetchProjects();
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const statusColor = (s: string) => s === "completed" ? "text-green-400" : s === "active" ? "text-blue-400" : s === "paused" ? "text-yellow-400" : "text-muted-foreground";
  const priorityColor = (p: string) => p === "critical" ? "text-red-400" : p === "high" ? "text-orange-400" : p === "normal" ? "text-blue-400" : "text-muted-foreground";

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-primary" /> AGENT_PROJECTS
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-mono">{projects.length} projects</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs font-mono gap-1" onClick={fetchProjects} disabled={loading}>
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-7 text-xs font-mono gap-1"><Plus className="w-3 h-3" /> New</Button>
                </DialogTrigger>
                <DialogContent className="border-border bg-card">
                  <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-3 pt-2">
                    <div className="space-y-1.5"><label className="text-xs font-mono text-muted-foreground">NAME</label>
                      <Input value={newName} onChange={e => setNewName(e.target.value)} required className="font-mono text-sm bg-background" /></div>
                    <div className="space-y-1.5"><label className="text-xs font-mono text-muted-foreground">DESCRIPTION</label>
                      <Input value={newDesc} onChange={e => setNewDesc(e.target.value)} className="font-mono text-sm bg-background" /></div>
                    <Button type="submit" className="w-full" disabled={creating || !newName}>
                      {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create Project
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /> :
           !projects.length ? (
            <p className="text-xs text-muted-foreground font-mono text-center py-4 border border-dashed border-border rounded-lg">No projects yet — create one above</p>
           ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {projects.map(p => (
                <div key={p.id} className="p-2.5 rounded border border-border bg-background/40 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-medium truncate">{p.name}</div>
                    {p.description && <div className="text-[10px] text-muted-foreground truncate">{p.description}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-mono uppercase ${statusColor(p.status)}`}>{p.status}</span>
                    <span className={`text-[10px] font-mono uppercase ${priorityColor(p.priority)}`}>{p.priority}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── BLOK G: System Events ─────────────────────────────────────────────────────
interface SystemEvent { id: number; type: string; payload: unknown; source?: string | null; createdAt: string }
function SystemEventsPanel({ BASE }: { BASE: string }) {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/events?limit=30`);
      const data = await res.json() as SystemEvent[];
      setEvents(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [BASE]);

  useEffect(() => { if (open) { fetchEvents(); const id = setInterval(fetchEvents, 10000); return () => clearInterval(id); } }, [open, fetchEvents]);

  const eventColor = (type: string) => {
    if (type.includes("degradation") || type.includes("error") || type.includes("fail")) return "text-red-400 border-red-500/30 bg-red-500/5";
    if (type.includes("feedback")) return "text-green-400 border-green-500/30 bg-green-500/5";
    if (type.includes("benchmark")) return "text-blue-400 border-blue-500/30 bg-blue-500/5";
    if (type.includes("training")) return "text-purple-400 border-purple-500/30 bg-purple-500/5";
    return "text-muted-foreground border-border bg-background/40";
  };

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" /> SYSTEM_EVENTS
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-mono">{events.length} recent events</span>
            <Button size="sm" variant="outline" className="h-7 text-xs font-mono gap-1" onClick={fetchEvents} disabled={loading}>
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /> :
           !events.length ? (
            <p className="text-xs text-muted-foreground font-mono text-center py-4 border border-dashed border-border rounded-lg">No events yet — system events will appear here</p>
           ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {events.map(ev => (
                <div key={ev.id} className={`p-2 rounded border text-[10px] font-mono flex items-start gap-2 ${eventColor(ev.type)}`}>
                  <span className="shrink-0 opacity-60">{format(new Date(ev.createdAt), "HH:mm:ss")}</span>
                  <span className="font-bold uppercase">{ev.type}</span>
                  {ev.source && <span className="opacity-60">from:{ev.source}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── BLOK H: Distillation Jobs ─────────────────────────────────────────────────
interface DistillJob { id: string; topic: string; targetModel: string; status: string; progress: number; generated: number; verified: number; rejected: number; startedAt: string; log: string[] }
function DistillationPanel({ BASE }: { BASE: string }) {
  const [jobs, setJobs] = useState<DistillJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("Python programming");
  const [targetModel, setTargetModel] = useState("tinyllama");
  const [count, setCount] = useState("10");

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/distillation/jobs`);
      const data = await res.json() as DistillJob[];
      setJobs(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [BASE]);

  useEffect(() => { if (open) fetchJobs(); }, [open, fetchJobs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await fetch(`${BASE}/api/distillation/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, count: Number(count) || 10, targetModel, autoVerify: true }),
      });
      setTimeout(() => { void fetchJobs(); }, 1000);
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const statusColor = (s: string) => s === "completed" ? "text-green-400" : s === "running" ? "text-blue-400" : s === "failed" ? "text-red-400" : "text-muted-foreground";

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-primary" /> DISTILLATION_JOBS
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <form onSubmit={handleCreate} className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1 flex-1 min-w-32">
              <label className="text-[10px] font-mono text-muted-foreground">TOPIC</label>
              <Input value={topic} onChange={e => setTopic(e.target.value)} className="h-8 font-mono text-xs bg-background" placeholder="Python programming" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground">TARGET MODEL</label>
              <Input value={targetModel} onChange={e => setTargetModel(e.target.value)} className="h-8 font-mono text-xs bg-background w-32" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground">PAIRS</label>
              <Input value={count} onChange={e => setCount(e.target.value)} className="h-8 font-mono text-xs bg-background w-16" type="number" min="1" max="50" />
            </div>
            <Button type="submit" size="sm" className="h-8 font-mono text-xs gap-1" disabled={creating}>
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Distill
            </Button>
          </form>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /> :
           !jobs.length ? (
            <p className="text-xs text-muted-foreground font-mono text-center py-4 border border-dashed border-border rounded-lg">No distillation jobs yet</p>
           ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {jobs.map(j => (
                <div key={j.id} className="p-2.5 rounded border border-border bg-background/40 text-xs font-mono">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-primary truncate max-w-40">{j.topic}</span>
                    <span className={`text-[10px] uppercase ${statusColor(j.status)}`}>{j.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>→ {j.targetModel}</span>
                    <span>{j.verified}/{j.generated} verified</span>
                    <span>{j.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── BLOK K: Red-Team Results ──────────────────────────────────────────────────
interface RedTeamRun {
  id: string;
  ranAt: string;
  totalTests: number;
  failures: number;
  failureRate: number;
  attacks: Array<{ type: string; prompt: string; response: string; vulnerable: boolean; severity: string }>;
  summary: string;
}
function RedTeamPanel({ BASE }: { BASE: string }) {
  const [results, setResults] = useState<RedTeamRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [modelName, setModelName] = useState("auto");

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/redteam/results`);
      const data = await res.json() as RedTeamRun[];
      setResults(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [BASE]);

  useEffect(() => { if (open) fetchResults(); }, [open, fetchResults]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await fetch(`${BASE}/api/redteam/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelName }),
      });
      setTimeout(() => { void fetchResults(); }, 2000);
    } catch { /* ignore */ }
    finally { setRunning(false); }
  };

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-primary" /> RED_TEAM_RESULTS
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="space-y-1 flex-1">
              <label className="text-[10px] font-mono text-muted-foreground">MODEL (auto = current active)</label>
              <Input value={modelName} onChange={e => setModelName(e.target.value)} className="h-8 font-mono text-xs bg-background" />
            </div>
            <Button size="sm" className="h-8 font-mono text-xs gap-1" onClick={handleRun} disabled={running}>
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />} Run
            </Button>
            <Button size="sm" variant="outline" className="h-8 font-mono text-xs" onClick={fetchResults} disabled={loading}>
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /> :
           !results.length ? (
            <p className="text-xs text-muted-foreground font-mono text-center py-4 border border-dashed border-border rounded-lg">No red-team runs yet — click Run above ({">"}14 attack types)</p>
           ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {results.map(r => (
                <div key={r.id} className="p-2.5 rounded border border-border bg-background/40 text-xs font-mono">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">{new Date(r.ranAt).toLocaleTimeString()}</span>
                    <span className={r.failureRate > 30 ? "text-red-400" : r.failureRate > 10 ? "text-yellow-400" : "text-green-400"}>
                      {r.failures}/{r.totalTests} fail ({r.failureRate}%)
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.summary}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── BLOK M: Knowledge Graph ───────────────────────────────────────────────────
interface KGEntity { id: number; name: string; type: string; description?: string | null; mentions: number }
interface KGStats { totalEntities: number; totalRelations: number; types: Record<string, number> }
function KnowledgeGraphPanel({ BASE }: { BASE: string }) {
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [stats, setStats] = useState<KGStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [entRes, statRes] = await Promise.all([
        fetch(`${BASE}/api/kg/entities?limit=30`).then(r => r.json()) as Promise<KGEntity[]>,
        fetch(`${BASE}/api/kg/stats`).then(r => r.json()) as Promise<KGStats>,
      ]);
      setEntities(entRes);
      setStats(statRes);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [BASE]);

  useEffect(() => { if (open) fetchData(); }, [open, fetchData]);

  const filtered = search ? entities.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || e.type.toLowerCase().includes(search.toLowerCase())) : entities;
  const typeColor = (t: string) => {
    const m: Record<string, string> = { person: "text-blue-400", org: "text-purple-400", concept: "text-green-400", location: "text-yellow-400", technology: "text-cyan-400" };
    return m[t] || "text-muted-foreground";
  };

  return (
    <Card className="glass-panel border-border">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" /> KNOWLEDGE_GRAPH
          </CardTitle>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {stats && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded border border-border bg-background/40 text-center">
                <div className="text-lg font-mono font-bold text-primary">{stats.totalEntities}</div>
                <div className="text-[10px] font-mono text-muted-foreground">entities</div>
              </div>
              <div className="p-2 rounded border border-border bg-background/40 text-center">
                <div className="text-lg font-mono font-bold text-blue-400">{stats.totalRelations}</div>
                <div className="text-[10px] font-mono text-muted-foreground">relations</div>
              </div>
              <div className="p-2 rounded border border-border bg-background/40 text-center">
                <div className="text-lg font-mono font-bold text-purple-400">{Object.keys(stats.types).length}</div>
                <div className="text-[10px] font-mono text-muted-foreground">types</div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities…" className="h-8 font-mono text-xs bg-background flex-1" />
            <Button size="sm" variant="outline" className="h-8 font-mono text-xs gap-1" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /> :
           !filtered.length ? (
            <p className="text-xs text-muted-foreground font-mono text-center py-4 border border-dashed border-border rounded-lg">
              {search ? "No entities match your search" : "Knowledge graph is empty — index documents in the RAG tab to populate it"}
            </p>
           ) : (
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {filtered.map(e => (
                <div key={e.id} className="p-2 rounded border border-border bg-background/40 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono font-medium truncate">{e.name}</div>
                    <div className={`text-[10px] font-mono ${typeColor(e.type)}`}>{e.type}</div>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{e.mentions}×</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
