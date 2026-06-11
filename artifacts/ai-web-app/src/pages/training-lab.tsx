import { useState, useEffect, useCallback } from "react";
import {
  FlaskConical, Cpu, BarChart3, Bot, ThumbsUp, Globe, TrendingUp,
  Settings2, Play, RefreshCw, Download, Upload, Plus, Trash2, Eye,
  CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  Database, Zap, Star, Shield, BookOpen, GitBranch, Target, Layers,
  Activity, Clock, HelpCircle, Copy, Check,
} from "lucide-react";

// ─── API Helper ───────────────────────────────────────────────────────────────

function getApiBase() {
  return "";
}

const BASE = () => (window as Window & { _apiBase?: string })._apiBase || getApiBase();

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}/api${path}`, {
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Common UI helpers ────────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon: Icon, label, badge }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        active
          ? "bg-green-500/20 text-green-300 border border-green-500/30"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="bg-green-500 text-black text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{badge}</span>
      )}
    </button>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-800/60 border border-slate-700/40 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, color = "text-green-400" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card className="text-center">
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-sm text-slate-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </Card>
  );
}

function Btn({ children, onClick, loading, variant = "primary", size = "md", disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md"; disabled?: boolean; className?: string;
}) {
  const base = "inline-flex items-center gap-2 rounded-lg font-medium transition-all disabled:opacity-50";
  const sz = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm";
  const v = {
    primary: "bg-green-500 hover:bg-green-400 text-black",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    danger: "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30",
    ghost: "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50",
  }[variant];
  return (
    <button className={`${base} ${sz} ${v} ${className}`} onClick={onClick} disabled={disabled || loading}>
      {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    online: "bg-green-500/20 text-green-400 border-green-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    offline: "bg-red-500/20 text-red-400 border-red-500/30",
    degraded: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    excellent: "bg-green-500/20 text-green-400 border-green-500/30",
    good: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    fair: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    poor: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const cls = map[status] || "bg-slate-700/50 text-slate-400 border-slate-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>
  );
}

function Alert({ type, message }: { type: "error" | "success" | "info" | "warning"; message: string }) {
  const map = {
    error: { cls: "bg-red-500/10 border-red-500/30 text-red-400", Icon: XCircle },
    success: { cls: "bg-green-500/10 border-green-500/30 text-green-400", Icon: CheckCircle },
    info: { cls: "bg-blue-500/10 border-blue-500/30 text-blue-400", Icon: HelpCircle },
    warning: { cls: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400", Icon: AlertTriangle },
  }[type];
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${map.cls}`}>
      <map.Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SimpleChart({ data, label = "loss" }: { data: Array<{ step?: number; epoch?: number; loss?: number; [k: string]: unknown }>; label?: string }) {
  if (!data.length) return <div className="text-slate-500 text-sm text-center py-8">No data yet</div>;
  const values = data.map((d) => (d[label] as number) || 0).filter((v) => isFinite(v));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 600, h = 120, pad = 8;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 80 }}>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={pts.join(" ")} fill="none" stroke="#22c55e" strokeWidth={2} strokeLinejoin="round" />
      <text x={pad} y={h - 2} fontSize={9} fill="#64748b">{min.toFixed(3)}</text>
      <text x={w - pad - 30} y={h - 2} fontSize={9} fill="#64748b">step {values.length}</text>
    </svg>
  );
}

// ─── Tab 1: Quality Lab ───────────────────────────────────────────────────────

type QualityReport = {
  total: number; avgQuality: number; distribution: { excellent: number; good: number; fair: number; poor: number };
  avgInputLen: number; avgOutputLen: number; sourceCounts: Record<string, number>;
  lowQualityCount: number; recommendation: string;
  scores?: Array<{ id: number; score: number }>;
};

type DatasetItem = { id: number; name: string; sampleCount: number; taskType: string };
type Snapshot = { id: number; datasetId: number; version: number; notes: string; sampleCount: number; createdAt: string };
type ActiveLearning = { totalSamples: number; suggestions: Array<{ priority: string; action: string; reason: string }>; coverageScore: number; topCoveredTopics: Array<{ word: string; count: number }> };

function QualityLabTab() {
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selectedDs, setSelectedDs] = useState<number>(0);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [augLoading, setAugLoading] = useState(false);
  const [augResult, setAugResult] = useState<{ created: number; strategy: string } | null>(null);
  const [augStrategy, setAugStrategy] = useState("paraphrase");
  const [augCount, setAugCount] = useState(5);
  const [bulkText, setBulkText] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapNotes, setSnapNotes] = useState("");
  const [alData, setAlData] = useState<ActiveLearning | null>(null);
  const [alLoading, setAlLoading] = useState(false);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [curriculumResult, setCurriculumResult] = useState<{ distribution: { easy: number; medium: number; hard: number } } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    api<DatasetItem[]>("/training-datasets").then(setDatasets).catch(console.error);
  }, []);

  const loadReport = async () => {
    if (!selectedDs) return;
    setLoading(true); setError(""); setReport(null);
    try {
      const r = await api<QualityReport>(`/training-datasets/${selectedDs}/quality-report`);
      setReport(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const loadSnapshots = async (dsId: number) => {
    if (!dsId) return;
    const snaps = await api<Snapshot[]>(`/training-datasets/${dsId}/snapshots`).catch(() => []);
    setSnapshots(snaps);
  };

  const runAugmentation = async () => {
    if (!selectedDs) return;
    setAugLoading(true); setError("");
    try {
      const r = await api<{ created: number; strategy: string }>(`/training-datasets/${selectedDs}/augment`, {
        method: "POST", body: JSON.stringify({ strategy: augStrategy, count: augCount }),
      });
      setAugResult(r); setSuccess(`Created ${r.created} augmented samples via ${r.strategy}`);
    } catch (e) { setError(String(e)); }
    finally { setAugLoading(false); }
  };

  const runBulkImport = async () => {
    if (!selectedDs || !bulkText.trim()) return;
    setBulkLoading(true); setError("");
    try {
      const r = await api<{ imported: number; skipped: number }>(`/training-datasets/${selectedDs}/bulk-import`, {
        method: "POST", body: JSON.stringify({ data: bulkText, format: "auto" }),
      });
      setBulkResult(r); setSuccess(`Imported ${r.imported} samples (${r.skipped} skipped)`);
      setBulkText("");
    } catch (e) { setError(String(e)); }
    finally { setBulkLoading(false); }
  };

  const createSnapshot = async () => {
    if (!selectedDs) return;
    setSnapLoading(true);
    try {
      await api(`/training-datasets/${selectedDs}/snapshots`, {
        method: "POST", body: JSON.stringify({ notes: snapNotes || undefined }),
      });
      setSnapNotes(""); await loadSnapshots(selectedDs);
      setSuccess("Snapshot created!");
    } catch (e) { setError(String(e)); }
    finally { setSnapLoading(false); }
  };

  const restoreSnapshot = async (snapId: number) => {
    if (!confirm("Restore this snapshot? This replaces all current samples.")) return;
    try {
      const r = await api<{ restored: number }>(`/training-datasets/${selectedDs}/snapshots/${snapId}/restore`, { method: "POST" });
      setSuccess(`Restored ${r.restored} samples from snapshot`);
    } catch (e) { setError(String(e)); }
  };

  const loadActiveLearning = async () => {
    if (!selectedDs) return;
    setAlLoading(true);
    try {
      const r = await api<ActiveLearning>(`/training-datasets/${selectedDs}/active-learning`);
      setAlData(r);
    } catch (e) { setError(String(e)); }
    finally { setAlLoading(false); }
  };

  const runCurriculum = async () => {
    if (!selectedDs) return;
    setCurriculumLoading(true);
    try {
      const r = await api<{ distribution: { easy: number; medium: number; hard: number } }>(`/training-datasets/${selectedDs}/curriculum-sort`, { method: "POST" });
      setCurriculumResult(r); setSuccess("Curriculum difficulty assigned to all samples");
    } catch (e) { setError(String(e)); }
    finally { setCurriculumLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Dataset selector */}
      <div className="flex items-center gap-3">
        <select
          value={selectedDs}
          onChange={(e) => { const v = +e.target.value; setSelectedDs(v); loadSnapshots(v); }}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
        >
          <option value={0}>— Select Dataset —</option>
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.sampleCount} samples)</option>)}
        </select>
        <Btn onClick={loadReport} loading={loading} disabled={!selectedDs}>Run Quality Report</Btn>
        <Btn variant="secondary" onClick={loadActiveLearning} loading={alLoading} disabled={!selectedDs}>Active Learning</Btn>
        <Btn variant="secondary" onClick={runCurriculum} loading={curriculumLoading} disabled={!selectedDs}>Curriculum Sort</Btn>
      </div>

      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* Quality Report */}
      {report && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-400" /> Quality Report
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard label="Avg Quality" value={`${report.avgQuality}%`} color={report.avgQuality >= 70 ? "text-green-400" : "text-yellow-400"} />
            <StatCard label="Total Samples" value={report.total} />
            <StatCard label="Low Quality" value={report.lowQualityCount} color="text-orange-400" />
            <StatCard label="Avg Input Len" value={report.avgInputLen} sub="chars" />
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {(["excellent", "good", "fair", "poor"] as const).map((k) => (
              <div key={k} className="text-center">
                <div className="text-lg font-bold font-mono text-slate-200">{report.distribution[k]}</div>
                <StatusBadge status={k} />
              </div>
            ))}
          </div>
          <Alert type={report.avgQuality >= 70 ? "success" : "warning"} message={report.recommendation} />
        </Card>
      )}

      {/* Curriculum Result */}
      {curriculumResult && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Curriculum Difficulty Distribution</h3>
          <div className="grid grid-cols-3 gap-3">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <div key={d} className="text-center">
                <div className="text-2xl font-bold font-mono text-slate-200">{curriculumResult.distribution[d]}</div>
                <div className="text-xs text-slate-400 capitalize">{d}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Active Learning */}
      {alData && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-400" /> Active Learning Insights
            </h3>
            <StatCard label="Coverage Score" value={`${alData.coverageScore}/100`} color="text-blue-400" />
          </div>
          <div className="space-y-2">
            {alData.suggestions.map((s, i) => (
              <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border text-sm ${
                s.priority === "high" ? "border-red-500/30 bg-red-500/5 text-red-300" :
                s.priority === "medium" ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-300" :
                "border-slate-600 bg-slate-700/30 text-slate-300"
              }`}>
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{s.action}</div>
                  <div className="text-xs opacity-70 mt-0.5">{s.reason}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="text-xs text-slate-500 mb-1">Top covered topics</div>
            <div className="flex flex-wrap gap-1">
              {alData.topCoveredTopics.slice(0, 10).map((t) => (
                <span key={t.word} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{t.word} ({t.count})</span>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Augmentation */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4 text-purple-400" /> Data Augmentation
        </h3>
        <div className="flex items-center gap-3">
          <select value={augStrategy} onChange={(e) => setAugStrategy(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="paraphrase">Paraphrase</option>
            <option value="variation">Variation</option>
            <option value="simplify">Simplify</option>
            <option value="expand">Expand</option>
          </select>
          <input type="number" min={1} max={20} value={augCount} onChange={(e) => setAugCount(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 w-20" placeholder="Count" />
          <Btn onClick={runAugmentation} loading={augLoading} disabled={!selectedDs}>Generate</Btn>
          {augResult && <span className="text-green-400 text-sm">✓ {augResult.created} created</span>}
        </div>
        <p className="text-xs text-slate-500 mt-2">Uses AI to create varied copies of existing samples. Increases dataset diversity.</p>
      </Card>

      {/* Bulk Import */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Upload className="w-4 h-4 text-cyan-400" /> Bulk Import (JSONL / CSV / Alpaca)
        </h3>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono h-28 resize-none"
          placeholder={`JSONL: {"input":"...", "output":"..."}\nCSV: input,output\nAlpaca: {"instruction":"...", "output":"..."}`}
        />
        <div className="flex items-center gap-3 mt-2">
          <Btn onClick={runBulkImport} loading={bulkLoading} disabled={!selectedDs || !bulkText.trim()}>Import</Btn>
          {bulkResult && <span className="text-green-400 text-sm">✓ {bulkResult.imported} imported, {bulkResult.skipped} skipped</span>}
        </div>
      </Card>

      {/* Version Snapshots */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-orange-400" /> Dataset Snapshots
        </h3>
        <div className="flex items-center gap-2 mb-3">
          <input value={snapNotes} onChange={(e) => setSnapNotes(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Snapshot notes (optional)" />
          <Btn onClick={createSnapshot} loading={snapLoading} disabled={!selectedDs}>Create Snapshot</Btn>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-slate-500 text-sm">No snapshots yet. Create one to save the current state.</p>
        ) : (
          <div className="space-y-2">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg">
                <div>
                  <div className="text-sm text-slate-200">v{s.version} — {s.notes}</div>
                  <div className="text-xs text-slate-500">{s.sampleCount} samples • {new Date(s.createdAt).toLocaleDateString()}</div>
                </div>
                <Btn variant="secondary" size="sm" onClick={() => restoreSnapshot(s.id)}>Restore</Btn>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab 2: Advanced Training ─────────────────────────────────────────────────

type HpSweep = { id: number; name: string; status: string; bestLoss?: number; bestConfig?: string; totalRuns: number; runs?: Array<{ learningRate: number; loraRank: number; epochs: number; loss?: number }> };
type QueueData = { queue: Array<{ id: number; modelId: number; datasetId: number; status: string; priority: number; createdAt: string }>; running: Array<{ id: number; status: string }>; total: number };
type Forecast = { estimates: { totalSteps: number; estimatedMinutes: number; ramRequiredGB: number; costEstimateUSD: number }; warnings: string[]; tips: string[] };

function AdvancedTrainingTab() {
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [models, setModels] = useState<Array<{ id: number; name: string }>>([]);
  const [sweeps, setSweeps] = useState<HpSweep[]>([]);
  const [queue, setQueue] = useState<QueueData | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // HP Sweep form
  const [sweepName, setSweepName] = useState("Sweep 1");
  const [sweepModel, setSweepModel] = useState<number>(0);
  const [sweepDs, setSweepDs] = useState<number>(0);
  const [sweepLRs, setSweepLRs] = useState("0.0002,0.0001");
  const [sweepRanks, setSweepRanks] = useState("8,16");
  const [sweepEpochs, setSweepEpochs] = useState("3");

  // Distillation form
  const [distStudent, setDistStudent] = useState<number>(0);
  const [distDs, setDistDs] = useState<number>(0);
  const [distTeacher, setDistTeacher] = useState("llama3.2");

  // Multi-task form
  const [mtModel, setMtModel] = useState<number>(0);
  const [mtDatasets, setMtDatasets] = useState<Array<{ datasetId: number; weight: number }>>([{ datasetId: 0, weight: 1 }]);

  // Forecast form
  const [fcModel, setFcModel] = useState<number>(0);
  const [fcDs, setFcDs] = useState<number>(0);
  const [fcEpochs, setFcEpochs] = useState(3);
  const [fcRank, setFcRank] = useState(16);

  useEffect(() => {
    api<DatasetItem[]>("/training-datasets").then(setDatasets).catch(console.error);
    api<Array<{ id: number; name: string }>>("/ai-models").then(setModels).catch(console.error);
    loadData();
  }, []);

  const loadData = async () => {
    const [swps, q] = await Promise.all([
      api<HpSweep[]>("/training/hp-sweeps").catch(() => [] as HpSweep[]),
      api<QueueData>("/training/queue").catch(() => null),
    ]);
    setSweeps(swps); setQueue(q);
  };

  const setLoad = (k: string, v: boolean) => setLoading((prev) => ({ ...prev, [k]: v }));

  const launchSweep = async () => {
    setLoad("sweep", true); setError("");
    try {
      const lrs = sweepLRs.split(",").map(Number).filter(Boolean);
      const ranks = sweepRanks.split(",").map(Number).filter(Boolean);
      const epochs = sweepEpochs.split(",").map(Number).filter(Boolean);
      await api("/training/hp-sweeps", {
        method: "POST",
        body: JSON.stringify({ name: sweepName, modelId: sweepModel, datasetId: sweepDs, searchSpace: { learningRates: lrs, loraRanks: ranks, epochs } }),
      });
      setSuccess(`HP Sweep launched with ${lrs.length * ranks.length * epochs.length} runs`);
      loadData();
    } catch (e) { setError(String(e)); }
    finally { setLoad("sweep", false); }
  };

  const launchDistill = async () => {
    setLoad("distill", true); setError("");
    try {
      await api("/training/distill", {
        method: "POST",
        body: JSON.stringify({ studentModelId: distStudent, datasetId: distDs, teacherModel: distTeacher }),
      });
      setSuccess("Knowledge distillation started in background");
    } catch (e) { setError(String(e)); }
    finally { setLoad("distill", false); }
  };

  const launchMultiTask = async () => {
    setLoad("mt", true); setError("");
    try {
      const valid = mtDatasets.filter((d) => d.datasetId > 0);
      await api("/training/multi-task", {
        method: "POST",
        body: JSON.stringify({ modelId: mtModel, datasetWeights: valid }),
      });
      setSuccess("Multi-task training started");
    } catch (e) { setError(String(e)); }
    finally { setLoad("mt", false); }
  };

  const runForecast = async () => {
    setLoad("forecast", true);
    try {
      const r = await api<Forecast>("/training/forecast", {
        method: "POST",
        body: JSON.stringify({ modelId: fcModel || undefined, datasetId: fcDs || undefined, epochs: fcEpochs, loraRank: fcRank }),
      });
      setForecast(r);
    } catch (e) { setError(String(e)); }
    finally { setLoad("forecast", false); }
  };

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* Training Queue */}
      {queue && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-400" /> Training Queue
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">{queue.total} pending</span>
          </h3>
          {queue.running.length > 0 && (
            <div className="mb-2 text-xs text-blue-400">🔵 {queue.running.length} job(s) currently running</div>
          )}
          {queue.queue.length === 0 ? (
            <p className="text-slate-500 text-sm">Queue is empty</p>
          ) : (
            <div className="space-y-1">
              {queue.queue.map((j) => (
                <div key={j.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg text-sm">
                  <span className="text-slate-300">Job #{j.id}</span>
                  <span className="text-slate-500 text-xs">Priority: {j.priority}/10</span>
                  <StatusBadge status={j.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* HP Sweep */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" /> Hyperparameter Sweep
        </h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input value={sweepName} onChange={(e) => setSweepName(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Sweep name" />
          <select value={sweepModel} onChange={(e) => setSweepModel(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Model —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={sweepDs} onChange={(e) => setSweepDs(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Dataset —</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input value={sweepLRs} onChange={(e) => setSweepLRs(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200"
            placeholder="Learning rates: 0.0002,0.0001" />
          <input value={sweepRanks} onChange={(e) => setSweepRanks(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200"
            placeholder="LoRA ranks: 8,16,32" />
          <input value={sweepEpochs} onChange={(e) => setSweepEpochs(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200"
            placeholder="Epochs: 2,3,5" />
        </div>
        <Btn onClick={launchSweep} loading={loading.sweep} disabled={!sweepModel || !sweepDs}>Launch Sweep</Btn>
        {sweeps.length > 0 && (
          <div className="mt-3 space-y-1">
            {sweeps.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg text-sm">
                <span className="text-slate-300">{s.name}</span>
                <span className="text-slate-500 text-xs">{s.totalRuns} runs</span>
                {s.bestLoss && <span className="text-green-400 text-xs font-mono">best loss: {s.bestLoss.toFixed(4)}</span>}
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Knowledge Distillation */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-400" /> Knowledge Distillation
        </h3>
        <p className="text-xs text-slate-500 mb-3">Teacher model generates responses → student model learns from them</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <select value={distStudent} onChange={(e) => setDistStudent(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Student Model —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={distDs} onChange={(e) => setDistDs(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Dataset —</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input value={distTeacher} onChange={(e) => setDistTeacher(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Teacher model (e.g. llama3.2)" />
        </div>
        <Btn onClick={launchDistill} loading={loading.distill} disabled={!distStudent || !distDs}>Start Distillation</Btn>
      </Card>

      {/* Multi-Task Training */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4 text-purple-400" /> Multi-Task Training
        </h3>
        <p className="text-xs text-slate-500 mb-3">Train on weighted mix from multiple datasets simultaneously</p>
        <select value={mtModel} onChange={(e) => setMtModel(+e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 mb-3 w-full">
          <option value={0}>— Model —</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {mtDatasets.map((d, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <select value={d.datasetId} onChange={(e) => {
              const next = [...mtDatasets]; next[i] = { ...next[i], datasetId: +e.target.value };
              setMtDatasets(next);
            }} className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
              <option value={0}>— Dataset —</option>
              {datasets.map((ds) => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
            </select>
            <input type="number" min={0.1} max={10} step={0.1} value={d.weight}
              onChange={(e) => { const next = [...mtDatasets]; next[i] = { ...next[i], weight: +e.target.value }; setMtDatasets(next); }}
              className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200" placeholder="weight" />
            {mtDatasets.length > 1 && (
              <Btn variant="ghost" size="sm" onClick={() => setMtDatasets(mtDatasets.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4" />
              </Btn>
            )}
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <Btn variant="ghost" size="sm" onClick={() => setMtDatasets([...mtDatasets, { datasetId: 0, weight: 1 }])}>
            <Plus className="w-4 h-4" /> Add Dataset
          </Btn>
          <Btn onClick={launchMultiTask} loading={loading.mt} disabled={!mtModel || mtDatasets.every((d) => !d.datasetId)}>
            Start Multi-Task
          </Btn>
        </div>
      </Card>

      {/* Resource Forecaster */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" /> Resource Forecaster
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <select value={fcModel} onChange={(e) => setFcModel(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Model (optional) —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={fcDs} onChange={(e) => setFcDs(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Dataset (optional) —</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input type="number" value={fcEpochs} onChange={(e) => setFcEpochs(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200" placeholder="Epochs" />
          <input type="number" value={fcRank} onChange={(e) => setFcRank(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200" placeholder="LoRA rank" />
        </div>
        <Btn onClick={runForecast} loading={loading.forecast}>Forecast</Btn>
        {forecast && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Est. Time" value={`${forecast.estimates.estimatedMinutes}m`} color="text-cyan-400" />
            <StatCard label="RAM Required" value={`${forecast.estimates.ramRequiredGB}GB`} color="text-yellow-400" />
            <StatCard label="Total Steps" value={forecast.estimates.totalSteps} />
            <StatCard label="Cost Est." value={`$${forecast.estimates.costEstimateUSD}`} color="text-green-400" />
          </div>
        )}
        {forecast?.warnings.map((w, i) => <Alert key={i} type="warning" message={w} />)}
      </Card>
    </div>
  );
}

// ─── Tab 3: Evaluation ────────────────────────────────────────────────────────

type BenchmarkSummary = { accuracy: number | null; avgLatencyMs: number; passed: number; total: number; grade: string };
type BenchmarkFull = { id: number; model: string; suite: string; results: Array<{ id: string; prompt: string; response: string; latencyMs: number; passed: boolean | null; task: string }>; summary: BenchmarkSummary };

function EvaluationTab() {
  const [benchModel, setBenchModel] = useState("tinyllama");
  const [benchSuite, setBenchSuite] = useState("standard");
  const [benchLoading, setBenchLoading] = useState(false);
  const [benchResult, setBenchResult] = useState<BenchmarkFull | null>(null);
  const [comparePrompt, setComparePrompt] = useState("Explain what a neural network is in one sentence.");
  const [compareModels, setCompareModels] = useState("tinyllama,llama3.2");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<{ results: Array<{ model: string; text: string; latencyMs: number | null; error: boolean }> } | null>(null);
  const [bleuPairs, setBleuPairs] = useState('[{"hypothesis":"The cat sat on the mat","reference":"A cat was sitting on the mat"}]');
  const [bleuResult, setBleuResult] = useState<{ summary: { avgBleu: number; avgRouge1: number; avgRouge2: number; interpretation: string } } | null>(null);
  const [bleuLoading, setBleuLoading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [perplexity, setPerplexity] = useState<{ perplexity: number | null; interpretation: string } | null>(null);
  const [ppxLoading, setPpxLoading] = useState(false);
  const [error, setError] = useState("");

  const runBenchmark = async () => {
    setBenchLoading(true); setError(""); setBenchResult(null);
    try {
      const r = await api<BenchmarkFull>("/training/benchmark", { method: "POST", body: JSON.stringify({ model: benchModel, suite: benchSuite }) });
      setBenchResult(r);
    } catch (e) { setError(String(e)); }
    finally { setBenchLoading(false); }
  };

  const runCompare = async () => {
    setCompareLoading(true); setError("");
    try {
      const models = compareModels.split(",").map((m) => m.trim()).filter(Boolean);
      const r = await api<typeof compareResult>("/training/compare-models", {
        method: "POST", body: JSON.stringify({ prompt: comparePrompt, models }),
      });
      setCompareResult(r);
    } catch (e) { setError(String(e)); }
    finally { setCompareLoading(false); }
  };

  const runBleu = async () => {
    setBleuLoading(true); setError("");
    try {
      const pairs = JSON.parse(bleuPairs);
      const r = await api<typeof bleuResult>("/training/score-bleu-rouge", { method: "POST", body: JSON.stringify({ pairs }) });
      setBleuResult(r);
    } catch (e) { setError(String(e)); }
    finally { setBleuLoading(false); }
  };

  const getPerplexity = async () => {
    if (!jobId) return;
    setPpxLoading(true);
    try {
      const r = await api<typeof perplexity>(`/training-jobs/${jobId}/perplexity`);
      setPerplexity(r);
    } catch (e) { setError(String(e)); }
    finally { setPpxLoading(false); }
  };

  const gradeColor = (g: string) => ({ A: "text-green-400", B: "text-cyan-400", C: "text-yellow-400", D: "text-orange-400", F: "text-red-400" }[g] || "text-slate-400");

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}

      {/* Benchmark Runner */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-400" /> Automated Benchmark Suite
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <input value={benchModel} onChange={(e) => setBenchModel(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Model name" />
          <select value={benchSuite} onChange={(e) => setBenchSuite(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="standard">Standard (8 tests)</option>
            <option value="code">Code (4 tests)</option>
            <option value="reasoning">Reasoning (2 tests)</option>
          </select>
          <Btn onClick={runBenchmark} loading={benchLoading}>Run Benchmark</Btn>
        </div>
        {benchResult && (
          <div>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div className="text-center">
                <div className={`text-3xl font-bold font-mono ${gradeColor(benchResult.summary.grade)}`}>{benchResult.summary.grade}</div>
                <div className="text-xs text-slate-400">Grade</div>
              </div>
              <StatCard label="Accuracy" value={benchResult.summary.accuracy !== null ? `${(benchResult.summary.accuracy * 100).toFixed(0)}%` : "N/A"} />
              <StatCard label="Passed" value={`${benchResult.summary.passed}/${benchResult.summary.total}`} />
              <StatCard label="Avg Latency" value={`${Math.round(benchResult.summary.avgLatencyMs)}ms`} color="text-cyan-400" />
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {benchResult.results.map((r) => (
                <div key={r.id} className="flex items-start gap-2 p-2 bg-slate-700/40 rounded-lg text-xs">
                  {r.passed === true ? <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 shrink-0" /> :
                    r.passed === false ? <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" /> :
                    <HelpCircle className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />}
                  <div className="flex-1">
                    <div className="text-slate-400">{r.prompt.slice(0, 60)}...</div>
                    <div className="text-slate-300 mt-0.5">{r.response.slice(0, 100)}</div>
                  </div>
                  <span className="text-slate-500 shrink-0">{r.latencyMs}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Model Comparison */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-400" /> Model Comparison
        </h3>
        <textarea value={comparePrompt} onChange={(e) => setComparePrompt(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 h-16 resize-none mb-2"
          placeholder="Enter prompt to compare across models..." />
        <div className="flex items-center gap-3 mb-3">
          <input value={compareModels} onChange={(e) => setCompareModels(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200"
            placeholder="Models: tinyllama,llama3.2,ollama:codellama" />
          <Btn onClick={runCompare} loading={compareLoading}>Compare</Btn>
        </div>
        {compareResult && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {compareResult.results.map((r) => (
              <div key={r.model} className="bg-slate-700/40 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-green-400">{r.model}</span>
                  {r.latencyMs && <span className="text-xs text-slate-500">{r.latencyMs}ms</span>}
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{r.error ? <span className="text-red-400">{r.text}</span> : r.text}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Perplexity */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" /> Perplexity Calculator
        </h3>
        <div className="flex items-center gap-3">
          <input value={jobId} onChange={(e) => setJobId(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 w-32"
            placeholder="Job ID" />
          <Btn onClick={getPerplexity} loading={ppxLoading} disabled={!jobId}>Calculate</Btn>
          {perplexity && (
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold font-mono text-cyan-400">{perplexity.perplexity?.toFixed(2) || "N/A"}</span>
              <span className="text-sm text-slate-400">{perplexity.interpretation}</span>
            </div>
          )}
        </div>
      </Card>

      {/* BLEU/ROUGE */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-orange-400" /> BLEU / ROUGE Scorer
        </h3>
        <textarea value={bleuPairs} onChange={(e) => setBleuPairs(e.target.value)}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 h-20 resize-none mb-2"
          placeholder='[{"hypothesis":"...", "reference":"..."}]' />
        <Btn onClick={runBleu} loading={bleuLoading}>Score</Btn>
        {bleuResult && (
          <div className="mt-3 grid grid-cols-4 gap-3">
            <StatCard label="Avg BLEU" value={bleuResult.summary.avgBleu.toFixed(4)} color="text-blue-400" />
            <StatCard label="Avg ROUGE-1" value={bleuResult.summary.avgRouge1.toFixed(4)} color="text-purple-400" />
            <StatCard label="Avg ROUGE-2" value={bleuResult.summary.avgRouge2.toFixed(4)} color="text-purple-300" />
            <div className="col-span-1 flex items-center"><Alert type={bleuResult.summary.avgBleu > 0.3 ? "success" : "warning"} message={bleuResult.summary.interpretation} /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab 4: Model Hub ─────────────────────────────────────────────────────────

function ModelHubTab() {
  const [models, setModels] = useState<Array<{ id: number; name: string; type: string; status: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<number>(0);
  const [modelCard, setModelCard] = useState("");
  const [editingCard, setEditingCard] = useState(false);
  const [checkpoints, setCheckpoints] = useState<{ checkpoints: Array<{ id: number; epoch: number; loss?: number; createdAt: string }>; fsCheckpoints: Array<{ path: string; name: string }> } | null>(null);
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Merge form
  const [mergeModel1, setMergeModel1] = useState<number>(0);
  const [mergeModel2, setMergeModel2] = useState<number>(0);
  const [mergeMethod, setMergeMethod] = useState("slerp");
  const [mergeName, setMergeName] = useState("merged_model");

  // Export form
  const [exportFormat, setExportFormat] = useState("adapter");

  useEffect(() => {
    api<Array<{ id: number; name: string; type: string; status: string }>>("/ai-models").then(setModels).catch(console.error);
  }, []);

  const setLoad = (k: string, v: boolean) => setLoading((prev) => ({ ...prev, [k]: v }));

  const loadModelCard = async () => {
    if (!selectedModel) return;
    setLoad("card", true);
    try {
      const r = await api<{ modelCard: string }>(`/ai-models/${selectedModel}/model-card`);
      setModelCard(r.modelCard);
    } catch (e) { setError(String(e)); }
    finally { setLoad("card", false); }
  };

  const saveModelCard = async () => {
    if (!selectedModel) return;
    await api(`/ai-models/${selectedModel}/model-card`, { method: "PUT", body: JSON.stringify({ modelCard }) });
    setEditingCard(false); setSuccess("Model card saved!");
  };

  const loadCheckpoints = async () => {
    if (!jobId) return;
    setLoad("cp", true);
    try {
      const r = await api<typeof checkpoints>(`/training-jobs/${jobId}/checkpoints`);
      setCheckpoints(r);
    } catch (e) { setError(String(e)); }
    finally { setLoad("cp", false); }
  };

  const exportModel = async () => {
    if (!selectedModel) return;
    setLoad("export", true);
    try {
      const r = await api<{ exportPaths: Record<string, string>; message: string }>(`/ai-models/${selectedModel}/export`, {
        method: "POST", body: JSON.stringify({ format: exportFormat }),
      });
      setSuccess(r.message);
    } catch (e) { setError(String(e)); }
    finally { setLoad("export", false); }
  };

  const mergeModels = async () => {
    setLoad("merge", true);
    try {
      const r = await api<{ mergedModel: { name: string }; message: string }>("/training/merge-models", {
        method: "POST",
        body: JSON.stringify({ name: mergeName, modelIds: [mergeModel1, mergeModel2], method: mergeMethod }),
      });
      setSuccess(r.message);
      api<Array<{ id: number; name: string; type: string; status: string }>>("/ai-models").then(setModels).catch(console.error);
    } catch (e) { setError(String(e)); }
    finally { setLoad("merge", false); }
  };

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* Model Card */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <FileIcon className="w-4 h-4 text-blue-400" /> Model Card Generator
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <select value={selectedModel} onChange={(e) => setSelectedModel(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Select Model —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Btn onClick={loadModelCard} loading={loading.card} disabled={!selectedModel}>Generate</Btn>
          {modelCard && <Btn variant="secondary" onClick={() => setEditingCard(!editingCard)}>{editingCard ? "Preview" : "Edit"}</Btn>}
          {editingCard && <Btn onClick={saveModelCard}>Save</Btn>}
        </div>
        {modelCard && (
          editingCard ? (
            <textarea value={modelCard} onChange={(e) => setModelCard(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 h-64 resize-none" />
          ) : (
            <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 font-mono overflow-auto max-h-64 whitespace-pre-wrap">{modelCard}</pre>
          )
        )}
      </Card>

      {/* Export */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Download className="w-4 h-4 text-green-400" /> Model Export
        </h3>
        <div className="flex items-center gap-3">
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="adapter">LoRA Adapter</option>
            <option value="hf_hub">HuggingFace Hub</option>
            <option value="zip">ZIP Archive</option>
          </select>
          <Btn onClick={exportModel} loading={loading.export} disabled={!selectedModel}>
            <Download className="w-4 h-4" /> Export
          </Btn>
        </div>
        <p className="text-xs text-slate-500 mt-2">Requires at least one completed training job for the selected model</p>
      </Card>

      {/* Model Merging */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-orange-400" /> Model Merging
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <select value={mergeModel1} onChange={(e) => setMergeModel1(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Model A —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={mergeModel2} onChange={(e) => setMergeModel2(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Model B —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={mergeMethod} onChange={(e) => setMergeMethod(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="slerp">SLERP</option>
            <option value="ties">TIES</option>
            <option value="linear">Linear</option>
          </select>
          <input value={mergeName} onChange={(e) => setMergeName(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Output name" />
        </div>
        <Btn onClick={mergeModels} loading={loading.merge} disabled={!mergeModel1 || !mergeModel2}>Merge Models</Btn>
        <p className="text-xs text-slate-500 mt-2">SLERP: spherical interpolation (best for 2 models) • TIES: task-specific sparsity (best for multiple) • Linear: simple weighted average</p>
      </Card>

      {/* Checkpoint Manager */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-purple-400" /> Checkpoint Manager
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <input value={jobId} onChange={(e) => setJobId(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 w-32"
            placeholder="Training Job ID" />
          <Btn onClick={loadCheckpoints} loading={loading.cp} disabled={!jobId}>Load Checkpoints</Btn>
        </div>
        {checkpoints && (
          <div>
            {checkpoints.checkpoints.length === 0 && checkpoints.fsCheckpoints.length === 0 ? (
              <p className="text-slate-500 text-sm">No checkpoints found for this job</p>
            ) : (
              <div className="space-y-1">
                {checkpoints.checkpoints.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg text-sm">
                    <span className="text-slate-300">Epoch {c.epoch}</span>
                    {c.loss && <span className="text-slate-400 font-mono text-xs">loss: {c.loss.toFixed(4)}</span>}
                    <span className="text-slate-500 text-xs">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
                {checkpoints.fsCheckpoints.map((c) => (
                  <div key={c.path} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg text-sm">
                    <span className="text-slate-300 font-mono text-xs">{c.name}</span>
                    <span className="text-slate-500 text-xs">filesystem</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab 5: RLHF & DPO ───────────────────────────────────────────────────────

function FileIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13,2 13,9 20,9" />
    </svg>
  );
}

type Preference = { id: number; input: string; chosenResponse: string; rejectedResponse?: string | null; feedback: string; rating?: number | null; model?: string | null; createdAt: string };
type PrefAnalytics = { total: number; thumbsUp: number; thumbsDown: number; approvalRate: number; modelStats: Array<{ model: string; up: number; down: number; total: number; approvalRate: number }>; dpoReadyPairs: number; avgRating: number | null };

function RlhfTab() {
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [analytics, setAnalytics] = useState<PrefAnalytics | null>(null);
  const [models, setModels] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [dpoModel, setDpoModel] = useState<number>(0);
  const [dpoEpochs, setDpoEpochs] = useState(1);

  // New preference form
  const [newInput, setNewInput] = useState("");
  const [newChosen, setNewChosen] = useState("");
  const [newRejected, setNewRejected] = useState("");
  const [newFeedback, setNewFeedback] = useState<"thumbs_up" | "thumbs_down" | "neutral">("thumbs_up");
  const [newRating, setNewRating] = useState(5);

  useEffect(() => {
    loadData();
    api<Array<{ id: number; name: string }>>("/ai-models").then(setModels).catch(console.error);
  }, []);

  const loadData = async () => {
    const [p, a] = await Promise.all([
      api<{ preferences: Preference[] }>("/training/preferences?limit=30").catch(() => ({ preferences: [] })),
      api<PrefAnalytics>("/training/preferences/analytics").catch(() => null),
    ]);
    setPrefs(p.preferences); setAnalytics(a);
  };

  const setLoad = (k: string, v: boolean) => setLoading((prev) => ({ ...prev, [k]: v }));

  const addPreference = async () => {
    if (!newInput || !newChosen) return;
    setLoad("add", true);
    try {
      await api("/training/preferences", {
        method: "POST",
        body: JSON.stringify({ input: newInput, chosenResponse: newChosen, rejectedResponse: newRejected || undefined, feedback: newFeedback, rating: newRating }),
      });
      setNewInput(""); setNewChosen(""); setNewRejected(""); setShowForm(false);
      setSuccess("Preference annotation added"); loadData();
    } catch (e) { setError(String(e)); }
    finally { setLoad("add", false); }
  };

  const deletePreference = async (id: number) => {
    await api(`/training/preferences/${id}`, { method: "DELETE" }).catch(console.error);
    loadData();
  };

  const launchDpo = async () => {
    if (!dpoModel) return;
    setLoad("dpo", true); setError("");
    try {
      const r = await api<{ job: { id: number }; pairs: number }>("/training/dpo", {
        method: "POST", body: JSON.stringify({ modelId: dpoModel, epochs: dpoEpochs }),
      });
      setSuccess(`DPO training started (Job #${r.job.id}) with ${r.pairs} preference pairs`);
    } catch (e) { setError(String(e)); }
    finally { setLoad("dpo", false); }
  };

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* Analytics */}
      {analytics && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-400" /> Preference Analytics
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <StatCard label="Total" value={analytics.total} />
            <StatCard label="Approval Rate" value={`${analytics.approvalRate}%`} color={analytics.approvalRate >= 70 ? "text-green-400" : "text-yellow-400"} />
            <StatCard label="DPO Ready" value={analytics.dpoReadyPairs} color="text-purple-400" sub="pairs with rejected" />
            <StatCard label="Avg Rating" value={analytics.avgRating?.toFixed(1) || "—"} color="text-cyan-400" />
          </div>
          {analytics.modelStats.length > 0 && (
            <div className="space-y-1">
              {analytics.modelStats.map((m) => (
                <div key={m.model} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg text-sm">
                  <span className="text-slate-300 font-mono">{m.model}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-green-400 text-xs">👍 {m.up}</span>
                    <span className="text-red-400 text-xs">👎 {m.down}</span>
                    <span className="text-slate-400 text-xs">{m.approvalRate}% approval</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* DPO Training */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-400" /> DPO Training
        </h3>
        <p className="text-xs text-slate-500 mb-3">Requires 10+ preference pairs with both chosen & rejected responses</p>
        <div className="flex items-center gap-3">
          <select value={dpoModel} onChange={(e) => setDpoModel(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Select Model —</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="number" min={1} max={5} value={dpoEpochs} onChange={(e) => setDpoEpochs(+e.target.value)}
            className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200" placeholder="Epochs" />
          <Btn onClick={launchDpo} loading={loading.dpo} disabled={!dpoModel}>Start DPO</Btn>
        </div>
      </Card>

      {/* Preference List + Add */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <ThumbsUp className="w-4 h-4 text-blue-400" /> Preference Annotations ({prefs.length})
          </h3>
          <Btn size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="w-4 h-4" /> Add
          </Btn>
        </div>

        {showForm && (
          <div className="space-y-2 mb-4 p-3 bg-slate-700/30 rounded-lg border border-slate-600">
            <textarea value={newInput} onChange={(e) => setNewInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 h-16 resize-none"
              placeholder="User input / prompt..." />
            <textarea value={newChosen} onChange={(e) => setNewChosen(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 h-16 resize-none"
              placeholder="Chosen (preferred) response..." />
            <textarea value={newRejected} onChange={(e) => setNewRejected(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 h-12 resize-none"
              placeholder="Rejected (inferior) response (optional but needed for DPO)..." />
            <div className="flex items-center gap-3">
              <select value={newFeedback} onChange={(e) => setNewFeedback(e.target.value as "thumbs_up" | "thumbs_down" | "neutral")}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
                <option value="thumbs_up">👍 Thumbs Up</option>
                <option value="thumbs_down">👎 Thumbs Down</option>
                <option value="neutral">😐 Neutral</option>
              </select>
              <input type="number" min={1} max={5} value={newRating} onChange={(e) => setNewRating(+e.target.value)}
                className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200" placeholder="Rating 1-5" />
              <Btn onClick={addPreference} loading={loading.add}>Save</Btn>
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {prefs.map((p) => (
            <div key={p.id} className="p-2 bg-slate-700/40 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs">{p.feedback === "thumbs_up" ? "👍" : p.feedback === "thumbs_down" ? "👎" : "😐"}</span>
                {p.rating && <span className="text-xs text-yellow-400">{"★".repeat(p.rating)}</span>}
                {p.model && <span className="text-xs text-slate-500 font-mono">{p.model}</span>}
                <Btn variant="ghost" size="sm" onClick={() => deletePreference(p.id)}><Trash2 className="w-3 h-3" /></Btn>
              </div>
              <div className="text-xs text-slate-400 truncate">{p.input}</div>
              <div className="text-xs text-green-400/80 truncate">✓ {p.chosenResponse}</div>
              {p.rejectedResponse && <div className="text-xs text-red-400/80 truncate">✗ {p.rejectedResponse}</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab 6: Data Sources ──────────────────────────────────────────────────────

type HfDataset = { id: string; downloads: number; likes: number; taskCategories?: string[] };
type MarketplaceDs = { id: string; name: string; description: string; task: string; size: string; quality: string; downloads: number };

function DataSourcesTab() {
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [hfQuery, setHfQuery] = useState("instruction following");
  const [hfResults, setHfResults] = useState<HfDataset[]>([]);
  const [hfLoading, setHfLoading] = useState(false);
  const [marketplace, setMarketplace] = useState<MarketplaceDs[]>([]);
  const [marketplaceLoaded, setMarketplaceLoaded] = useState(false);
  const [synTopic, setSynTopic] = useState("Python programming");
  const [synCount, setSynCount] = useState(10);
  const [synStyle, setSynStyle] = useState("qa");
  const [synDs, setSynDs] = useState<number>(0);
  const [synLoading, setSynLoading] = useState(false);
  const [importDs, setImportDs] = useState<number>(0);
  const [importLoading, setImportLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    api<DatasetItem[]>("/training-datasets").then(setDatasets).catch(console.error);
    api<{ datasets: MarketplaceDs[] }>("/training/marketplace").then((r) => {
      setMarketplace(r.datasets); setMarketplaceLoaded(true);
    }).catch(console.error);
  }, []);

  const searchHF = async () => {
    setHfLoading(true); setError("");
    try {
      const r = await api<{ datasets: HfDataset[] }>(`/hf/datasets/search?query=${encodeURIComponent(hfQuery)}&limit=15`);
      setHfResults(r.datasets);
    } catch (e) { setError(String(e)); }
    finally { setHfLoading(false); }
  };

  const importHF = async (hfId: string) => {
    if (!importDs) { setError("Select target dataset first"); return; }
    setImportLoading((p) => ({ ...p, [hfId]: true }));
    try {
      const r = await api<{ imported: number }>("/hf/datasets/import", {
        method: "POST", body: JSON.stringify({ datasetId: hfId, targetDatasetId: importDs, maxRows: 200 }),
      });
      setSuccess(`Imported ${r.imported} samples from ${hfId}`);
    } catch (e) { setError(String(e)); }
    finally { setImportLoading((p) => ({ ...p, [hfId]: false })); }
  };

  const generateSynthetic = async () => {
    if (!synDs) { setError("Select target dataset first"); return; }
    setSynLoading(true); setError("");
    try {
      const r = await api<{ created: number; provider: string }>(`/training-datasets/${synDs}/synthetic`, {
        method: "POST", body: JSON.stringify({ topic: synTopic, count: synCount, style: synStyle }),
      });
      setSuccess(`Generated ${r.created} samples via ${r.provider}`);
    } catch (e) { setError(String(e)); }
    finally { setSynLoading(false); }
  };

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* Target dataset selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">Import into:</span>
        <select value={importDs} onChange={(e) => setImportDs(+e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
          <option value={0}>— Select Target Dataset —</option>
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Synthetic Data Generator */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-green-400" /> Synthetic Data Generator
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <input value={synTopic} onChange={(e) => setSynTopic(e.target.value)}
            className="col-span-2 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Topic (e.g. Python programming, French cooking)" />
          <select value={synStyle} onChange={(e) => setSynStyle(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="qa">Q&A</option>
            <option value="instruction">Instruction</option>
            <option value="chat">Chat</option>
            <option value="code">Code</option>
            <option value="reasoning">Reasoning</option>
          </select>
          <input type="number" min={3} max={50} value={synCount} onChange={(e) => setSynCount(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Count" />
        </div>
        <div className="flex items-center gap-3">
          <select value={synDs} onChange={(e) => setSynDs(+e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value={0}>— Target Dataset —</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <Btn onClick={generateSynthetic} loading={synLoading} disabled={!synDs || !synTopic}>Generate with AI</Btn>
        </div>
      </Card>

      {/* HuggingFace Dataset Browser */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-orange-400" /> HuggingFace Dataset Browser
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <input value={hfQuery} onChange={(e) => setHfQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchHF()}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
            placeholder="Search HuggingFace datasets..." />
          <Btn onClick={searchHF} loading={hfLoading}>Search</Btn>
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {hfResults.map((ds) => (
            <div key={ds.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg">
              <div>
                <div className="text-sm text-slate-200 font-mono">{ds.id}</div>
                <div className="text-xs text-slate-500">↓{ds.downloads?.toLocaleString()} • ♥{ds.likes}</div>
              </div>
              <Btn size="sm" variant="secondary" loading={importLoading[ds.id]} onClick={() => importHF(ds.id)} disabled={!importDs}>
                Import
              </Btn>
            </div>
          ))}
        </div>
      </Card>

      {/* Dataset Marketplace */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-400" /> Curated Dataset Marketplace
        </h3>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {marketplace.map((ds) => (
            <div key={ds.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg">
              <div className="flex-1 min-w-0 mr-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200">{ds.name}</span>
                  <StatusBadge status={ds.quality} />
                </div>
                <div className="text-xs text-slate-500 truncate">{ds.description}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{ds.task}</span>
                  <span className="text-xs text-slate-500">{ds.size}</span>
                </div>
              </div>
              <Btn size="sm" variant="secondary" loading={importLoading[ds.id]} onClick={() => importHF(ds.id)} disabled={!importDs}>
                Import
              </Btn>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab 7: Analytics & Monitoring ───────────────────────────────────────────

type TrainingAnalytics = {
  summary: { totalJobs: number; completedJobs: number; failedJobs: number; successRate: number; totalDatasets: number; totalSamples: number; totalModels: number; activeModels: number; rlhfAnnotations: number; benchmarksRun: number };
  lossTrend: Array<{ date: string; loss: number; jobId: number }>;
  backendUsage: Record<string, number>;
  recentActivity: Array<{ type: string; action: string; time: string; id: number }>;
  datasetSizes: Array<{ name: string; samples: number; taskType: string }>;
};

type SourceHealth = { sources: Array<{ id: string; name: string; status: string; latencyMs: number; error?: string }>; online: number; total: number; healthPercent: number };

function AnalyticsMonitorTab() {
  const [analytics, setAnalytics] = useState<TrainingAnalytics | null>(null);
  const [health, setHealth] = useState<SourceHealth | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const loadAnalytics = async () => {
    setLoading((p) => ({ ...p, analytics: true }));
    try {
      const r = await api<TrainingAnalytics>("/training/analytics");
      setAnalytics(r);
    } catch (e) { console.error(e); }
    finally { setLoading((p) => ({ ...p, analytics: false })); }
  };

  const loadHealth = async () => {
    setLoading((p) => ({ ...p, health: true }));
    try {
      const r = await api<SourceHealth>("/training/source-health");
      setHealth(r);
    } catch (e) { console.error(e); }
    finally { setLoading((p) => ({ ...p, health: false })); }
  };

  useEffect(() => { loadAnalytics(); loadHealth(); }, []);

  return (
    <div className="space-y-4">
      {/* Summary */}
      {analytics && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-300">Training Analytics Overview</h3>
            <Btn size="sm" variant="ghost" onClick={loadAnalytics} loading={loading.analytics}><RefreshCw className="w-4 h-4" /></Btn>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total Jobs" value={analytics.summary.totalJobs} />
            <StatCard label="Success Rate" value={`${analytics.summary.successRate}%`} color={analytics.summary.successRate >= 70 ? "text-green-400" : "text-yellow-400"} />
            <StatCard label="Datasets" value={analytics.summary.totalDatasets} />
            <StatCard label="Total Samples" value={analytics.summary.totalSamples.toLocaleString()} color="text-cyan-400" />
            <StatCard label="RLHF Annotations" value={analytics.summary.rlhfAnnotations} color="text-purple-400" />
          </div>

          {/* Loss Trend Chart */}
          {analytics.lossTrend.length > 0 && (
            <Card>
              <h4 className="text-xs text-slate-400 mb-2 flex items-center gap-2"><TrendingUp className="w-3 h-3" /> Training Loss Trend</h4>
              <SimpleChart data={analytics.lossTrend} label="loss" />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>Job #{analytics.lossTrend[0]?.jobId}</span>
                <span>Latest: {analytics.lossTrend[analytics.lossTrend.length - 1]?.loss?.toFixed(4)}</span>
              </div>
            </Card>
          )}

          {/* Dataset Sizes */}
          {analytics.datasetSizes.length > 0 && (
            <Card>
              <h4 className="text-xs text-slate-400 mb-2">Dataset Sizes</h4>
              <div className="space-y-2">
                {analytics.datasetSizes.map((d) => {
                  const maxSamples = Math.max(...analytics.datasetSizes.map((x) => x.samples), 1);
                  return (
                    <div key={d.name}>
                      <div className="flex justify-between text-xs text-slate-400 mb-0.5">
                        <span>{d.name}</span>
                        <span>{d.samples} samples</span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full">
                        <div className="h-2 bg-green-500 rounded-full" style={{ width: `${(d.samples / maxSamples) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Recent Activity */}
          <Card>
            <h4 className="text-xs text-slate-400 mb-2">Recent Activity</h4>
            <div className="space-y-1">
              {analytics.recentActivity.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{a.action}</span>
                  <span className="text-slate-500 text-xs">{new Date(a.time).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Source Health */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Auto-Training Source Health</h3>
        <Btn size="sm" variant="ghost" onClick={loadHealth} loading={loading.health}><RefreshCw className="w-4 h-4" /></Btn>
      </div>
      {health && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">{health.online}/{health.total} sources online</span>
            <span className={`text-lg font-bold font-mono ${health.healthPercent >= 80 ? "text-green-400" : health.healthPercent >= 50 ? "text-yellow-400" : "text-red-400"}`}>
              {health.healthPercent}%
            </span>
          </div>
          <div className="space-y-1">
            {health.sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2 bg-slate-700/40 rounded-lg text-sm">
                <span className="text-slate-300">{s.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 text-xs">{s.latencyMs}ms</span>
                  <StatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 8: Recipes & Webhooks ────────────────────────────────────────────────

type Recipe = { id: string; name: string; icon: string; description: string; config: Record<string, unknown>; estimatedTime: string; bestFor: string[] };
type Webhook = { id: number; name: string; url: string; events: string; active: boolean; failureCount: number; lastStatus?: number | null; lastTriggeredAt?: string | null };

function RecipesWebhooksTab() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showWHForm, setShowWHForm] = useState(false);
  const [whName, setWhName] = useState("");
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState(["job.completed", "job.failed"]);
  const [whSecret, setWhSecret] = useState("");

  useEffect(() => {
    api<{ recipes: Recipe[] }>("/training/recipes").then((r) => setRecipes(r.recipes)).catch(console.error);
    api<Webhook[]>("/training/webhooks").then(setWebhooks).catch(console.error);
  }, []);

  const setLoad = (k: string, v: boolean) => setLoading((prev) => ({ ...prev, [k]: v }));

  const createWebhook = async () => {
    setLoad("wh", true); setError("");
    try {
      await api("/training/webhooks", {
        method: "POST", body: JSON.stringify({ name: whName, url: whUrl, events: whEvents, secret: whSecret || undefined }),
      });
      const hooks = await api<Webhook[]>("/training/webhooks");
      setWebhooks(hooks); setShowWHForm(false); setWhName(""); setWhUrl(""); setWhSecret("");
      setSuccess("Webhook created!");
    } catch (e) { setError(String(e)); }
    finally { setLoad("wh", false); }
  };

  const deleteWebhook = async (id: number) => {
    await api(`/training/webhooks/${id}`, { method: "DELETE" }).catch(console.error);
    setWebhooks((w) => w.filter((x) => x.id !== id));
  };

  const testWebhook = async (id: number) => {
    try {
      await api(`/training/webhooks/${id}/test`, { method: "POST" });
      setSuccess("Test webhook sent!");
    } catch (e) { setError(String(e)); }
  };

  const toggleWebhook = async (id: number, active: boolean) => {
    try {
      const updated = await api<Webhook>(`/training/webhooks/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      setWebhooks((w) => w.map((x) => x.id === id ? updated : x));
    } catch (e) { setError(String(e)); }
  };

  const ALL_EVENTS = ["job.completed", "job.failed", "job.started", "test", "*"];

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* Training Recipes */}
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-blue-400" /> Training Recipes
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {recipes.map((r) => (
          <Card key={r.id} className="hover:border-green-500/40 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{r.icon}</span>
              <div>
                <div className="text-sm font-semibold text-slate-200">{r.name}</div>
                <div className="text-xs text-slate-500">{r.estimatedTime}</div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-2">{r.description}</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {r.bestFor.slice(0, 3).map((t) => (
                <span key={t} className="text-xs bg-blue-500/10 text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
            <div className="text-xs font-mono text-slate-500 bg-slate-900 rounded p-2 space-y-0.5">
              {Object.entries(r.config as Record<string, string | number | boolean>).map(([k, v]) => (
                <div key={k}><span className="text-slate-600">{k}:</span> <span className="text-green-400">{String(v)}</span></div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Webhooks */}
      <div className="flex items-center justify-between mt-4">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Activity className="w-4 h-4 text-orange-400" /> Webhooks ({webhooks.length})
        </h3>
        <Btn size="sm" onClick={() => setShowWHForm(!showWHForm)}><Plus className="w-4 h-4" /> Add</Btn>
      </div>

      {showWHForm && (
        <Card>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input value={whName} onChange={(e) => setWhName(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
              placeholder="Webhook name" />
            <input value={whUrl} onChange={(e) => setWhUrl(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-slate-200"
              placeholder="https://your-endpoint.com/hook" />
            <input value={whSecret} onChange={(e) => setWhSecret(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
              placeholder="HMAC secret (optional)" />
            <div className="flex flex-wrap gap-2 items-center">
              {ALL_EVENTS.filter((e) => e !== "*").map((ev) => (
                <label key={ev} className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={whEvents.includes(ev)} onChange={(e) => {
                    setWhEvents(e.target.checked ? [...whEvents, ev] : whEvents.filter((x) => x !== ev));
                  }} className="accent-green-500" />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <Btn onClick={createWebhook} loading={loading.wh}>Create Webhook</Btn>
        </Card>
      )}

      <div className="space-y-2">
        {webhooks.map((h) => (
          <Card key={h.id}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-200">{h.name}</span>
                  <StatusBadge status={h.active ? "online" : "offline"} />
                  {h.failureCount > 0 && <span className="text-xs text-red-400">{h.failureCount} failures</span>}
                </div>
                <div className="text-xs font-mono text-slate-500 mt-0.5">{h.url}</div>
                <div className="text-xs text-slate-600 mt-0.5">Events: {(() => { try { return JSON.parse(h.events).join(", "); } catch { return h.events; } })()}</div>
              </div>
              <div className="flex items-center gap-2">
                <Btn size="sm" variant="ghost" onClick={() => testWebhook(h.id)}>Test</Btn>
                <Btn size="sm" variant="secondary" onClick={() => toggleWebhook(h.id, !h.active)}>{h.active ? "Disable" : "Enable"}</Btn>
                <Btn size="sm" variant="danger" onClick={() => deleteWebhook(h.id)}><Trash2 className="w-3 h-3" /></Btn>
              </div>
            </div>
          </Card>
        ))}
        {webhooks.length === 0 && <p className="text-slate-500 text-sm text-center py-4">No webhooks configured. Add one to get notified when training completes.</p>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "quality", label: "Quality Lab", icon: FlaskConical },
  { id: "advanced", label: "Advanced Training", icon: Cpu },
  { id: "eval", label: "Evaluation", icon: BarChart3 },
  { id: "model-hub", label: "Model Hub", icon: Bot },
  { id: "rlhf", label: "RLHF & DPO", icon: ThumbsUp },
  { id: "data", label: "Data Sources", icon: Globe },
  { id: "analytics", label: "Analytics", icon: TrendingUp },
  { id: "recipes", label: "Recipes & Webhooks", icon: Settings2 },
] as const;

export default function TrainingLabPage() {
  const [activeTab, setActiveTab] = useState<string>("quality");

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700/50 bg-slate-800/50">
        <div className="flex items-center gap-3 mb-1">
          <FlaskConical className="w-6 h-6 text-green-400" />
          <h1 className="text-xl font-bold text-slate-100" style={{ fontFamily: "Syne, sans-serif" }}>
            Training Lab
          </h1>
          <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">35 Features</span>
        </div>
        <p className="text-sm text-slate-400">Advanced AI training toolkit — quality control, benchmarks, RLHF, DPO, HP sweeps, model merging, and more</p>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-700/30 overflow-x-auto bg-slate-800/30">
        {TABS.map((t) => (
          <TabBtn key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)} icon={t.icon} label={t.label} />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "quality" && <QualityLabTab />}
        {activeTab === "advanced" && <AdvancedTrainingTab />}
        {activeTab === "eval" && <EvaluationTab />}
        {activeTab === "model-hub" && <ModelHubTab />}
        {activeTab === "rlhf" && <RlhfTab />}
        {activeTab === "data" && <DataSourcesTab />}
        {activeTab === "analytics" && <AnalyticsMonitorTab />}
        {activeTab === "recipes" && <RecipesWebhooksTab />}
      </div>
    </div>
  );
}
