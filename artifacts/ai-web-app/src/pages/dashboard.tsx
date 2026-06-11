import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Activity, Database, MessageSquare, Network, Cpu, Clock,
  Wifi, WifiOff, Brain, Zap, TrendingUp, Globe, BookOpen,
  Server, Layers, BarChart3, RefreshCw, Terminal, GitBranch,
  CheckCircle2, AlertCircle, Loader2, HardDrive, MemoryStick,
  Microchip,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Data hooks ────────────────────────────────────────────────────────────────
function useHealth() {
  return useQuery({
    queryKey: ["v1-health"],
    queryFn: () => fetch(`${BASE}/api/v1/health`).then((r) => r.json()) as Promise<{
      status: string; version: string; engine: string; uptime: number;
      ollama: boolean; huggingface: boolean; kimi: boolean;
      providers?: {
        groq?:       { connected: boolean };
        openrouter?: { connected: boolean };
        huggingface?:{ connected: boolean };
        kimi?:       { connected: boolean };
        ollama?:     { connected: boolean };
      };
      memory?: { freeGB: number; totalGB: number };
    }>,
    refetchInterval: 15_000,
  });
}

function useStats() {
  return useQuery({
    queryKey: ["v1-stats-public"],
    queryFn: () => fetch(`${BASE}/api/v1/health`).then((r) => r.json()),
    refetchInterval: 30_000,
  });
}

function useAutoTraining() {
  return useQuery({
    queryKey: ["autotraining-status"],
    queryFn: () => fetch(`${BASE}/api/autotraining/status`).then((r) => r.json()) as Promise<{
      running: boolean; totalCyclesCompleted: number; totalSamplesAdded: number;
      lastCycleAt: string | null; nextCycleAt: string | null;
      hfConnected: boolean; activityLog: Array<{ at: string; msg: string; type: string }>;
      sourceStats: Record<string, number>; sources: string[];
    }>,
    refetchInterval: 20_000,
  });
}

function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard-main-stats"],
    queryFn: () => fetch(`${BASE}/api/dashboard/stats`).then((r) => r.json()),
    refetchInterval: 30_000,
  });
}

interface ResourceData {
  cpu:     { usagePercent: number; cores: number; model: string; speedMHz: number };
  ram:     { totalMB: number; usedMB: number; freeMB: number; availableMB: number; cachedMB: number; usedPercent: number; swap: { totalMB: number; usedMB: number } };
  disk:    { path: string; totalGB: number; usedGB: number; freeGB: number; usedPercent: number };
  process: { pid: number; memoryMB: number; uptimeSec: number; nodeVersion: string };
  system:  { uptimeSec: number };
  ts:      number;
}

function useResources() {
  return useQuery<ResourceData>({
    queryKey: ["system-resources"],
    queryFn: () => fetch(`${BASE}/api/system/resources`).then((r) => r.json()),
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUptime(seconds: number): string {
  const s = Math.round(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// ── Resource Gauge ────────────────────────────────────────────────────────────
function ResourceGauge({
  label, usedPercent, detail, subDetail, icon: Icon, color, loading,
}: {
  label: string; usedPercent: number; detail: string; subDetail?: string;
  icon: React.ElementType; color: string; loading?: boolean;
}) {
  const clamp = Math.min(100, Math.max(0, usedPercent));
  const barColor =
    clamp >= 90 ? "bg-red-500" :
    clamp >= 70 ? "bg-amber-400" :
    "bg-emerald-400";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("w-3.5 h-3.5", color)} />
          <span className="text-xs font-semibold text-slate-300">{label}</span>
        </div>
        {loading
          ? <Loader2 className="w-3 h-3 text-slate-600 animate-spin" />
          : <span className={cn("text-xs font-mono font-bold", clamp >= 90 ? "text-red-400" : clamp >= 70 ? "text-amber-400" : "text-white")}>{clamp}%</span>
        }
      </div>
      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full transition-all duration-700", barColor)}
          initial={{ width: 0 }}
          animate={{ width: `${clamp}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400 font-mono">{detail}</span>
        {subDetail && <span className="text-[10px] text-slate-600 font-mono">{subDetail}</span>}
      </div>
    </div>
  );
}

// ── Resource Monitor Panel ────────────────────────────────────────────────────
function ResourceMonitor() {
  const { data: r, isLoading, isFetching, dataUpdatedAt } = useResources();

  const formatUptime2 = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${sec}s`;
  };

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID") : "—";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.28 }}
      className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
    >
      <div className="flex items-center gap-2 mb-5">
        <Microchip className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Resource Monitor</h2>
        <span className="text-[10px] text-slate-600 ml-1">live · setiap 5s</span>
        {isFetching && <RefreshCw className="w-3 h-3 text-slate-600 animate-spin ml-auto" />}
        {!isFetching && <span className="text-[10px] text-slate-700 ml-auto font-mono">{lastUpdated}</span>}
      </div>

      <div className="space-y-5">
        {/* CPU */}
        <ResourceGauge
          label="CPU"
          usedPercent={r?.cpu?.usagePercent ?? 0}
          detail={`${r?.cpu?.usagePercent ?? 0}% dari ${r?.cpu?.cores ?? 0} core`}
          subDetail={r?.cpu?.model ? r.cpu.model.split(" ").slice(0, 3).join(" ") : undefined}
          icon={Cpu}
          color="text-blue-400"
          loading={isLoading}
        />

        {/* RAM */}
        <ResourceGauge
          label="RAM"
          usedPercent={r?.ram?.usedPercent ?? 0}
          detail={`${r?.ram ? (r.ram.usedMB / 1024).toFixed(1) : "—"} GB / ${r?.ram ? (r.ram.totalMB / 1024).toFixed(1) : "—"} GB`}
          subDetail={r?.ram ? `${(r.ram.availableMB / 1024).toFixed(1)} GB tersedia · cache ${(r.ram.cachedMB / 1024).toFixed(1)} GB` : undefined}
          icon={MemoryStick}
          color="text-violet-400"
          loading={isLoading}
        />

        {/* Disk */}
        <ResourceGauge
          label="Disk"
          usedPercent={r?.disk?.usedPercent ?? 0}
          detail={`${r?.disk?.usedGB ?? "—"} GB / ${r?.disk?.totalGB ?? "—"} GB`}
          subDetail={r?.disk ? `${r.disk.freeGB} GB bebas` : undefined}
          icon={HardDrive}
          color="text-amber-400"
          loading={isLoading}
        />
      </div>

      {/* Detail rows */}
      {r?.process && (
        <div className="mt-5 pt-4 border-t border-white/5 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
          <div className="flex justify-between text-slate-500">
            <span>API Process RAM</span>
            <span className="text-slate-300">{r.process?.memoryMB} MB</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Swap</span>
            <span className={r.ram?.swap?.totalMB > 0 ? "text-amber-400" : "text-slate-500"}>
              {r.ram?.swap?.totalMB > 0 ? `${r.ram.swap.usedMB}/${r.ram.swap.totalMB} MB` : "Tidak ada"}
            </span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>System Uptime</span>
            <span className="text-slate-300">{formatUptime2(r.system?.uptimeSec ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Node.js</span>
            <span className="text-slate-300">{r.process?.nodeVersion}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>PID</span>
            <span className="text-slate-300">{r.process?.pid}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>CPU Cores</span>
            <span className="text-slate-300">{r.cpu?.cores} core</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, sub, color, delay = 0,
}: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="relative rounded-xl border border-white/5 bg-slate-900/60 p-5 overflow-hidden group hover:border-white/10 transition-colors"
    >
      <div className={cn("absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity", color.replace("text-", "bg-"))} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
          <p className="text-2xl font-bold text-white font-mono">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1 truncate">{sub}</p>}
        </div>
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", color.replace("text-", "bg-") + "/10")}>
          <Icon className={cn("w-5 h-5", color)} />
        </div>
      </div>
    </motion.div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ ok, label, icon: Icon }: { ok: boolean; label: string; icon: React.ElementType }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border",
      ok
        ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400"
        : "bg-red-500/8 border-red-500/20 text-red-400"
    )}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
      <Icon className="w-3 h-3 opacity-70" />
      <span>{label}</span>
    </div>
  );
}

// ── Activity Entry ────────────────────────────────────────────────────────────
const SOURCE_PREFIX_COLORS: Record<string, string> = {
  wikipedia: "text-blue-400", hackernews: "text-orange-400", reddit: "text-orange-300",
  arxiv: "text-violet-400", rss: "text-amber-400", huggingface: "text-yellow-400",
  curated: "text-emerald-400", github: "text-pink-400", micro: "text-cyan-400",
  cycle: "text-white/70",
};

function ActivityEntry({ msg, type, at }: { msg: string; type: string; at: string }) {
  const dot = type === "success" ? "bg-emerald-400" : type === "error" ? "bg-red-400" : type === "warn" ? "bg-amber-400" : "bg-blue-400";
  const msgColor = type === "success" ? "text-emerald-300/80" : type === "error" ? "text-red-300/80" : "text-slate-400";

  const sourceMatch = msg.match(/^(Wikipedia|HackerNews|arXiv|RSS|HuggingFace|GitHub|Reddit|Micro|Cycle|Auto-training)/i);
  const prefix = sourceMatch?.[0] || null;
  const prefixKey = prefix?.toLowerCase().replace(/[-\s]/g, "").replace("auto-training", "cycle") || "";
  const prefixColor = SOURCE_PREFIX_COLORS[prefixKey] || "text-slate-500";
  const msgBody = prefix ? msg.slice(prefix.length).trimStart() : msg;

  return (
    <div className="flex items-start gap-2.5 py-1.5 border-b border-white/3 last:border-0">
      <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0", dot)} />
      <span className={cn("text-xs flex-1 leading-relaxed font-mono break-all", msgColor)}>
        {prefix && <span className={cn("mr-1 font-semibold", prefixColor)}>[{prefix}]</span>}
        {msgBody}
      </span>
      <span className="text-[10px] text-slate-600 flex-shrink-0 font-mono whitespace-nowrap">
        {formatDistanceToNow(new Date(at), { addSuffix: true })}
      </span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const health = useHealth();
  const at     = useAutoTraining();
  const stats  = useDashboardStats();
  const _res   = useResources(); // prefetch for ResourceMonitor child

  const h = health.data;
  const a = at.data;
  const s = stats.data;

  const sourceIcons: Record<string, React.ElementType> = {
    wikipedia: Globe, hackernews: Terminal, reddit: MessageSquare,
    arxiv: BookOpen, rss: Layers, huggingface: Brain, curated: Cpu, github: GitBranch,
  };

  const sourceColors: Record<string, string> = {
    wikipedia: "text-blue-400", hackernews: "text-orange-400", reddit: "text-orange-300",
    arxiv: "text-violet-400", rss: "text-amber-400", huggingface: "text-yellow-400",
    curated: "text-emerald-400", github: "text-pink-400",
  };

  return (
    <div className="min-h-full bg-slate-950 p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xl sm:text-2xl font-bold text-white tracking-tight"
          >
            System Dashboard
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-sm text-slate-500 mt-0.5"
          >
            Real-time metrics · {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </motion.p>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-emerald-400">Online</span>
        </motion.div>
      </div>

      {/* Provider Status Row */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="flex flex-wrap gap-2"
      >
        <StatusBadge ok={h?.providers?.groq?.connected ?? false}       label="Groq LPU"       icon={Zap} />
        <StatusBadge ok={h?.providers?.openrouter?.connected ?? false} label="OpenRouter"      icon={Globe} />
        <StatusBadge ok={h?.providers?.huggingface?.connected ?? (h?.huggingface ?? false)} label="HuggingFace" icon={Brain} />
        <StatusBadge ok={h?.providers?.kimi?.connected ?? (h?.kimi ?? false)} label="Kimi K2"  icon={Cpu} />
        <StatusBadge ok={h?.providers?.ollama?.connected ?? (h?.ollama ?? false)} label="Ollama Local" icon={Server} />
        <StatusBadge ok={a?.running ?? false}      label="Auto-Training"  icon={Network} />
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={MessageSquare} label="Conversations"    value={s?.totalConversations ?? "—"} sub="total sessions"           color="text-blue-400"    delay={0.1} />
        <StatCard icon={Activity}      label="Messages"         value={s?.totalMessages ?? "—"}      sub="across all chats"          color="text-violet-400"  delay={0.15} />
        <StatCard icon={Database}      label="Knowledge Docs"   value={s?.totalDocuments ?? "—"}     sub={s?.embeddingCoverage != null ? `${s.embeddingCoverage}% vector-embedded` : "indexed in RAG"} color="text-amber-400"   delay={0.2} />
        <StatCard icon={Brain}         label="Training Samples" value={s?.totalTrainingSamples?.toLocaleString() ?? a?.totalSamplesAdded?.toLocaleString() ?? "—"} sub="in database" color="text-emerald-400" delay={0.25} />
      </div>

      {/* Resource Monitor */}
      <ResourceMonitor />

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {/* System Info */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">System Status</h2>
            {health.isLoading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin ml-auto" />}
          </div>
          <div className="space-y-2.5 font-mono text-sm">
            {[
              { k: "Status",         v: <span className="text-emerald-400">● online</span> },
              { k: "Engine",         v: <span className="text-primary">{h?.engine || "Ollama (local)"}</span> },
              { k: "API Version",    v: <span className="text-slate-300">{h?.version || "1.0.0"}</span> },
              { k: "Server Uptime",  v: <span className="text-slate-300">{h?.uptime ? formatUptime(h.uptime) : "—"}</span> },
              { k: "Auto-Training",  v: a?.running
                  ? <span className="text-emerald-400">● active · {a.totalCyclesCompleted} cycles</span>
                  : <span className="text-slate-500">○ paused</span> },
              { k: "HF Token",       v: h?.huggingface
                  ? <span className="text-emerald-400">● connected (embeddings + images)</span>
                  : <span className="text-amber-400">○ not set</span> },
              { k: "Groq LPU",       v: h?.providers?.groq?.connected
                  ? <span className="text-emerald-400">● ready (fastest)</span>
                  : <span className="text-slate-500">○ no key</span> },
              { k: "OpenRouter",     v: h?.providers?.openrouter?.connected
                  ? <span className="text-emerald-400">● ready (free tier)</span>
                  : <span className="text-slate-500">○ no key</span> },
              { k: "Kimi K2",        v: h?.providers?.kimi?.connected ?? h?.kimi
                  ? <span className="text-emerald-400">● ready (1T MoE)</span>
                  : <span className="text-slate-500">○ no key</span> },
              { k: "Vector Search",  v: s?.embeddingCoverage != null
                  ? <span className="text-emerald-400">● pgvector · {s.embeddingCoverage}% docs embedded</span>
                  : <span className="text-slate-500">—</span> },
              { k: "Ollama Models",  v: <span className="text-cyan-400">{s?.ollamaModels ?? h?.ollama ? "—" : "0"} installed</span> },
              { k: "Training Rate",  v: <span className="text-slate-300">{a?.totalCyclesCompleted ? `~${Math.round((a.totalSamplesAdded || 0) / a.totalCyclesCompleted)}/cycle` : "—"}</span> },
            ].map(({ k, v }) => (
              <div key={k} className="flex items-center justify-between py-1.5 border-b border-white/3 last:border-0">
                <span className="text-slate-500 text-xs">{k}</span>
                <span className="text-xs">{v}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Auto-Training Sources */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Training Sources</h2>
            <div className={cn(
              "ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium",
              a?.running ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/50 text-slate-500"
            )}>
              {a?.running ? "● live" : "paused"}
            </div>
          </div>
          {a?.sources ? (
            <div className="space-y-2">
              {a.sources.map((src) => {
                const Icon = sourceIcons[src] || Globe;
                const count = a.sourceStats?.[src] || 0;
                const total = a.totalSamplesAdded || 1;
                const pct   = Math.round((count / total) * 100);
                return (
                  <div key={src} className="flex items-center gap-3">
                    <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", sourceColors[src] || "text-slate-400")} />
                    <span className="text-xs text-slate-400 w-24 capitalize">{src}</span>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-700", (sourceColors[src] || "text-slate-400").replace("text-", "bg-"))}
                        style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 font-mono w-10 text-right">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500 text-center py-6">Loading training sources…</div>
          )}
          {a?.nextCycleAt && (
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              <span>Next cycle {formatDistanceToNow(new Date(a.nextCycleAt), { addSuffix: true })}</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* Activity Feed */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-xl border border-white/5 bg-slate-900/60 p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-white">Live Activity Feed</h2>
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono">
            {a?.activityLog?.length || 0} events
          </span>
          {at.isFetching && <RefreshCw className="w-3.5 h-3.5 text-slate-600 animate-spin ml-auto" />}
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0 pr-1 scrollbar-thin">
          {a?.activityLog?.length ? (
            a.activityLog.slice(0, 30).map((entry, i) => (
              <ActivityEntry key={i} msg={entry.msg} type={entry.type} at={entry.at} />
            ))
          ) : (
            <div className="text-sm text-slate-600 text-center py-8 font-mono">
              No activity yet — start auto-training to see live events
            </div>
          )}
        </div>
      </motion.div>

      {/* Quick Links */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {[
          { href: "/chat",     label: "Start Chat",       icon: MessageSquare, color: "emerald" },
          { href: "/rag",      label: "Add Knowledge",    icon: Database,      color: "violet" },
          { href: "/training", label: "Training Hub",     icon: Network,       color: "amber" },
          { href: "/api-docs", label: "API Reference",    icon: BookOpen,      color: "blue" },
        ].map(({ href, label, icon: Icon, color }) => (
          <a
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-150 hover:-translate-y-0.5",
              `bg-${color}-500/5 border-${color}-500/15 hover:bg-${color}-500/10 hover:border-${color}-500/25`
            )}
          >
            <Icon className={`w-4 h-4 text-${color}-400`} />
            <span className={`text-xs font-medium text-${color}-300`}>{label}</span>
          </a>
        ))}
      </motion.div>
    </div>
  );
}
