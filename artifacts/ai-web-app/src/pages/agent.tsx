import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Play, Square, Lightbulb, Wrench, CheckCircle2,
  XCircle, Loader2, ChevronDown, ChevronRight, Trash2,
  Sparkles, Database, Network, Cpu, Globe, RefreshCw,
  Send, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "thought" | "tool_call" | "tool_result" | "done" | "error";

interface AgentEvent {
  type: EventType;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  ok?: boolean;
  summary?: string;
  steps?: number;
  message?: string;
  step?: number;
}

interface AgentStep {
  id: number;
  events: AgentEvent[];
  collapsed: boolean;
}

type AgentStatus = "idle" | "running" | "done" | "error";

// ─── Preset tasks ─────────────────────────────────────────────────────────────

const PRESETS = [
  {
    icon: Database,
    label: "Buat Dataset Q&A",
    color: "text-emerald-400",
    task: 'Buat dataset baru bernama "AI Fundamentals QA" dengan task type "qa", lalu generate 5 sampel training tentang topik "artificial intelligence and machine learning basics". Pastikan semua sampel tersimpan.',
  },
  {
    icon: Network,
    label: "Bangun & Latih Model",
    color: "text-blue-400",
    task: 'Buat dataset "General Assistant Training" (task type: qa), generate 5 sampel tentang "helpful AI assistant responses", lalu buat model baru bernama "DLavie-Assistant-v1" (type: llm, architecture: tinyllama), kemudian mulai training.',
  },
  {
    icon: Cpu,
    label: "Pipeline Lengkap",
    color: "text-violet-400",
    task: 'Lakukan pipeline lengkap: 1) Cek dataset dan model yang sudah ada, 2) Buat dataset baru "NLP Tasks Dataset" (task: generation), 3) Generate 8 sampel tentang "natural language processing tasks", 4) Buat model "DLavie-NLP-v1" (type: llm), 5) Start training, 6) Berikan ringkasan apa saja yang berhasil dibuat.',
  },
  {
    icon: Globe,
    label: "Research & Dataset",
    color: "text-amber-400",
    task: 'Search web untuk informasi tentang "transformer architecture in AI", lalu buat dataset baru "Transformer Knowledge" (task: qa) dan generate 5 sampel training berdasarkan topik tersebut.',
  },
  {
    icon: RefreshCw,
    label: "Audit Sistem",
    color: "text-cyan-400",
    task: "Audit sistem: list semua dataset yang ada, list semua model yang terdaftar, cek training jobs terbaru, dan cek model Ollama yang sudah terinstall. Berikan ringkasan lengkap kondisi sistem saat ini.",
  },
];

// ─── Tool icon map ─────────────────────────────────────────────────────────────

function ToolIcon({ tool }: { tool: string }) {
  if (tool.includes("dataset") || tool.includes("sample")) return <Database className="w-3.5 h-3.5" />;
  if (tool.includes("model") || tool.includes("train") || tool.includes("job")) return <Network className="w-3.5 h-3.5" />;
  if (tool.includes("install") || tool.includes("ollama")) return <Cpu className="w-3.5 h-3.5" />;
  if (tool.includes("search")) return <Globe className="w-3.5 h-3.5" />;
  if (tool.includes("finish")) return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (tool.includes("generate")) return <Sparkles className="w-3.5 h-3.5" />;
  return <Wrench className="w-3.5 h-3.5" />;
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(true);

  if (event.type === "thought") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
          <Lightbulb className="w-3 h-3 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Pikiran</span>
          <p className="mt-0.5 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{event.content}</p>
        </div>
      </div>
    );
  }

  if (event.type === "tool_call") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <ToolIcon tool={event.tool || ""} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Memanggil Tool</span>
            <code className="text-xs bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded font-mono">
              {event.tool}()
            </code>
          </div>
          {event.args && Object.keys(event.args).length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors"
            >
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Argumen
            </button>
          )}
          <AnimatePresence>
            {open && event.args && Object.keys(event.args).length > 0 && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-1.5 text-xs text-slate-400 bg-slate-900/60 rounded p-2.5 overflow-x-auto font-mono border border-slate-800"
              >
                {JSON.stringify(event.args, null, 2)}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (event.type === "tool_result") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className={cn(
          "mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
          event.ok ? "bg-sky-500/20" : "bg-red-500/20"
        )}>
          {event.ok
            ? <CheckCircle2 className="w-3 h-3 text-sky-400" />
            : <XCircle className="w-3 h-3 text-red-400" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-medium uppercase tracking-wider", event.ok ? "text-sky-400" : "text-red-400")}>
              {event.ok ? "Hasil" : "Error"}
            </span>
            <code className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
              {event.tool}
            </code>
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {event.ok ? "Lihat data" : "Lihat error"}
          </button>
          <AnimatePresence>
            {open && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={cn(
                  "mt-1.5 text-xs rounded p-2.5 overflow-x-auto font-mono border max-h-48 overflow-y-auto",
                  event.ok
                    ? "text-slate-300 bg-sky-950/30 border-sky-900/40"
                    : "text-red-300 bg-red-950/30 border-red-900/40"
                )}
              >
                {typeof event.data === "string"
                  ? event.data
                  : JSON.stringify(event.data, null, 2)}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
          <AlertTriangle className="w-3 h-3 text-red-400" />
        </div>
        <div className="flex-1">
          <span className="text-xs font-medium text-red-400 uppercase tracking-wider">Error</span>
          <p className="mt-0.5 text-sm text-red-300">{event.message}</p>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Step group ───────────────────────────────────────────────────────────────

function StepGroup({ step, onToggle }: { step: AgentStep; onToggle: () => void }) {
  const hasError = step.events.some((e) => e.type === "error");
  const toolCalls = step.events.filter((e) => e.type === "tool_call");
  const mainTool = toolCalls[0]?.tool;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border bg-slate-900/50 overflow-hidden",
        hasError ? "border-red-900/50" : "border-slate-800/70"
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-800/40 transition-colors"
      >
        <span className="text-xs font-mono text-slate-600 w-5 text-right flex-shrink-0">
          {step.id}
        </span>
        <span className="flex-1 text-sm text-slate-400 truncate">
          {mainTool ? (
            <span>
              <span className="text-slate-500">→ </span>
              <code className="text-emerald-400 font-mono text-xs">{mainTool}()</code>
            </span>
          ) : (
            <span className="text-slate-500">Berpikir…</span>
          )}
        </span>
        {step.collapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
        }
      </button>

      <AnimatePresence>
        {!step.collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 pb-4 space-y-3 border-t border-slate-800/50"
          >
            <div className="pt-3 space-y-3">
              {step.events.map((ev, i) => (
                <EventCard key={i} event={ev} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [summary, setSummary] = useState("");
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentStepBuf, setCurrentStepBuf] = useState<AgentEvent[]>([]);
  const [currentStepNum, setCurrentStepNum] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps, currentStepBuf]);

  const toggleStep = useCallback((id: number) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    );
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setSteps([]);
    setSummary("");
    setTotalSteps(0);
    setCurrentStepBuf([]);
    setCurrentStepNum(0);
    setStatus("idle");
  }, []);

  const run = useCallback(async () => {
    if (!task.trim() || status === "running") return;
    reset();
    setStatus("running");

    const controller = new AbortController();
    abortRef.current = controller;

    const stepMap = new Map<number, AgentEvent[]>();
    let pendingStepNum = 0;

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.trim(), maxSteps: 15 }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setStatus("error");
        setSteps([{ id: 1, events: [{ type: "error", message: `HTTP ${res.status}: ${await res.text()}` }], collapsed: false }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let event: AgentEvent;
          try { event = JSON.parse(raw); } catch { continue; }

          const stepNum = event.step ?? 0;

          if (event.type === "done") {
            // Flush pending step
            if (pendingStepNum > 0 && stepMap.has(pendingStepNum)) {
              const evts = stepMap.get(pendingStepNum)!;
              setSteps((prev) => {
                const exists = prev.find((s) => s.id === pendingStepNum);
                if (exists) return prev.map((s) => s.id === pendingStepNum ? { ...s, events: evts } : s);
                return [...prev, { id: pendingStepNum, events: evts, collapsed: false }];
              });
            }
            setCurrentStepBuf([]);
            setSummary(event.summary || "");
            setTotalSteps(event.steps || 0);
            setStatus("done");
            continue;
          }

          if (event.type === "error" && !stepNum) {
            setSteps((prev) => [...prev, { id: prev.length + 1, events: [event], collapsed: false }]);
            setStatus("error");
            continue;
          }

          // Group by step
          if (stepNum && stepNum !== pendingStepNum) {
            // Finalize previous step
            if (pendingStepNum > 0 && stepMap.has(pendingStepNum)) {
              const evts = stepMap.get(pendingStepNum)!;
              const pNum = pendingStepNum;
              setSteps((prev) => {
                const exists = prev.find((s) => s.id === pNum);
                if (exists) return prev.map((s) => s.id === pNum ? { ...s, events: evts } : s);
                return [...prev, { id: pNum, events: evts, collapsed: false }];
              });
            }
            pendingStepNum = stepNum;
            setCurrentStepNum(stepNum);
            stepMap.set(stepNum, []);
          }

          if (stepNum) {
            const arr = stepMap.get(stepNum) ?? [];
            arr.push(event);
            stepMap.set(stepNum, arr);
            setCurrentStepBuf([...arr]);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatus("error");
        setSteps((prev) => [
          ...prev,
          { id: prev.length + 1, events: [{ type: "error", message: String(err) }], collapsed: false },
        ]);
      }
    }
  }, [task, status, reset]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
  };

  return (
    <div className="flex h-full flex-col bg-slate-950">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-slate-800 px-4 py-3 bg-slate-900/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-100 font-[Syne] truncate">AI Developer Agent</h1>
              <p className="text-xs text-slate-500 hidden sm:block">Agen otonom untuk membangun &amp; melatih model AI</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap",
              status === "running" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
              status === "done"    ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" :
              status === "error"   ? "bg-red-500/10 text-red-400 border border-red-500/20" :
              "bg-slate-800 text-slate-500 border border-slate-700"
            )}>
              {status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
              {status === "done"    && <CheckCircle2 className="w-3 h-3" />}
              {status === "error"   && <XCircle className="w-3 h-3" />}
              {status === "idle"    && <Bot className="w-3 h-3" />}
              <span className="hidden xs:inline">
                {status === "running" ? "Berjalan…" :
                 status === "done"    ? `Selesai (${totalSteps})` :
                 status === "error"   ? "Error" : "Siap"}
              </span>
            </div>
            {(steps.length > 0 || summary) && (
              <button
                onClick={reset}
                className="p-1.5 rounded-full text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-600 transition-colors"
                title="Reset"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile preset chips (horizontal scroll) ────────── */}
      <div className="md:hidden flex-shrink-0 border-b border-slate-800 bg-slate-900/30">
        <div className="flex gap-2 px-3 py-2.5 overflow-x-auto scrollbar-none">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setTask(p.task); textareaRef.current?.focus(); }}
              disabled={status === "running"}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 hover:border-slate-600 disabled:opacity-40 transition-all text-xs text-slate-400 whitespace-nowrap"
            >
              <p.icon className={cn("w-3 h-3", p.color)} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body: sidebar (desktop) + main ─────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Desktop-only sidebar */}
        <div className="hidden md:flex w-52 flex-shrink-0 border-r border-slate-800 bg-slate-900/30 flex-col">
          <div className="px-4 py-2.5 border-b border-slate-800">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Preset Task</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setTask(p.task); textareaRef.current?.focus(); }}
                disabled={status === "running"}
                className="w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-800/60 hover:border-slate-700 transition-all disabled:opacity-40 group"
              >
                <p.icon className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", p.color)} />
                <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors leading-snug">
                  {p.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Steps timeline */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-2">
            {steps.length === 0 && status === "idle" && (
              <div className="flex flex-col items-center justify-center h-full text-center py-10 px-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
                  <Sparkles className="w-6 h-6 text-emerald-400" />
                </div>
                <h2 className="text-base font-semibold text-slate-300 font-[Syne]">DLavie Agent</h2>
                <p className="mt-1.5 text-xs text-slate-500 max-w-xs">
                  Pilih preset di atas atau ketik tugas sendiri. Agent akan berpikir dan bertindak otomatis.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {["Buat dataset", "Latih model", "Audit sistem"].map((hint) => (
                    <span key={hint} className="px-2.5 py-1 rounded-full bg-slate-800 text-xs text-slate-500 border border-slate-700">
                      {hint}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence>
              {steps.map((step) => (
                <StepGroup key={step.id} step={step} onToggle={() => toggleStep(step.id)} />
              ))}
            </AnimatePresence>

            {/* Live step buffer */}
            {status === "running" && currentStepBuf.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 overflow-hidden"
              >
                <div className="px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin flex-shrink-0" />
                  <span className="text-xs text-emerald-400 font-medium">Langkah {currentStepNum} — sedang berjalan…</span>
                </div>
                <div className="px-3 pb-3 space-y-3 border-t border-emerald-900/30 pt-3">
                  {currentStepBuf.map((ev, i) => (
                    <EventCard key={i} event={ev} />
                  ))}
                </div>
              </motion.div>
            )}

            {status === "running" && currentStepBuf.length === 0 && steps.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-4 px-1">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                Agent sedang mulai berpikir…
              </div>
            )}

            {/* Done summary */}
            <AnimatePresence>
              {status === "done" && summary && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-sky-900/50 bg-sky-950/20 p-3.5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-sky-400">Tugas Selesai</span>
                    <span className="text-xs text-slate-500 ml-auto">{totalSteps} langkah</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{summary}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={bottomRef} />
          </div>

          {/* ── Input area ───────────────────────────────────── */}
          <div className="flex-shrink-0 border-t border-slate-800 bg-slate-900/50 p-3">
            <textarea
              ref={textareaRef}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={handleKey}
              disabled={status === "running"}
              placeholder="Deskripsikan tugas untuk Agent… (Ctrl+Enter untuk jalankan)"
              rows={3}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50 transition-all leading-relaxed"
            />
            <div className="flex gap-2 mt-2">
              {status === "running" ? (
                <button
                  onClick={stop}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium"
                >
                  <Square className="w-3.5 h-3.5" /> Stop
                </button>
              ) : (
                <button
                  onClick={run}
                  disabled={!task.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium"
                >
                  <Play className="w-3.5 h-3.5" /> Jalankan
                </button>
              )}
              <button
                onClick={() => { setTask(""); textareaRef.current?.focus(); }}
                disabled={status === "running"}
                className="px-3 py-2 rounded-xl border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 disabled:opacity-40 transition-colors text-xs"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
