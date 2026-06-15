import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Activity, Database, MessageSquare, Network, Cpu, Clock,
  Globe, Brain, Zap, TrendingUp, BookOpen,
  Server, Layers, BarChart3, RefreshCw, Terminal, GitBranch,
  CheckCircle2, AlertCircle, Loader2, HardDrive, MemoryStick,
  Microchip,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Data hooks ────────────────────────────────────────────────────────────────
function useHealth() {
  return useQuery({
    queryKey: ["v1-health"],
    queryFn: () => fetch(`${BASE}/api/v1/health`).then((r) => r.json()) as Promise<{
      status: string; version: string; engine: string; uptime: number;
      ollama: boolean; huggingface: boolean; kimi: boolean;
      providers?: {
        groq?:        { connected: boolean };
        openrouter?:  { connected: boolean };
        huggingface?: { connected: boolean };
        kimi?:        { connected: boolean };
        ollama?:      { connected: boolean };
      };
    }>,
    refetchInterval: 15_000,
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
  cpu:     { usagePercent: number; cores: number; model: string };
  ram:     { totalMB: number; usedMB: number; freeMB: number; availableMB: number; cachedMB: number; usedPercent: number; swap: { totalMB: number; usedMB: number } };
  disk:    { totalGB: number; usedGB: number; freeGB: number; usedPercent: number };
  process: { pid: number; memoryMB: number; uptimeSec: number; nodeVersion: string };
  system:  { uptimeSec: number };
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
function formatUptime(s: number) {
  s = Math.round(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// ── Resource bar ──────────────────────────────────────────────────────────────
function ResourceBar({ label, pct, detail, sub, icon: Icon, loading }: {
  label: string; pct: number; detail: string; sub?: string;
  icon: React.ElementType; loading?: boolean;
}) {
  const c = Math.min(100, Math.max(0, pct));
  const barColor = c >= 90 ? "bg-red-500" : c >= 70 ? "bg-amber-400" : "bg-primary";
  const textColor = c >= 90 ? "text-red-400" : c >= 70 ? "text-amber-400" : "text-foreground";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        {loading
          ? <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
          : <span className={cn("text-sm font-semibold tabular-nums", textColor)}>{c}%</span>
        }
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", barColor)}
          initial={{ width: 0 }}
          animate={{ width: `${c}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">{detail}</span>
        {sub && <span className="text-xs text-muted-foreground/60 truncate max-w-[140px] text-right">{sub}</span>}
      </div>
    </div>
  );
}

// ── Resource Monitor ──────────────────────────────────────────────────────────
function ResourceMonitor() {
  const { data: r, isLoading, isFetching, dataUpdatedAt } = useResources();
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID") : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
      className="bg-card border border-border rounded-xl p-5"
    >
      <div className="flex items-center gap-2 mb-5">
        <Microchip className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Resource Monitor</h2>
        <span className="text-xs text-muted-foreground/50 ml-1">live</span>
        <div className="ml-auto flex items-center gap-2">
          {isFetching && <RefreshCw className="w-3 h-3 text-muted-foreground/50 animate-spin" />}
          {lastUpdated && <span className="text-xs text-muted-foreground/40">{lastUpdated}</span>}
        </div>
      </div>
      <div className="space-y-4">
        <ResourceBar label="CPU"  pct={r?.cpu?.usagePercent ?? 0}  icon={Cpu}        loading={isLoading}
          detail={`${r?.cpu?.usagePercent ?? 0}% · ${r?.cpu?.cores ?? 0} cores`}
          sub={r?.cpu?.model?.split(" ").slice(0, 3).join(" ")} />
        <ResourceBar label="RAM"  pct={r?.ram?.usedPercent ?? 0}   icon={MemoryStick} loading={isLoading}
          detail={`${r?.ram ? (r.ram.usedMB/1024).toFixed(1) : "—"} / ${r?.ram ? (r.ram.totalMB/1024).toFixed(1) : "—"} GB`}
          sub={r?.ram ? `${(r.ram.availableMB/1024).toFixed(1)} GB free` : undefined} />
        <ResourceBar label="Disk" pct={r?.disk?.usedPercent ?? 0}  icon={HardDrive}   loading={isLoading}
          detail={`${r?.disk?.usedGB ?? "—"} / ${r?.disk?.totalGB ?? "—"} GB`}
          sub={r?.disk ? `${r.disk.freeGB} GB free` : undefined} />
      </div>
      {r?.process && (
        <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-x-6 gap-y-1.5">
          {[
            ["API RAM",    `${r.process.memoryMB} MB`],
            ["Uptime",     formatUptime(r.system?.uptimeSec ?? 0)],
            ["Node.js",    r.process.nodeVersion],
            ["PID",        String(r.process.pid)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="text-xs font-medium text-foreground tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, delay = 0 }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}
      className="bg-card border border-border rounded-xl p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
    </motion.div>
  );
}

// ── Provider chip ─────────────────────────────────────────────────────────────
function ProviderChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
      ok ? "bg-card border-border text-foreground" : "bg-muted/50 border-border text-muted-foreground/60"
    )}>
      <svg width="6" height="6" viewBox="0 0 6 6">
        <circle cx="3" cy="3" r="2.5" fill={ok ? "hsl(155 60% 50%)" : "hsl(0 0% 30%)"} />
      </svg>
      {label}
    </div>
  );
}

// ── Activity entry ────────────────────────────────────────────────────────────
function ActivityEntry({ msg, type, at }: { msg: string; type: string; at: string }) {
  const dot =
    type === "success" ? "bg-emerald-400" :
    type === "error"   ? "bg-red-400"     :
    type === "warn"    ? "bg-amber-400"   : "bg-primary/60";

  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-border/50 last:border-0">
      <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0", dot)} />
      <span className="text-xs text-muted-foreground flex-1 leading-relaxed break-words min-w-0">{msg}</span>
      <span className="text-xs text-muted-foreground/40 flex-shrink-0 whitespace-nowrap">
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

  const h = health.data;
  const a = at.data;
  const s = stats.data;

  const sourceIcons: Record<string, React.ElementType> = {
    wikipedia: Globe, hackernews: Terminal, reddit: MessageSquare,
    arxiv: BookOpen, rss: Layers, huggingface: Brain, curated: Cpu, github: GitBranch,
  };

  return (
    <div className="min-h-full p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            className="text-xl sm:text-2xl font-bold text-foreground"
          >
            Dashboard
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
            className="text-sm text-muted-foreground mt-0.5"
          >
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </motion.p>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border"
        >
          <svg width="6" height="6" viewBox="0 0 6 6">
            <circle cx="3" cy="3" r="2.5" fill="hsl(155 60% 50%)">
              <animate attributeName="opacity" values="1;0.4;1" dur="2.5s" repeatCount="indefinite" />
            </circle>
          </svg>
          <span className="text-xs font-medium text-foreground">Online</span>
        </motion.div>
      </div>

      {/* Provider status */}
      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
        className="flex flex-wrap gap-1.5"
      >
        <ProviderChip ok={h?.providers?.groq?.connected ?? false}       label="Groq" />
        <ProviderChip ok={h?.providers?.openrouter?.connected ?? false} label="OpenRouter" />
        <ProviderChip ok={h?.providers?.huggingface?.connected ?? (h?.huggingface ?? false)} label="HuggingFace" />
        <ProviderChip ok={h?.providers?.kimi?.connected ?? (h?.kimi ?? false)} label="Kimi K2" />
        <ProviderChip ok={h?.providers?.ollama?.connected ?? (h?.ollama ?? false)} label="Ollama" />
        <ProviderChip ok={a?.running ?? false} label="Auto-Training" />
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={MessageSquare} label="Conversations"    value={s?.totalConversations ?? "—"}     sub="total sessions"        delay={0.08} />
        <StatCard icon={Activity}      label="Messages"         value={s?.totalMessages ?? "—"}          sub="across all chats"      delay={0.12} />
        <StatCard icon={Database}      label="Knowledge Docs"   value={s?.totalDocuments ?? "—"}         sub={s?.embeddingCoverage != null ? `${s.embeddingCoverage}% embedded` : "indexed in RAG"} delay={0.16} />
        <StatCard icon={Brain}         label="Training Samples" value={(s?.totalTrainingSamples ?? a?.totalSamplesAdded ?? 0).toLocaleString()} sub="in database" delay={0.2} />
      </div>

      {/* Resource monitor */}
      <ResourceMonitor />

      {/* System info + Training sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* System Info */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-card border border-border rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">System Status</h2>
            {health.isLoading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin ml-auto" />}
          </div>
          <div className="space-y-0">
            {[
              { k: "Status",        v: <span className="text-emerald-400 font-medium">Online</span> },
              { k: "Engine",        v: <span className="text-foreground">{h?.engine || "Ollama (local)"}</span> },
              { k: "Version",       v: <span className="text-foreground">{h?.version || "1.0.0"}</span> },
              { k: "Server Uptime", v: <span className="text-foreground">{h?.uptime ? formatUptime(h.uptime) : "—"}</span> },
              { k: "Auto-Training", v: a?.running
                  ? <span className="text-primary font-medium">{a.totalCyclesCompleted} cycles completed</span>
                  : <span className="text-muted-foreground">Paused</span> },
              { k: "HF Token",     v: h?.huggingface
                  ? <span className="text-emerald-400">Connected</span>
                  : <span className="text-amber-400">Not set</span> },
              { k: "Groq",         v: h?.providers?.groq?.connected
                  ? <span className="text-emerald-400">Ready</span>
                  : <span className="text-muted-foreground">No API key</span> },
              { k: "OpenRouter",   v: h?.providers?.openrouter?.connected
                  ? <span className="text-emerald-400">Ready</span>
                  : <span className="text-muted-foreground">No API key</span> },
              { k: "Kimi K2",      v: (h?.providers?.kimi?.connected ?? h?.kimi)
                  ? <span className="text-emerald-400">Ready</span>
                  : <span className="text-muted-foreground">No API key</span> },
              { k: "Vector Search",v: s?.embeddingCoverage != null
                  ? <span className="text-foreground">{s.embeddingCoverage}% docs embedded</span>
                  : <span className="text-muted-foreground">—</span> },
            ].map(({ k, v }) => (
              <div key={k} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-xs text-muted-foreground">{k}</span>
                <span className="text-xs text-right">{v}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Training sources */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="bg-card border border-border rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Training Sources</h2>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-medium",
              a?.running ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}>
              {a?.running ? "Live" : "Paused"}
            </span>
          </div>
          {a?.sources?.length ? (
            <div className="space-y-3">
              {a.sources.map((src) => {
                const Icon = sourceIcons[src] || Globe;
                const count = a.sourceStats?.[src] || 0;
                const total = Math.max(a.totalSamplesAdded || 1, 1);
                const pct   = Math.round((count / total) * 100);
                return (
                  <div key={src} className="flex items-center gap-3">
                    <Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/70" />
                    <span className="text-xs text-muted-foreground w-20 capitalize truncate">{src}</span>
                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full transition-all duration-700"
                           style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground/70 tabular-nums w-12 text-right">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">Loading sources…</div>
          )}
          {a?.nextCycleAt && (
            <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>Next cycle {formatDistanceToNow(new Date(a.nextCycleAt), { addSuffix: true })}</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* Activity Feed */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="bg-card border border-border rounded-xl p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Activity Feed</h2>
          {(a?.activityLog?.length ?? 0) > 0 && (
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {a!.activityLog.length}
            </span>
          )}
          {at.isFetching && <RefreshCw className="w-3 h-3 text-muted-foreground/50 animate-spin ml-auto" />}
        </div>
        <div className="max-h-52 overflow-y-auto scrollbar-thin">
          {a?.activityLog?.length ? (
            a.activityLog.slice(0, 30).map((e, i) => (
              <ActivityEntry key={i} msg={e.msg} type={e.type} at={e.at} />
            ))
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              No activity — start auto-training to see live events
            </div>
          )}
        </div>
      </motion.div>

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
      >
        {[
          { href: "/chat",     label: "Start Chat",    icon: MessageSquare },
          { href: "/rag",      label: "Add Knowledge", icon: Database      },
          { href: "/training", label: "Training Hub",  icon: Network       },
          { href: "/api-docs", label: "API Docs",      icon: BookOpen      },
        ].map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors group"
          >
            <Icon className="w-4 h-4 text-primary/70 group-hover:text-primary transition-colors" />
            <span className="text-xs font-medium text-foreground">{label}</span>
          </a>
        ))}
      </motion.div>

    </div>
  );
}
