/**
 * DLavie OS — AI Developer Agent Page
 *
 * Brain: Qwen/Qwen2.5-Coder-32B-Instruct on HuggingFace GPU servers
 *        → ZERO local RAM consumed
 * - Sessions run as background processes (survive page navigation)
 * - ReAct loop: up to 30 steps with 34 real tools
 * - Memory system: cross-session persistent learning (agent remembers past work)
 * - Autonomous mode: LLM-driven self-directed tasks every 10 min
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Play, Square, Trash2, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Lightbulb, ChevronDown, ChevronRight, Sparkles,
  Database, Network, Cpu, Search, Package, Zap, RefreshCw,
  Clock, ToggleLeft, ToggleRight, PlusCircle, History,
  Brain, FileCode2, FlaskConical, BookOpen, ScrollText, Terminal,
  MessageSquare, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "done" | "error" | "info" | "memory";
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  ok?: boolean;
  summary?: string;
  steps?: number;
  message?: string;
  step?: number;
  model?: string;
  ts: number;
}

interface AgentSession {
  id: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  events: AgentEvent[];
  summary: string;
  totalSteps: number;
  model: string;
  autonomous: boolean;
  memoriesLoaded: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionSummary {
  id: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  totalSteps: number;
  summary: string;
  model: string;
  autonomous: boolean;
  memoriesLoaded: number;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── API base ─────────────────────────────────────────────────────────────────
function apiBase(): string {
  return "";
}
const BASE = apiBase();

// ─── Tool icon ────────────────────────────────────────────────────────────────
function ToolIcon({ tool }: { tool: string }) {
  if (tool.includes("memory") || tool.includes("memories")) return <Brain className="w-3.5 h-3.5" />;
  if (tool.includes("code") || tool.includes("file") || tool.includes("write")) return <FileCode2 className="w-3.5 h-3.5" />;
  if (tool === "execute_python" || tool === "run_shell") return <Terminal className="w-3.5 h-3.5" />;
  if (tool.includes("paper") || tool.includes("research")) return <BookOpen className="w-3.5 h-3.5" />;
  if (tool.includes("plan") || tool.includes("think") || tool.includes("reason") || tool.includes("benchmark") || tool.includes("optimize")) return <FlaskConical className="w-3.5 h-3.5" />;
  if (tool.includes("dataset") || tool.includes("sample") || tool.includes("augment") || tool.includes("fetch_hf")) return <Database className="w-3.5 h-3.5" />;
  if (tool.includes("model") || tool.includes("training") || tool.includes("job")) return <Network className="w-3.5 h-3.5" />;
  if (tool.includes("search") || tool.includes("hf_model")) return <Search className="w-3.5 h-3.5" />;
  if (tool === "get_system_stats") return <Cpu className="w-3.5 h-3.5" />;
  if (tool.includes("ollama") || tool.includes("local_model")) return <Package className="w-3.5 h-3.5" />;
  if (tool === "finish") return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (tool.includes("card") || tool.includes("model_card")) return <ScrollText className="w-3.5 h-3.5" />;
  return <Zap className="w-3.5 h-3.5" />;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, steps }: { status: AgentSession["status"]; steps?: number }) {
  const configs = {
    running: { cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Running…" },
    done:    { cls: "bg-sky-500/10 text-sky-400 border-sky-500/20",             icon: <CheckCircle2 className="w-3 h-3" />,          label: `Done${steps ? ` (${steps})` : ""}` },
    error:   { cls: "bg-red-500/10 text-red-400 border-red-500/20",             icon: <XCircle className="w-3 h-3" />,               label: "Error" },
    stopped: { cls: "bg-slate-700/50 text-slate-400 border-slate-700",          icon: <Square className="w-3 h-3" />,                label: "Stopped" },
  };
  const c = configs[status];
  return (
    <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", c.cls)}>
      {c.icon}
      <span>{c.label}</span>
    </div>
  );
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
          <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Thought</span>
          <p className="mt-0.5 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{event.content}</p>
        </div>
      </div>
    );
  }

  if (event.type === "tool_call") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
          <ToolIcon tool={event.tool || ""} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Tool Call</span>
            <code className="text-xs bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded font-mono">{event.tool}()</code>
          </div>
          {event.args && Object.keys(event.args).length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors"
            >
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Args
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
          {event.ok ? <CheckCircle2 className="w-3 h-3 text-sky-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-medium uppercase tracking-wider", event.ok ? "text-sky-400" : "text-red-400")}>
              {event.ok ? "Result" : "Error"}
            </span>
            <code className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">{event.tool}</code>
          </div>
          <button onClick={() => setOpen((o) => !o)} className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {event.ok ? "View data" : "View error"}
          </button>
          <AnimatePresence>
            {open && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={cn(
                  "mt-1.5 text-xs rounded p-2.5 overflow-x-auto font-mono border max-h-48 overflow-y-auto",
                  event.ok ? "text-slate-300 bg-sky-950/30 border-sky-900/40" : "text-red-300 bg-red-950/30 border-red-900/40"
                )}
              >
                {typeof event.data === "string" ? event.data : JSON.stringify(event.data, null, 2)}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (event.type === "memory") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center">
          <Brain className="w-3 h-3 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-violet-400 uppercase tracking-wider">Memory Loaded</span>
          <p className="mt-0.5 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{event.content}</p>
        </div>
      </div>
    );
  }

  if (event.type === "info") {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-slate-700/50 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-slate-500" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-slate-500 italic">{event.content}</p>
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

  if (event.type === "done") {
    return (
      <div className="rounded-lg border border-sky-900/50 bg-sky-950/20 p-3">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-sky-400">Task Complete</span>
          {event.steps && <span className="text-xs text-slate-500 ml-auto">{event.steps} steps</span>}
        </div>
        {event.summary && <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{event.summary}</p>}
      </div>
    );
  }

  return null;
}

// ─── Session item in sidebar list ─────────────────────────────────────────────
function SessionItem({
  session, isActive, onClick, onDelete,
}: {
  session: SessionSummary;
  isActive: boolean;
  onClick: () => void;
  onDelete: (id: string) => void;
}) {
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-1 px-3 py-2.5 rounded-lg cursor-pointer border transition-all",
        isActive
          ? "bg-emerald-500/5 border-emerald-500/20 text-white"
          : "bg-slate-900/40 border-slate-800/60 hover:bg-slate-800/50 hover:border-slate-700"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2 justify-between">
        <p className="text-xs text-slate-300 line-clamp-2 leading-snug flex-1">{session.task}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 text-slate-600 transition-all flex-shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusBadge status={session.status} steps={session.totalSteps} />
        {session.autonomous && (
          <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px] border border-violet-500/20 font-mono">AUTO</span>
        )}
        <span className="text-[10px] text-slate-600 font-mono ml-auto flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo(session.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { label: "Audit System",       task: "Get system stats, list all datasets, models, and training jobs. Recall relevant memories from past sessions. Summarize the current state of the AI system and store any key insights.",                                                     icon: Sparkles,    color: "text-emerald-400" },
  { label: "Search + Build",     task: "Search HuggingFace for the top 3 text-generation models. Search arXiv for recent papers on instruction tuning. Then create a dataset named 'Instruction Tuning QA' and generate 5 training samples based on what you found.",              icon: BookOpen,    color: "text-purple-400" },
  { label: "Code & Execute",     task: "Write a Python script that implements a simple neural network training loop using numpy only (no PyTorch). Execute it. Store the working code as a memory insight.",                                                                          icon: Terminal,    color: "text-amber-400" },
  { label: "Plan Experiment",    task: "Plan a full ML experiment: what architecture to use for text classification, what hyperparameters to try, and why. Use the 'reason' tool to think through trade-offs. Store your plan as a memory.",                                        icon: FlaskConical, color: "text-orange-400" },
  { label: "Train a Model",      task: "List all registered models and datasets. Pick the best matching pair and start a training job. Recall past training memories for context.",                                                                                                   icon: Network,     color: "text-sky-400" },
  { label: "Full Pipeline",      task: "Create a dataset named 'Code QA' (task type: qa), generate 4 samples about Python best practices, register a model named 'CodeHelper-v1' (type: llm), start training, then store a summary insight in memory.", icon: RefreshCw, color: "text-rose-400" },
];

// ─── Chat message bubble ──────────────────────────────────────────────────────
function ChatBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-2.5 items-end", isUser && "flex-row-reverse")}>
      <div className={cn(
        "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold",
        isUser ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"
      )}>
        {isUser ? "U" : "AI"}
      </div>
      <div className={cn(
        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
        isUser
          ? "bg-blue-600/20 border border-blue-500/20 text-slate-200 rounded-br-sm"
          : "bg-slate-800/80 border border-slate-700/50 text-slate-200 rounded-bl-sm"
      )}>
        {content}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AgentPage() {
  // Agent task state
  const [task, setTask] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem("agent_active_session_id"); } catch { return null; }
  });
  const [autonomousEnabled, setAutonomousEnabled] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Tab state
  const [tab, setTab] = useState<"agent" | "chat">("agent");

  // Chat state
  const [chatMessage, setChatMessage] = useState("");
  const [chatConvs, setChatConvs] = useState<Array<{ id: number; title: string; updatedAt: string }>>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [chatMsgs, setChatMsgs] = useState<Array<{ id: number; role: string; content: string; createdAt: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load chat conversations ────────────────────────────────────────────────
  const loadChatConvs = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/agent/chat/conversations`);
      if (res.ok) setChatConvs(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadChatMessages = useCallback(async (convId: number) => {
    try {
      const res = await fetch(`${BASE}/api/agent/chat/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json() as Array<{ id: number; role: string; content: string; createdAt: string }>;
        setChatMsgs(data);
      }
    } catch { /* ignore */ }
  }, []);

  const sendChat = useCallback(async () => {
    const msg = chatMessage.trim();
    if (!msg || chatLoading) return;
    setChatMessage("");
    setChatLoading(true);
    const tempUserMsg = { id: Date.now(), role: "user", content: msg, createdAt: new Date().toISOString() };
    setChatMsgs((prev) => [...prev, tempUserMsg]);
    try {
      const res = await fetch(`${BASE}/api/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId: activeChatId }),
      });
      const data = await res.json() as { reply: string; conversationId: number; model?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (!activeChatId && data.conversationId) {
        setActiveChatId(data.conversationId);
        loadChatConvs();
      }
      setChatMsgs((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: data.reply, createdAt: new Date().toISOString() }]);
    } catch (e) {
      setChatMsgs((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: `Error: ${String(e)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessage, chatLoading, activeChatId, loadChatConvs]);

  const deleteChatConv = useCallback(async (id: number) => {
    await fetch(`${BASE}/api/agent/chat/conversations/${id}`, { method: "DELETE" });
    if (id === activeChatId) { setActiveChatId(null); setChatMsgs([]); }
    loadChatConvs();
  }, [activeChatId, loadChatConvs]);

  const newChatConv = useCallback(() => {
    setActiveChatId(null);
    setChatMsgs([]);
    setChatMessage("");
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, []);

  // Auto-scroll chat
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs.length]);

  // Load convs when switching to chat tab
  useEffect(() => { if (tab === "chat") loadChatConvs(); }, [tab, loadChatConvs]);

  // Auto-scroll when new events come in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.events.length]);

  // ── Fetch session list ──────────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/agent/sessions`);
      if (res.ok) setSessions(await res.json());
    } catch { /* ignore */ }
  }, []);

  // ── Fetch active session details ────────────────────────────────────────────
  const fetchActiveSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${BASE}/api/agent/sessions/${id}`);
      if (res.ok) {
        const data: AgentSession = await res.json();
        setActiveSession(data);
        return data;
      } else if (res.status === 404) {
        setActiveId(null);
        setActiveSession(null);
        localStorage.removeItem("agent_active_session_id");
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  // ── Fetch autonomous status ────────────────────────────────────────────────
  const fetchAutonomous = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/agent/autonomous`);
      if (res.ok) {
        const data = await res.json() as { enabled: boolean };
        setAutonomousEnabled(data.enabled);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Initial data load ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchSessions();
    fetchAutonomous();
    if (activeId) fetchActiveSession(activeId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling for running session ────────────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    if (!activeId) return;

    const poll = async () => {
      const data = await fetchActiveSession(activeId);
      await fetchSessions();
      if (data && data.status !== "running") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    };

    // Start polling immediately if session might be running
    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [activeId, fetchActiveSession, fetchSessions]);

  // ── Start a new task ───────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (!task.trim() || isStarting) return;
    setIsStarting(true);
    try {
      const res = await fetch(`${BASE}/api/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string };
      setActiveId(data.id);
      localStorage.setItem("agent_active_session_id", data.id);
      setActiveSession(null);
      setTask("");
      fetchSessions();
    } catch (e) {
      console.error("Failed to start agent session:", e);
    } finally {
      setIsStarting(false);
    }
  }, [task, isStarting, fetchSessions]);

  // ── Stop active session ────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!activeId) return;
    await fetch(`${BASE}/api/agent/sessions/${activeId}/stop`, { method: "POST" });
    await fetchActiveSession(activeId);
    fetchSessions();
  }, [activeId, fetchActiveSession, fetchSessions]);

  // ── Delete a session ───────────────────────────────────────────────────────
  const deleteSession = useCallback(async (id: string) => {
    await fetch(`${BASE}/api/agent/sessions/${id}`, { method: "DELETE" });
    if (id === activeId) {
      setActiveId(null);
      setActiveSession(null);
      localStorage.removeItem("agent_active_session_id");
    }
    fetchSessions();
  }, [activeId, fetchSessions]);

  // ── Select a session to view ───────────────────────────────────────────────
  const selectSession = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem("agent_active_session_id", id);
    fetchActiveSession(id);
  }, [fetchActiveSession]);

  // ── Toggle autonomous mode ─────────────────────────────────────────────────
  const toggleAutonomous = useCallback(async () => {
    const next = !autonomousEnabled;
    setAutonomousEnabled(next);
    const res = await fetch(`${BASE}/api/agent/autonomous`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) {
      const data = await res.json() as { enabled: boolean };
      setAutonomousEnabled(data.enabled);
    }
  }, [autonomousEnabled]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
  };

  const isRunning = activeSession?.status === "running";

  return (
    <div className="flex h-full flex-col bg-slate-950">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-slate-800 px-4 py-3 bg-slate-900/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 flex items-center justify-center">
              {isRunning
                ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                : <Bot className="w-4 h-4 text-emerald-400" />
              }
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-100 font-[Syne] truncate">AI Developer Agent</h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                34 tools · <span className="font-mono text-emerald-400/70">Qwen2.5-Coder-32B</span> on HF GPU
                {isRunning && <span className="ml-2 text-emerald-400 animate-pulse">● running in background…</span>}
              </p>
            </div>
          </div>

          {/* Autonomous toggle */}
          <button
            onClick={toggleAutonomous}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
              autonomousEnabled
                ? "bg-violet-500/10 text-violet-400 border-violet-500/30 hover:bg-violet-500/20"
                : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600 hover:text-slate-400"
            )}
            title={autonomousEnabled ? "Autonomous mode ON — LLM picks tasks every 10 min using system state + memories" : "Enable autonomous mode"}
          >
            {autonomousEnabled
              ? <ToggleRight className="w-3.5 h-3.5" />
              : <ToggleLeft className="w-3.5 h-3.5" />
            }
            <span className="hidden sm:inline">Auto {autonomousEnabled ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* ── Tab switcher ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex border-b border-slate-800 bg-slate-900/30 px-4">
        <button
          onClick={() => setTab("agent")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all",
            tab === "agent"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          )}
        >
          <Bot className="w-3.5 h-3.5" />
          AI Agent
        </button>
        <button
          onClick={() => setTab("chat")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all",
            tab === "chat"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          )}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
          {chatConvs.length > 0 && (
            <span className="ml-1 px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[9px] border border-blue-500/20">
              {chatConvs.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Preset chips (mobile scroll — agent tab only) ─────────────────── */}
      {tab === "agent" && (
      <div className="md:hidden flex-shrink-0 border-b border-slate-800 bg-slate-900/20">
        <div className="flex gap-2 px-3 py-2 overflow-x-auto scrollbar-none">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setTask(p.task); textareaRef.current?.focus(); }}
              disabled={isRunning || isStarting}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 hover:border-slate-600 disabled:opacity-40 transition-all text-xs text-slate-400 whitespace-nowrap"
            >
              <p.icon className={cn("w-3 h-3", p.color)} />
              {p.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* ── Agent Tab Body ────────────────────────────────────────────────── */}
      {tab === "agent" && (
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Desktop sidebar: preset tasks + session history */}
        <div className="hidden md:flex w-56 flex-shrink-0 border-r border-slate-800 bg-slate-900/30 flex-col">

          {/* Preset tasks */}
          <div className="px-3 py-2 border-b border-slate-800">
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Quick Tasks</p>
          </div>
          <div className="p-2 space-y-1 border-b border-slate-800">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setTask(p.task); textareaRef.current?.focus(); }}
                disabled={isRunning || isStarting}
                className="w-full text-left flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-800/60 hover:border-slate-700 disabled:opacity-40 transition-all group"
              >
                <p.icon className={cn("w-3 h-3 flex-shrink-0 mt-0.5", p.color)} />
                <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors leading-snug">{p.label}</span>
              </button>
            ))}
          </div>

          {/* Session history */}
          <div className="px-3 py-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest flex items-center gap-1">
              <History className="w-3 h-3" /> History
            </p>
            <button onClick={fetchSessions} className="p-0.5 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-400 transition-colors">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
            {sessions.length === 0 ? (
              <p className="text-xs text-slate-700 px-2 py-4 text-center">No sessions yet</p>
            ) : (
              sessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  isActive={s.id === activeId}
                  onClick={() => selectSession(s.id)}
                  onDelete={deleteSession}
                />
              ))
            )}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Events timeline */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">

            {/* Empty state */}
            {!activeSession && !isStarting && sessions.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-10 px-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
                  <Bot className="w-6 h-6 text-emerald-400" />
                </div>
                <h2 className="text-base font-semibold text-slate-300 font-[Syne]">DLavie Agent</h2>
                <p className="mt-1.5 text-xs text-slate-500 max-w-xs leading-relaxed">
                  Powered by <code className="text-emerald-400 font-mono">Qwen2.5-Coder-32B</code> on HuggingFace GPU servers.
                  34 real tools. Persistent memory. Zero local RAM.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {["Search papers", "Execute code", "Build pipeline", "Recall memory"].map((hint) => (
                    <span key={hint} className="px-2.5 py-1 rounded-full bg-slate-800 text-xs text-slate-500 border border-slate-700">{hint}</span>
                  ))}
                </div>
                <div className="mt-5 flex flex-col items-center gap-1.5 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    {autonomousEnabled
                      ? <><span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" /><span className="text-violet-400">Autonomous mode active — LLM picks tasks every 10 min</span></>
                      : <><ToggleLeft className="w-3.5 h-3.5" /><span>Enable Auto mode — LLM drives itself every 10 min</span></>
                    }
                  </div>
                </div>
              </div>
            )}

            {/* Session selector (mobile) if no active session */}
            {!activeSession && sessions.length > 0 && !isStarting && (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Session History
                  </h3>
                  <button onClick={fetchSessions} className="p-1 rounded hover:bg-slate-800 text-slate-600 transition-colors">
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
                <div className="md:hidden space-y-1.5">
                  {sessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeId}
                      onClick={() => selectSession(s.id)}
                      onDelete={deleteSession}
                    />
                  ))}
                </div>
                <div className="hidden md:block text-xs text-slate-600 text-center py-4">
                  Select a session from the sidebar
                </div>
              </div>
            )}

            {/* Loading spinner while starting */}
            {isStarting && (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-4 px-1">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                Starting agent session…
              </div>
            )}

            {/* Session header */}
            {activeSession && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 mb-2 flex-wrap"
              >
                <StatusBadge status={activeSession.status} steps={activeSession.totalSteps} />
                <span className="text-xs text-slate-500 truncate flex-1">{activeSession.task}</span>
                {activeSession.memoriesLoaded > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px] border border-violet-500/20 font-mono flex-shrink-0">
                    <Brain className="w-2.5 h-2.5" />{activeSession.memoriesLoaded}m
                  </span>
                )}
                <span className="text-[10px] font-mono text-slate-700 flex-shrink-0">
                  {activeSession.model?.split("/").pop() ?? activeSession.model}
                </span>
                {activeSession.autonomous && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px] border border-violet-500/20 font-mono flex-shrink-0">AUTO</span>
                )}
              </motion.div>
            )}

            {/* Events grouped by step */}
            {activeSession && activeSession.events.length > 0 && (() => {
              // Group events by step number
              const stepGroups = new Map<number, AgentEvent[]>();
              for (const ev of activeSession.events) {
                if (ev.type === "done") continue; // rendered separately
                const stepNum = ev.step ?? 0;
                if (!stepGroups.has(stepNum)) stepGroups.set(stepNum, []);
                stepGroups.get(stepNum)!.push(ev);
              }
              const sortedSteps = [...stepGroups.entries()].sort((a, b) => a[0] - b[0]);

              return (
                <AnimatePresence mode="sync">
                  {sortedSteps.map(([stepNum, events]) => (
                    <StepGroup key={stepNum} stepNum={stepNum} events={events} />
                  ))}
                </AnimatePresence>
              );
            })()}

            {/* Running indicator */}
            {activeSession?.status === "running" && (
              <div className="flex items-center gap-2 text-xs text-emerald-400/70 py-2 px-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Agent thinking… (berjalan di background)</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Input area ──────────────────────────────────────────────── */}
          <div className="flex-shrink-0 border-t border-slate-800 bg-slate-900/50 p-3">
            <textarea
              ref={textareaRef}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={handleKey}
              disabled={isRunning || isStarting}
              placeholder="Describe a task for the agent… (Ctrl+Enter to run)"
              rows={3}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50 transition-all leading-relaxed"
            />
            <div className="flex gap-2 mt-2">
              {isRunning ? (
                <button
                  onClick={stop}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium"
                >
                  <Square className="w-3.5 h-3.5" /> Stop Agent
                </button>
              ) : (
                <button
                  onClick={run}
                  disabled={!task.trim() || isStarting}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium"
                >
                  {isStarting
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
                    : <><Play className="w-3.5 h-3.5" /> Run Task</>
                  }
                </button>
              )}
              <button
                onClick={() => {
                  setActiveId(null);
                  setActiveSession(null);
                  localStorage.removeItem("agent_active_session_id");
                }}
                className="px-3 py-2 rounded-xl border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors text-xs"
                title="New session"
              >
                <PlusCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Autonomous mode hint */}
            {autonomousEnabled && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 flex items-center gap-1.5 text-[10px] text-violet-400/70 bg-violet-500/5 border border-violet-500/10 rounded-lg px-2.5 py-1.5"
              >
                <Brain className="w-3 h-3" />
                Autonomous mode active — Qwen2.5-Coder-32B picks &amp; runs tasks every 10 min using persistent memory
              </motion.div>
            )}
          </div>
        </div>
      </div>
      )} {/* end agent tab */}

      {/* ── Chat Tab Body ─────────────────────────────────────────────────── */}
      {tab === "chat" && (
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Conversation sidebar */}
          <div className="hidden md:flex w-56 flex-shrink-0 border-r border-slate-800 bg-slate-900/30 flex-col">
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-800">
              <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Conversations
              </p>
              <div className="flex items-center gap-1">
                <button onClick={loadChatConvs} className="p-0.5 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-400 transition-colors">
                  <RefreshCw className="w-3 h-3" />
                </button>
                <button onClick={newChatConv} className="p-0.5 rounded hover:bg-slate-800 text-slate-600 hover:text-slate-400 transition-colors" title="New conversation">
                  <PlusCircle className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {/* New conversation entry */}
              <button
                onClick={newChatConv}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-lg border text-xs transition-all",
                  activeChatId === null
                    ? "border-blue-500/30 bg-blue-500/5 text-blue-300"
                    : "border-slate-800 bg-slate-900/50 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
                )}
              >
                + New conversation
              </button>
              {chatConvs.length === 0 ? (
                <p className="text-xs text-slate-700 px-2 py-4 text-center">No conversations yet</p>
              ) : (
                chatConvs.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      "group relative px-2.5 py-2 rounded-lg border cursor-pointer transition-all",
                      activeChatId === c.id
                        ? "border-blue-500/30 bg-blue-500/5 text-blue-300"
                        : "border-slate-800/60 bg-slate-900/40 hover:bg-slate-800/40 text-slate-400"
                    )}
                    onClick={() => { setActiveChatId(c.id); loadChatMessages(c.id); }}
                  >
                    <p className="text-xs leading-snug line-clamp-2 pr-5">
                      {c.title.replace(/^Agent Chat: /, "")}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChatConv(c.id); }}
                      className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 text-slate-600 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Chat message area */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {chatMsgs.length === 0 && !chatLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center py-10">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-3">
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                  </div>
                  <h2 className="text-sm font-semibold text-slate-300 font-[Syne]">Chat with AI Agent</h2>
                  <p className="mt-1.5 text-xs text-slate-500 max-w-xs leading-relaxed">
                    Percakapan bilingual (ID/EN). Riwayat tersimpan permanen.
                    Powered by <code className="text-blue-400 font-mono">Qwen2.5-Coder-32B</code>.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {["Bantu debug kode", "Jelaskan konsep ML", "Buat rencana proyek", "Tanya soal model AI"].map((hint) => (
                      <button
                        key={hint}
                        onClick={() => { setChatMessage(hint); chatInputRef.current?.focus(); }}
                        className="px-2.5 py-1 rounded-full bg-slate-800 text-xs text-slate-500 border border-slate-700 hover:text-slate-300 hover:border-slate-600 transition-colors"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMsgs.map((m, i) => (
                <ChatBubble key={m.id ?? i} role={m.role} content={m.content} />
              ))}

              {chatLoading && (
                <div className="flex gap-2.5 items-end">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-400">AI</div>
                  <div className="bg-slate-800/80 border border-slate-700/50 rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Chat input */}
            <div className="flex-shrink-0 border-t border-slate-800 bg-slate-900/50 p-3">
              <div className="flex gap-2">
                <textarea
                  ref={chatInputRef}
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  disabled={chatLoading}
                  placeholder="Ketik pesan… (Enter untuk kirim, Shift+Enter untuk baris baru)"
                  rows={2}
                  className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 disabled:opacity-50 transition-all leading-relaxed"
                />
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={sendChat}
                    disabled={chatLoading || !chatMessage.trim()}
                    className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={newChatConv}
                    className="px-3 py-2 rounded-xl border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
                    title="New conversation"
                  >
                    <PlusCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )} {/* end chat tab */}

    </div>
  );
}

// ─── Step group (collapsible) ─────────────────────────────────────────────────
function StepGroup({ stepNum, events }: { stepNum: number; events: AgentEvent[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasError = events.some((e) => e.type === "error");
  const toolCall = events.find((e) => e.type === "tool_call");

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
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-800/40 transition-colors"
      >
        <span className="text-xs font-mono text-slate-600 w-5 text-right flex-shrink-0">{stepNum}</span>
        <span className="flex-1 text-sm text-slate-400 truncate">
          {toolCall ? (
            <span>
              <span className="text-slate-500">→ </span>
              <code className="text-emerald-400 font-mono text-xs">{toolCall.tool}()</code>
            </span>
          ) : (
            <span className="text-slate-500">Thinking…</span>
          )}
        </span>
        {collapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
        }
      </button>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 pb-4 space-y-3 border-t border-slate-800/50"
          >
            <div className="pt-3 space-y-3">
              {events.map((ev, i) => (
                <EventCard key={i} event={ev} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
