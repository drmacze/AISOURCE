import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart, Legend,
} from "recharts";
import {
  BarChart2, MessageSquare, Database, Brain, TrendingUp, Activity,
  Cpu, Clock, Loader2, RefreshCw, HardDrive, Zap, Globe, Server, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const API_BASE = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");
function getApiBase() {
  if (API_BASE) return API_BASE;
  return window.location.port === "5000" ? `${window.location.protocol}//${window.location.hostname}:8080` : "";
}

async function get(path: string) {
  const r = await fetch(`${getApiBase()}/api${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const CHART_COLORS = ["#10b981", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#f97316", "#84cc16"];

function StatCard({ icon: Icon, label, value, sub, color = "text-emerald-400" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card className="bg-slate-900/60 border-white/8">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg bg-slate-800/60", color.replace("text-", "text-").replace("-4", "-4"))}>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">{children}</h2>;
}

const customTooltipStyle = {
  contentStyle: { backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: 12 },
  labelStyle: { color: "#94a3b8" },
};

export default function AnalyticsPage() {
  const [overview, setOverview]           = useState<Record<string, number> | null>(null);
  const [msgsByDay, setMsgsByDay]         = useState<Array<{ day: string; total: number; user_messages: number; assistant_messages: number; tokens: number }>>([]);
  const [sources, setSources]             = useState<{ sources: Array<{ source: string; count: number; percentage: number }> } | null>(null);
  const [models, setModels]               = useState<Array<{ model: string; conversations: number }>>([]);
  const [docStatus, setDocStatus]         = useState<{ total: number; embedded: number; coverage: number } | null>(null);
  const [sysMetrics, setSysMetrics]       = useState<Record<string, unknown> | null>(null);
  const [topConvs, setTopConvs]           = useState<Array<{ id: number; title: string; message_count: number; total_tokens: number }>>([]);
  const [trainingJobs, setTrainingJobs]   = useState<Array<{ status: string; count: number }>>([]);
  const [loading, setLoading]             = useState(true);
  const [period, setPeriod]               = useState(30);
  const [refreshAt, setRefreshAt]         = useState(Date.now());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      get("/analytics/overview").then(setOverview).catch(() => null),
      get(`/analytics/messages-by-day?days=${period}`).then((d) => setMsgsByDay(d.data || [])).catch(() => null),
      get("/analytics/samples-by-source").then(setSources).catch(() => null),
      get("/analytics/models-usage").then((d) => setModels(d.models || [])).catch(() => null),
      get("/analytics/documents-status").then(setDocStatus).catch(() => null),
      get("/analytics/system-metrics").then(setSysMetrics).catch(() => null),
      get("/analytics/top-conversations").then((d) => setTopConvs(d.conversations || [])).catch(() => null),
      get("/analytics/training-jobs").then((d) => setTrainingJobs(d.byStatus || [])).catch(() => null),
    ]).finally(() => setLoading(false));
  }, [period, refreshAt]);

  const refresh = () => setRefreshAt(Date.now());

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
    </div>
  );

  const memUsed = (sysMetrics?.memory as { heapUsedMB?: number })?.heapUsedMB ?? 0;
  const memTotal = (sysMetrics?.memory as { heapTotalMB?: number })?.heapTotalMB ?? 1;
  const uptimeStr = (sysMetrics?.uptime as { formatted?: string })?.formatted ?? "—";
  const ollamaModels = (sysMetrics?.ollama as { models?: number })?.models ?? 0;
  const dbSize = (sysMetrics?.database as { size?: string })?.size ?? "—";

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Analytics</h1>
              <p className="text-xs text-slate-400">Real data from your NEXUS_OS instance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {[7, 30, 90].map((d) => (
                <button key={d} onClick={() => setPeriod(d)} className={cn("px-3 py-1.5 text-xs transition-all", period === d ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
                  {d}d
                </button>
              ))}
            </div>
            <Button onClick={refresh} variant="outline" size="sm" className="border-white/10 text-slate-300 hover:bg-white/5 h-8">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6">
        {/* Overview stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MessageSquare} label="Conversations" value={overview?.conversations ?? 0} sub={`${overview?.messages ?? 0} messages`} color="text-blue-400" />
          <StatCard icon={Database} label="Documents" value={overview?.documents ?? 0} sub={`${overview?.embeddingCoverage ?? 0}% embedded`} color="text-violet-400" />
          <StatCard icon={Brain} label="Training Samples" value={(overview?.trainingSamples ?? 0).toLocaleString()} sub={`${overview?.autoTrainingSamples ?? 0} auto-trained`} color="text-amber-400" />
          <StatCard icon={Cpu} label="Ollama Models" value={ollamaModels} sub={`System online: ${uptimeStr}`} color="text-emerald-400" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Server} label="Memory Used" value={`${memUsed} MB`} sub={`of ${memTotal} MB heap`} color="text-cyan-400" />
          <StatCard icon={HardDrive} label="DB Size" value={dbSize} color="text-rose-400" />
          <StatCard icon={Activity} label="Est. Tokens" value={(overview?.totalTokensEstimated ?? 0).toLocaleString()} sub="total generated" color="text-pink-400" />
          <StatCard icon={TrendingUp} label="Auto-Training" value={overview?.autoTrainingCycles ?? 0} sub="cycles completed" color="text-orange-400" />
        </div>

        {/* Messages over time chart */}
        <Card className="bg-slate-900/60 border-white/8">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              Messages Over Time (last {period} days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {msgsByDay.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No message data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={msgsByDay} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <defs>
                    <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="asstGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip {...customTooltipStyle} />
                  <Area type="monotone" dataKey="user_messages" stroke="#3b82f6" fill="url(#msgGrad)" strokeWidth={2} name="User" />
                  <Area type="monotone" dataKey="assistant_messages" stroke="#10b981" fill="url(#asstGrad)" strokeWidth={2} name="Assistant" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Training samples by source */}
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Brain className="w-4 h-4 text-amber-400" />
                Training Samples by Source
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!sources?.sources?.length ? (
                <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No training data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sources.sources.slice(0, 8)} layout="vertical" margin={{ left: 60, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
                    <YAxis dataKey="source" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} width={55} />
                    <Tooltip {...customTooltipStyle} />
                    <Bar dataKey="count" name="Samples" radius={[0, 4, 4, 0]}>
                      {sources.sources.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Models usage */}
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-violet-400" />
                Conversations by Model
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!models.length ? (
                <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No conversations yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={models} dataKey="conversations" nameKey="model" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
                      {models.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip {...customTooltipStyle} />
                    <Legend formatter={(val) => <span style={{ color: "#94a3b8", fontSize: 11 }}>{val}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Document embedding status */}
        {docStatus && (
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Database className="w-4 h-4 text-violet-400" />
                Knowledge Base Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                    <span>Embedding Coverage</span>
                    <span className="text-slate-200">{docStatus.embedded} / {docStatus.total} documents</span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all" style={{ width: `${docStatus.coverage}%` }} />
                  </div>
                  <div className="text-right text-xs text-violet-400 mt-1">{docStatus.coverage}%</div>
                </div>
                <div className="text-2xl font-bold text-white font-mono">{docStatus.coverage}%</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top conversations */}
        {topConvs.length > 0 && (
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                Top Conversations by Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topConvs.slice(0, 8).map((conv, i) => (
                  <div key={conv.id} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-xs text-slate-600 font-mono w-5 text-right">{i + 1}</span>
                    <span className="flex-1 text-sm text-slate-300 truncate">{conv.title || `Conversation #${conv.id}`}</span>
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-xs">{conv.message_count} msgs</Badge>
                    <span className="text-xs text-slate-500 font-mono">{Number(conv.total_tokens || 0).toLocaleString()} tk</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Training jobs status */}
        {trainingJobs.length > 0 && (
          <Card className="bg-slate-900/60 border-white/8">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" />
                Training Jobs by Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                {trainingJobs.map((job) => {
                  const colors: Record<string, string> = { completed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", running: "text-blue-400 bg-blue-500/10 border-blue-500/20", failed: "text-red-400 bg-red-500/10 border-red-500/20", pending: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
                  const c = colors[job.status] || "text-slate-400 bg-slate-500/10 border-slate-500/20";
                  return (
                    <div key={job.status} className={cn("px-4 py-3 rounded-lg border text-center min-w-[100px]", c)}>
                      <div className="text-2xl font-bold font-mono">{job.count}</div>
                      <div className="text-xs capitalize mt-0.5 opacity-80">{job.status}</div>
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
