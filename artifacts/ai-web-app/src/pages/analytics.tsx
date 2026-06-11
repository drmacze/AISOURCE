import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart, Legend,
} from "recharts";
import {
  BarChart2, MessageSquare, Database, Brain, TrendingUp, Activity,
  Cpu, Clock, Loader2, RefreshCw, HardDrive, Zap, Server, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── API base ────────────────────────────────────────────────────────────────
function getBase(): string {
  const env = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");
  if (env) return env;
  return window.location.port === "5000"
    ? `${window.location.protocol}//${window.location.hostname}:8080`
    : "";
}

const CHART_COLORS = ["#10b981","#3b82f6","#a855f7","#f59e0b","#ef4444","#06b6d4","#f97316","#84cc16"];

const TT = {
  contentStyle: { backgroundColor:"#0f172a", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", color:"#e2e8f0", fontSize:12 },
  labelStyle: { color:"#94a3b8" },
};

// ─── Types ───────────────────────────────────────────────────────────────────
interface AllData {
  overview: {
    conversations: number; messages: number; documents: number;
    trainingSamples: number; trainingJobs: number; registeredModels: number;
    embeddedDocuments: number; embeddingCoverage: number;
    totalTokensEstimated: number; autoTrainingCycles: number;
    autoTrainingSamples: number; autoTrainingRunning: boolean;
    uptime: number; uptimeHours: number;
  };
  msgsByDay: Array<{ day: string; total: number; user_messages: number; assistant_messages: number; tokens: number }>;
  sources: { total: number; sources: Array<{ source: string; count: number; percentage: number }> };
  models: Array<{ model: string; conversations: number }>;
  docStatus: { total: number; embedded: number; coverage: number };
  topConvs: Array<{ id: number; title: string; model: string; message_count: number; total_tokens: number }>;
  trainingJobs: Array<{ status: string; count: number }>;
  systemMetrics: {
    memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
    uptime: { seconds: number; formatted: string };
    node: { version: string; pid: number };
    database: { size: string };
    hf: { connected: boolean };
  };
  generatedAt: number;
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = "text-emerald-400" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card className="bg-slate-900/60 border-white/8">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-800/60">
            <Icon className={cn("w-4 h-4", color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-400 mb-0.5">{label}</div>
            <div className="text-xl font-bold text-white font-mono">{value}</div>
            {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton placeholder ────────────────────────────────────────────────────
function Skeleton({ h = "h-40" }: { h?: string }) {
  return <div className={cn("rounded-xl bg-slate-800/40 animate-pulse w-full", h)} />;
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [data, setData]     = useState<AllData | null>(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [period, setPeriod] = useState(30);
  const [ts, setTs]         = useState(Date.now());
  const BASE = getBase();

  const load = useCallback(async () => {
    setLoad(true); setError(null);
    try {
      const r = await fetch(`${BASE}/api/analytics/all?days=${period}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as AllData;
      setData(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoad(false);
    }
  }, [BASE, period]);

  useEffect(() => { load(); }, [load, ts]);

  const refresh = () => setTs(Date.now());

  const o  = data?.overview;
  const sm = data?.systemMetrics;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Analytics</h1>
              <p className="text-xs text-slate-400">
                {loading ? "Memuat…" : error ? "Error" : `Diperbarui ${new Date(data!.generatedAt).toLocaleTimeString("id-ID")}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {[7, 30, 90].map((d) => (
                <button key={d} onClick={() => setPeriod(d)}
                  className={cn("px-3 py-1.5 text-xs transition-all", period === d ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
                  {d}d
                </button>
              ))}
            </div>
            <Button onClick={refresh} variant="outline" size="sm"
              className="border-white/10 text-slate-300 hover:bg-white/5 h-8" disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">{error}</div>
      )}

      <div className="flex-1 p-6 space-y-6">
        {/* Overview cards — show skeleton while loading */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading ? Array.from({length:4}).map((_,i) => <Skeleton key={i} h="h-24" />) : <>
            <StatCard icon={MessageSquare} label="Conversations" value={o?.conversations ?? 0} sub={`${o?.messages ?? 0} messages`} color="text-blue-400" />
            <StatCard icon={Database}     label="Documents"     value={o?.documents ?? 0}     sub={`${o?.embeddingCoverage ?? 0}% embedded`} color="text-violet-400" />
            <StatCard icon={Brain}        label="Training Samples" value={(o?.trainingSamples ?? 0).toLocaleString()} sub={`${o?.autoTrainingSamples ?? 0} auto-trained`} color="text-amber-400" />
            <StatCard icon={Cpu}          label="Training Cycles" value={o?.autoTrainingCycles ?? 0} sub={o?.autoTrainingRunning ? "🟢 running" : "idle"} color="text-emerald-400" />
          </>}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading ? Array.from({length:4}).map((_,i) => <Skeleton key={i} h="h-24" />) : <>
            <StatCard icon={Server}      label="Heap RAM"      value={`${sm?.memory.heapUsedMB ?? 0} MB`}  sub={`of ${sm?.memory.heapTotalMB ?? 0} MB`} color="text-cyan-400" />
            <StatCard icon={HardDrive}   label="DB Size"       value={sm?.database.size ?? "—"}                                                       color="text-rose-400" />
            <StatCard icon={Activity}    label="Est. Tokens"   value={(o?.totalTokensEstimated ?? 0).toLocaleString()} sub="total generated"           color="text-pink-400" />
            <StatCard icon={Clock}       label="Uptime"        value={sm?.uptime.formatted ?? "—"}         sub={`Node ${sm?.node.version ?? ""}`}       color="text-orange-400" />
          </>}
        </div>

        {/* Messages over time */}
        <Card className="bg-slate-900/60 border-white/8">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              Pesan Per Hari (last {period} days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton h="h-48" /> : (data?.msgsByDay.length ?? 0) === 0 ? (
              <div className="h-48 flex items-center justify-center text-slate-500 text-sm">Belum ada data pesan</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data!.msgsByDay} margin={{ top:5, right:5, bottom:5, left:0 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tick={{ fill:"#64748b", fontSize:11 }} tickLine={false} />
                  <YAxis tick={{ fill:"#64748b", fontSize:11 }} tickLine={false} axisLine={false} />
                  <Tooltip {...TT} />
                  <Area type="monotone" dataKey="user_messages"      stroke="#3b82f6" fill="url(#g1)" strokeWidth={2} name="User" />
                  <Area type="monotone" dataKey="assistant_messages" stroke="#10b981" fill="url(#g2)" strokeWidth={2} name="Asisten" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Training samples by source */}
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Brain className="w-4 h-4 text-amber-400" />Training Samples by Source
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton h="h-48" /> : !(data?.sources.sources.length) ? (
                <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Belum ada data training</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data!.sources.sources.slice(0,8)} layout="vertical" margin={{ left:60, right:10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill:"#64748b", fontSize:11 }} tickLine={false} />
                    <YAxis dataKey="source" type="category" tick={{ fill:"#94a3b8", fontSize:10 }} tickLine={false} width={55} />
                    <Tooltip {...TT} />
                    <Bar dataKey="count" name="Samples" radius={[0,4,4,0]}>
                      {data!.sources.sources.slice(0,8).map((_,i) => <Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Conversations by model */}
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-violet-400" />Conversations by Model
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton h="h-48" /> : !(data?.models.length) ? (
                <div className="h-40 flex items-center justify-center text-slate-500 text-sm">Belum ada percakapan</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={data!.models} dataKey="conversations" nameKey="model" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
                      {data!.models.map((_,i) => <Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip {...TT} />
                    <Legend formatter={(v) => <span style={{ color:"#94a3b8", fontSize:11 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Provider latency hint */}
        <Card className="bg-slate-900/60 border-white/8">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />Provider Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton h="h-16" /> : (
              <div className="flex flex-wrap gap-3">
                {[
                  { name: "Groq LPU",      key: "groq",        hint: "llama-4-scout · qwen3-32b · 120B OSS",   ok: true  },
                  { name: "OpenRouter",     key: "openrouter",  hint: "deepseek-r1 · gemma3 · phi-4",           ok: true  },
                  { name: "HuggingFace",    key: "hf",          hint: "Qwen2.5-32B GPU inference",              ok: sm?.hf.connected ?? false },
                  { name: "Ollama Local",   key: "ollama",      hint: "tinyllama · offline fallback",           ok: true  },
                ].map((p) => (
                  <div key={p.key} className={cn(
                    "flex-1 min-w-[140px] p-3 rounded-lg border text-xs font-mono",
                    p.ok ? "border-emerald-500/25 bg-emerald-500/5" : "border-slate-700 bg-slate-800/40"
                  )}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={cn("w-1.5 h-1.5 rounded-full", p.ok ? "bg-emerald-400" : "bg-slate-600")} />
                      <span className="font-semibold text-white">{p.name}</span>
                    </div>
                    <span className="text-slate-400">{p.hint}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top conversations */}
        {!loading && (data?.topConvs.length ?? 0) > 0 && (
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />Top Conversations by Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data!.topConvs.slice(0,8).map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-xs text-slate-600 font-mono w-5 text-right">{i+1}</span>
                    <span className="flex-1 text-sm text-slate-300 truncate">{c.title || `Chat #${c.id}`}</span>
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs">{c.message_count} msg</Badge>
                    <span className="text-xs text-slate-500 font-mono">{c.total_tokens.toLocaleString()} tk</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Training jobs */}
        {!loading && (data?.trainingJobs.length ?? 0) > 0 && (
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" />Training Jobs by Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                {data!.trainingJobs.map((j) => {
                  const colors: Record<string,string> = {
                    completed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                    running:   "text-blue-400   bg-blue-500/10   border-blue-500/20",
                    failed:    "text-red-400    bg-red-500/10    border-red-500/20",
                    pending:   "text-amber-400  bg-amber-500/10  border-amber-500/20",
                  };
                  return (
                    <div key={j.status} className={cn("px-4 py-3 rounded-lg border text-center min-w-[100px]", colors[j.status] || "text-slate-400 bg-slate-800 border-slate-700")}>
                      <div className="text-2xl font-bold font-mono">{j.count}</div>
                      <div className="text-xs capitalize mt-0.5 opacity-80">{j.status}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
