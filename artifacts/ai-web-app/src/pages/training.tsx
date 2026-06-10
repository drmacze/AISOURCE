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

import { getApiBase } from "./models";
const BASE = getApiBase();

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
    { id: 0, type: "system", text: "NEXUS_OS Ollama CLI — type 'help' for commands", ts: Date.now() },
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
    addLine("user", `nexus@ollama:~$ ${cmd}`);
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
          nexus_os — ollama terminal
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
        <span className="text-primary shrink-0">nexus@ollama:~$</span>
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
  const [dsTaskType, setDsTaskType] = useState<"classification"|"generation"|"summarization"|"qa"|"translation">("generation");

  const [startJobOpen, setStartJobOpen] = useState(false);
  const [jobModelId, setJobModelId] = useState("");
  const [jobDatasetId, setJobDatasetId] = useState("");
  const [jobEpochs, setJobEpochs] = useState("3");

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
      data: { modelId: Number(jobModelId), datasetId: Number(jobDatasetId), epochs: Number(jobEpochs) || 3 },
    });
  };

  const handleRegisterModel = (e: React.FormEvent) => {
    e.preventDefault();
    registerModelMutation.mutate({
      data: { name: rmName, type: rmType, version: rmVersion, architecture: rmArch || undefined, description: rmDesc || undefined },
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

          <Dialog open={startJobOpen} onOpenChange={setStartJobOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 font-mono" variant="default">
                <Play className="w-4 h-4" /> START_JOB
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card">
              <DialogHeader><DialogTitle>Start Training Pipeline</DialogTitle></DialogHeader>
              <form onSubmit={handleStartJob} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">SELECT_MODEL</label>
                  <Select value={jobModelId} onValueChange={setJobModelId}>
                    <SelectTrigger className="font-mono text-sm bg-background"><SelectValue placeholder="Select registered model" /></SelectTrigger>
                    <SelectContent>
                      {models?.map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>{m.name} ({m.version})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">SELECT_DATASET</label>
                  <Select value={jobDatasetId} onValueChange={setJobDatasetId}>
                    <SelectTrigger className="font-mono text-sm bg-background"><SelectValue placeholder="Select dataset" /></SelectTrigger>
                    <SelectContent>
                      {datasets?.map((d) => (
                        <SelectItem key={d.id} value={d.id.toString()}>{d.name} ({d.sampleCount} samples)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground">EPOCHS</label>
                  <Input type="number" min="1" max="20" value={jobEpochs} onChange={(e) => setJobEpochs(e.target.value)} className="font-mono text-sm bg-background" />
                </div>
                <p className="text-xs text-muted-foreground font-mono bg-accent/30 p-3 rounded-md">
                  ⚡ Training creates a real Ollama Modelfile from your dataset and registers it as a local model.
                </p>
                <Button type="submit" className="w-full" disabled={startJobMutation.isPending || !jobModelId || !jobDatasetId}>
                  {startJobMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Launch Pipeline
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Live Auto-Training Engine ────────────────────────────────────── */}
      <AutoTrainingPanel />

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
                  {[...activeJobs, ...completedJobs].map((job) => (
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
                            <div className="font-mono text-sm font-medium">JOB_{job.id.toString().padStart(4, "0")}</div>
                            <div className="text-xs text-muted-foreground">Model #{job.modelId} · Dataset #{job.datasetId} · {job.epochs} epochs</div>
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
                      <div className="flex gap-6 text-xs font-mono text-muted-foreground border-t border-border pt-2">
                        <span>Loss: {job.loss?.toFixed(4) || "—"}</span>
                        <span>Accuracy: {job.accuracy ? `${(job.accuracy * 100).toFixed(1)}%` : "—"}</span>
                        {job.error && <span className="text-destructive truncate max-w-48">⚠ {job.error}</span>}
                        <span className="ml-auto">{job.startedAt ? format(new Date(job.startedAt), "HH:mm:ss") : "—"}</span>
                      </div>
                    </div>
                  ))}
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
                        <Select value={dsTaskType} onValueChange={(v) => setDsTaskType(v as typeof dsTaskType)}>
                          <SelectTrigger className="font-mono text-sm bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["generation","qa","classification","summarization","translation"].map(t => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
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

    </div>
  );
}
