import React from "react";
import { useLocation, useParams } from "wouter";
import {
  useListConversations,
  useGetConversation,
  useCreateConversation,
  useDeleteConversation,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, Trash2, Send, Bot, User, Loader2, MessageSquare,
  ChevronDown, Cpu, Zap, StopCircle, Sparkles, Cloud,
  Copy, Check, Download, Code2, ChevronRight, Mic, MicOff,
  FileDown,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import "../types/puter.d";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const PUTER_MODELS = [
  { name: "puter/claude-sonnet-4",      label: "Claude Sonnet 4",  provider: "puter" as const },
  { name: "puter/gpt-4o",               label: "GPT-4o",           provider: "puter" as const },
  { name: "puter/gemini-2.0-flash",     label: "Gemini Flash",     provider: "puter" as const },
  { name: "puter/meta-llama-3.1-70b",   label: "Llama 3.1 70B",   provider: "puter" as const },
];

// Kimi K2 — MoonshotAI 1T MoE — served via /api/kimi/chat/stream (HF Router or Moonshot API)
const KIMI_MODELS = [
  { name: "kimi/kimi-k2-instruct",       label: "Kimi K2 Instruct",  provider: "kimi" as const,
    description: "1T MoE · HF Router · Top reasoning & agentic" },
  { name: "kimi/kimi-k2-0711-preview",   label: "Kimi K2 Preview",   provider: "kimi" as const,
    description: "1T MoE · Official Moonshot API (needs MOONSHOT_API_KEY)" },
];

interface OllamaModel {
  name: string;
  size: number;
  parameterSize: string;
  quantization: string;
  family: string;
}

function useOllamaModels() {
  return useQuery<OllamaModel[]>({
    queryKey: ["ollama-models"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ollama-models`);
      if (!res.ok) return [];
      return res.json() as Promise<OllamaModel[]>;
    },
    refetchInterval: 15000,
  });
}

function useSystemMemory() {
  return useQuery<{ freeGB: number; totalGB: number }>({
    queryKey: ["system-memory"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (!res.ok) return { freeGB: 4, totalGB: 8 };
      const data = await res.json() as { memory?: { freeGB: number; totalGB: number } };
      return data.memory ?? { freeGB: 4, totalGB: 8 };
    },
    refetchInterval: 30000,
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// ─── Beautiful AI Thinking Animation ────────────────────────────────────────
const WAVE_HEIGHTS = [0.35, 0.65, 1, 0.75, 0.9, 0.5, 0.85, 0.4, 0.95, 0.6, 0.8, 0.45, 0.7, 0.55, 0.9];

function ThinkingWave({ model }: { model: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      {/* Audio-waveform equalizer */}
      <div className="flex items-end gap-[2px] h-6">
        {WAVE_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="w-[3px] bg-primary rounded-full origin-bottom"
            style={{
              height: `${Math.round(h * 24)}px`,
              animation: `wave-bar 0.9s ease-in-out infinite alternate`,
              animationDelay: `${i * 0.06}s`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-mono text-primary leading-none tracking-widest uppercase">
          Processing
        </span>
        <span className="text-[10px] text-muted-foreground font-mono leading-none">
          {model || "model"}
        </span>
      </div>
    </div>
  );
}

// ─── Neural Pulse (loading state before stream starts) ───────────────────────
function NeuralPulse() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="relative w-8 h-8 flex items-center justify-center">
        {/* Outer ring */}
        <span
          className="absolute inset-0 rounded-full border border-primary/30"
          style={{ animation: "neural-pulse 1.5s ease-in-out infinite" }}
        />
        <span
          className="absolute inset-1 rounded-full border border-primary/50"
          style={{ animation: "neural-pulse 1.5s ease-in-out 0.3s infinite" }}
        />
        {/* Core dot */}
        <span
          className="w-2 h-2 rounded-full bg-primary"
          style={{ animation: "neural-pulse 1.5s ease-in-out 0.6s infinite" }}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-mono text-primary tracking-widest uppercase leading-none">
          Neural Init
        </span>
        <span className="text-[10px] text-muted-foreground font-mono leading-none">
          loading model...
        </span>
      </div>
    </div>
  );
}

export default function Chat() {
  const [, setLocation] = useLocation();
  const params = useParams();
  const activeId = params.id ? parseInt(params.id, 10) : null;
  const queryClient = useQueryClient();
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const [input, setInput] = React.useState("");
  const [streamingText, setStreamingText] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [streamPhase, setStreamPhase] = React.useState<"init" | "tokens">("init");
  const [selectedModel, setSelectedModel] = React.useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false);
  const [switchingModel, setSwitchingModel] = React.useState(false);
  const [ragIndicator, setRagIndicator] = React.useState(false);
  const [usePuter, setUsePuter] = React.useState(false);
  const [useKimi, setUseKimi]   = React.useState(false);
  const [puterError, setPuterError] = React.useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<number | string | null>(null);
  const [voiceActive, setVoiceActive] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const [renamingId, setRenamingId] = React.useState<number | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  const { data: conversations, isLoading: loadingConvos } = useListConversations();
  const { data: activeConversation, isLoading: loadingActive } = useGetConversation(
    activeId || 0,
    { query: { enabled: !!activeId, queryKey: getGetConversationQueryKey(activeId || 0) } }
  );
  const { data: ollamaModels, isLoading: loadingModels } = useOllamaModels();
  const { data: systemMemory } = useSystemMemory();

  const allModels = React.useMemo(() => {
    const local = (ollamaModels || []).map((m) => ({ ...m, provider: "local" as const }));
    const cloud = PUTER_MODELS.map((m) => ({ ...m, provider: "cloud" as const }));
    const kimi  = KIMI_MODELS.map((m) => ({ ...m, size: 0, parameterSize: "1T", modified: "" }));
    return [...local, ...cloud, ...kimi];
  }, [ollamaModels]);

  // Sync model state when conversation loads or model list changes
  React.useEffect(() => {
    if (activeConversation?.model) {
      const m = activeConversation.model;
      setSelectedModel(m);
      // CRITICAL: set provider flags so routing works on page load / refresh
      const entry = allModels.find((x) => x.name === m);
      setUsePuter(entry?.provider === "cloud");
      setUseKimi(entry?.provider === "kimi");
    } else if (allModels.length > 0 && !selectedModel) {
      setSelectedModel(allModels[0].name);
    }
  }, [activeConversation?.model, allModels]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages, streamingText, isStreaming]);

  // ── Prompt Library injection: pick up prompt from /prompts page ─────────────
  React.useEffect(() => {
    const injectedPrompt = sessionStorage.getItem("nexus_prompt_inject");
    const injectedName   = sessionStorage.getItem("nexus_prompt_name");
    if (injectedPrompt) {
      sessionStorage.removeItem("nexus_prompt_inject");
      sessionStorage.removeItem("nexus_prompt_name");
      setInput(injectedPrompt);
      // Auto-create a new conversation titled after the prompt
      if (!activeId) {
        const model = selectedModel || ollamaModels?.[0]?.name || "tinyllama";
        createMutation.mutate({ data: { title: injectedName || "Prompt Session", model } });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renameMutation = useQuery({
    queryKey: ["rename-noop"],
    queryFn: () => Promise.resolve(null),
    enabled: false,
  });
  const submitRename = async (id: number, newTitle: string) => {
    if (!newTitle.trim()) { setRenamingId(null); return; }
    await fetch(`${BASE}/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    setRenamingId(null);
  };
  const bulkDeleteMutation = React.useCallback(async () => {
    if (!window.confirm("Delete ALL conversations? This cannot be undone.")) return;
    await fetch(`${BASE}/api/conversations`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    setLocation("/chat");
  }, [queryClient, setLocation]);

  const createMutation = useCreateConversation({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        setLocation(`/chat/${data.id}`);
      },
    },
  });

  const deleteMutation = useDeleteConversation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        if (activeId) setLocation("/chat");
      },
    },
  });

  const handleCreate = () => {
    const model = selectedModel || ollamaModels?.[0]?.name || "tinyllama";
    createMutation.mutate({ data: { title: "New Conversation", model } });
  };

  const handleSwitchModel = async (model: string) => {
    if (!activeId || switchingModel) return;
    setSwitchingModel(true);
    setModelDropdownOpen(false);
    setPuterError(null);
    const entry = allModels.find((m) => m.name === model);
    try {
      const res = await fetch(`${BASE}/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        setSelectedModel(model);
        setUsePuter(entry?.provider === "cloud");
        setUseKimi(entry?.provider === "kimi");
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(activeId) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      }
    } finally {
      setSwitchingModel(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeId || isStreaming) return;

    const message = input.trim();
    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    setStreamPhase("init");
    setRagIndicator(false);
    setPuterError(null);

    queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(activeId) });

    const controller = new AbortController();
    abortRef.current = controller;

    // ── Route by model provider — derive from model entry, NOT from potentially-stale state ──
    const activeModelEntry = allModels.find((m) => m.name === selectedModel);

    // ── Kimi K2 path — HuggingFace Router or Moonshot API ───────────────────
    if (activeModelEntry?.provider === "kimi") {
      try {
        const response = await fetch(`${BASE}/api/kimi/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: String(activeId), content: message }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string; reason?: string };
          throw new Error(err.error || err.reason || `HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6)) as { token?: string; done?: boolean; error?: string };
              if (data.error) { setStreamingText(`[Kimi K2 error: ${data.error}]`); break; }
              if (data.token) { accumulated += data.token; setStreamingText(accumulated); setStreamPhase("tokens"); }
              if (data.done) break;
            } catch { /* skip malformed */ }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          const msg = err.message;
          setPuterError(msg);
          setStreamingText(`[Kimi K2 error: ${msg}]`);
          setStreamPhase("tokens");
        }
      } finally {
        setIsStreaming(false);
        setStreamPhase("init");
        abortRef.current = null;
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(activeId) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        // Keep streaming text visible briefly while the message is saved to the DB
        setTimeout(() => setStreamingText(""), 1500);
      }
      return;
    }

    // ── Puter.js cloud AI path ───────────────────────────────────────────────
    if (activeModelEntry?.provider === "cloud") {
      try {
        if (typeof puter === "undefined") {
          throw new Error("Puter.js not loaded — make sure the script tag is present in index.html");
        }
        const modelId = activeModelEntry.name.replace("puter/", "");
        setStreamPhase("init");
        const resp = await puter.ai.chat(message, { model: modelId, stream: false });
        const aiText = (resp?.message?.content ?? resp?.text ?? "") as string;
        // Show streaming text while saving
        setStreamingText(aiText);
        setStreamPhase("tokens");
        // Save BOTH user message and AI response to the server as a pair
        await fetch(`${BASE}/api/conversations/${activeId}/messages/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userContent: message, assistantContent: aiText }),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setPuterError(msg);
        setStreamingText(`[Puter.js error: ${msg}]`);
        setStreamPhase("tokens");
      } finally {
        setIsStreaming(false);
        setStreamPhase("init");
        abortRef.current = null;
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(activeId) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        // Keep streaming text visible briefly while the message is saved to the DB
        setTimeout(() => setStreamingText(""), 1500);
      }
      return;
    }

    // ── Local Ollama SSE path ─────────────────────────────────────────────────
    try {
      const response = await fetch(`${BASE}/api/conversations/${activeId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6)) as {
              token?: string;
              done?: boolean;
              fullText?: string;
              error?: string;
            };

            if (data.error) {
              setStreamingText(`[Error: ${data.error}]`);
              break;
            }

            if (data.token) {
              accumulated += data.token;
              setStreamingText(accumulated);
              setStreamPhase("tokens");
              if (!ragIndicator && accumulated.length > 30) setRagIndicator(true);
            }

            if (data.done) break;
          } catch {
            // skip malformed
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setStreamingText("[Connection error — check server status]");
        setStreamPhase("tokens");
      }
    } finally {
      setIsStreaming(false);
      setStreamPhase("init");
      abortRef.current = null;
      queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(activeId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      // Keep streaming text visible briefly while the message is saved to the DB
      setTimeout(() => setStreamingText(""), 1500);
    }
  };

  const handleStopStream = () => {
    abortRef.current?.abort();
  };

  // ── Voice Input via Web Speech API ─────────────────────────────────────────
  const handleVoiceToggle = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    if (voiceActive && recognitionRef.current) {
      recognitionRef.current.stop();
      setVoiceActive(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setVoiceActive(true);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      setInput(transcript);
    };

    recognition.onend = () => {
      setVoiceActive(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setVoiceActive(false);
      recognitionRef.current = null;
    };

    recognition.start();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as React.FormEvent);
    }
  };

  const activeModel = selectedModel || activeConversation?.model || "";

  return (
    <div className="flex h-full w-full bg-background relative" onClick={() => setModelDropdownOpen(false)}>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      {/* ── Conversation Sidebar ─────────────────────────────────────────────── */}
      <div className={`
        ${mobileSidebarOpen ? "flex" : "hidden"} md:flex
        w-72 border-r border-border bg-sidebar flex-col
        absolute md:relative inset-y-0 left-0 z-40 md:z-auto
      `}>
        <div className="p-4 border-b border-border">
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="w-full justify-start gap-2 font-mono"
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            NEW_SESSION
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {loadingConvos ? (
              <div className="p-4 text-center text-muted-foreground text-sm font-mono animate-pulse">
                Loading...
              </div>
            ) : conversations?.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm font-mono">
                No sessions
              </div>
            ) : (
              conversations?.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setLocation(`/chat/${c.id}`)}
                  className={`group flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors ${
                    activeId === c.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-medium truncate">{c.title}</span>
                    <span className="text-xs text-muted-foreground font-mono mt-0.5">
                      {format(new Date(c.createdAt), "MMM d, HH:mm")}
                    </span>
                    {c.model && c.model !== "default" && (
                      <span className="text-[10px] text-primary/70 font-mono mt-0.5 truncate">
                        {c.model.split(":")[0]}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-blue-400"
                      title="Export conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = `${BASE}/api/conversations/${c.id}/export?format=md`;
                        const a = document.createElement("a");
                        a.href = url; a.download = `conversation-${c.id}.md`;
                        a.click();
                      }}
                    >
                      <FileDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate({ id: c.id });
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Installed models panel */}
        <div className="border-t border-border p-3">
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2">
            Installed Models
          </p>
          {loadingModels ? (
            <div className="text-xs text-muted-foreground font-mono animate-pulse">Loading...</div>
          ) : (ollamaModels || []).length === 0 ? (
            <div className="text-xs text-muted-foreground font-mono">No models installed</div>
          ) : (
            <div className="space-y-1">
              {(ollamaModels || []).map((m) => (
                <div
                  key={m.name}
                  onClick={() => activeId && handleSwitchModel(m.name)}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-xs font-mono cursor-pointer transition-colors hover:bg-accent/50 ${
                    m.name === activeModel ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  <span className="text-foreground/80 truncate">{m.name.split(":")[0]}</span>
                  <span className="text-muted-foreground ml-2 shrink-0">{m.parameterSize}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main Chat Area ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-background/50">
        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground space-y-5 p-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-mono text-base text-foreground/80">No session selected</p>
              <p className="text-sm text-muted-foreground">Create a new conversation or pick one from the sidebar</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                New Chat
              </button>
              <button
                className="md:hidden flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-colors"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <MessageSquare className="w-4 h-4" />
                View Sessions
              </button>
            </div>
            {ollamaModels && ollamaModels.length > 0 && (
              <div className="text-xs font-mono text-muted-foreground bg-accent/30 px-3 py-1.5 rounded-full">
                ⚡ {ollamaModels.length} local model{ollamaModels.length > 1 ? "s" : ""} ready
              </div>
            )}
          </div>
        ) : loadingActive ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Header with Model Switcher */}
            <div className="h-14 border-b border-border flex items-center px-4 bg-card/50 backdrop-blur-sm sticky top-0 z-20 gap-3">
              {/* Mobile: open conversation sidebar */}
              <button
                className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent transition-colors text-muted-foreground flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); setMobileSidebarOpen(true); }}
                aria-label="Open conversations"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              <h2 className="font-medium font-sans truncate flex-1">
                {activeConversation?.title}
              </h2>

              {ragIndicator && isStreaming && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-green-400 bg-green-400/10 border border-green-400/20">
                  <Zap className="w-3 h-3" />
                  RAG
                </div>
              )}

              {/* Model Switcher */}
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  disabled={switchingModel || loadingModels}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono bg-accent hover:bg-accent/80 text-primary border border-border transition-colors disabled:opacity-50"
                >
                  <Cpu className="w-3 h-3" />
                  <span className="max-w-[140px] truncate">
                    {switchingModel ? "Switching..." : (activeModel || "select model")}
                  </span>
                  {switchingModel ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>

                <AnimatePresence>
                  {modelDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.12 }}
                      className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                      <div className="px-3 py-2 border-b border-border">
                        <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                          Select AI Model
                        </p>
                      </div>
                      {loadingModels ? (
                        <div className="p-4 text-center text-sm font-mono text-muted-foreground animate-pulse">
                          Loading models...
                        </div>
                      ) : (
                        <div className="py-1 max-h-64 overflow-y-auto">
                          {/* Local Ollama Models */}
                          {(ollamaModels || []).length > 0 && (
                            <div>
                              <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                                Local · Ollama
                              </div>
                              {(ollamaModels || []).map((m) => {
                                const isActive = m.name === activeModel;
                                const freeGB = systemMemory?.freeGB ?? 4;
                                const needsGB = parseFloat((m.size * 1.25 / 1e9).toFixed(1));
                                const tooLarge = needsGB > freeGB;
                                return (
                                  <button
                                    key={m.name}
                                    onClick={() => handleSwitchModel(m.name)}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/50 transition-colors ${
                                      isActive ? "bg-accent text-primary" : tooLarge ? "text-muted-foreground" : "text-foreground"
                                    }`}
                                  >
                                    <div className="flex flex-col">
                                      <span className="text-sm font-medium font-mono">{m.name}</span>
                                      <span className="text-xs text-muted-foreground mt-0.5">
                                        {m.family} · {m.parameterSize} · {m.quantization}
                                      </span>
                                    </div>
                                    <div className="flex flex-col items-end ml-2 shrink-0">
                                      <span className="text-xs font-mono text-muted-foreground">
                                        {formatBytes(m.size)}
                                      </span>
                                      {tooLarge ? (
                                        <span className="text-[10px] font-mono mt-0.5 px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                                          needs {needsGB}GB
                                        </span>
                                      ) : isActive ? (
                                        <span className="text-[10px] text-primary font-mono mt-0.5">
                                          ACTIVE
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-mono mt-0.5 text-green-400">
                                          fits
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {/* Kimi K2 Models */}
                          <div>
                            <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono uppercase tracking-widest border-t border-border mt-1 pt-2">
                              🌙 Kimi K2 · MoonshotAI
                            </div>
                            {KIMI_MODELS.map((m) => {
                              const isActive = m.name === activeModel;
                              return (
                                <button
                                  key={m.name}
                                  onClick={() => handleSwitchModel(m.name)}
                                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/50 transition-colors ${
                                    isActive ? "bg-accent text-primary" : "text-foreground"
                                  }`}
                                >
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium font-mono">{m.label}</span>
                                    <span className="text-xs text-muted-foreground mt-0.5">{m.description}</span>
                                  </div>
                                  <div className="flex flex-col items-end ml-2">
                                    <span className="text-[10px] text-amber-400 font-mono border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 rounded-full">1T</span>
                                    {isActive && (
                                      <span className="text-[10px] text-primary font-mono mt-0.5">ACTIVE</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {/* Cloud Puter Models */}
                          <div>
                            <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono uppercase tracking-widest border-t border-border mt-1 pt-2">
                              Cloud · Puter.js
                            </div>
                            {PUTER_MODELS.map((m) => {
                              const isActive = m.name === activeModel;
                              return (
                                <button
                                  key={m.name}
                                  onClick={() => handleSwitchModel(m.name)}
                                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/50 transition-colors ${
                                    isActive ? "bg-accent text-primary" : "text-foreground"
                                  }`}
                                >
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium font-mono">{m.label}</span>
                                    <span className="text-xs text-muted-foreground mt-0.5">
                                      {m.name.replace("puter/", "")}
                                    </span>
                                  </div>
                                  <div className="flex flex-col items-end ml-2">
                                    <Cloud className="w-3 h-3 text-muted-foreground" />
                                    {isActive && (
                                      <span className="text-[10px] text-primary font-mono mt-0.5">
                                        ACTIVE
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="px-3 py-2 border-t border-border">
                        <p className="text-[10px] text-muted-foreground font-mono">
                          🌙 Kimi K2 via HF Router · ☁ Cloud via Puter.js · ⚡ Local via Ollama
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-6">
              <div className="max-w-3xl mx-auto space-y-8 pb-8">
                <AnimatePresence initial={false}>
                  {activeConversation?.messages
                    ?.filter((m) => m.role !== "system")
                    .map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                    >
                      <div
                        className={`w-8 h-8 shrink-0 rounded-md flex items-center justify-center ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-accent text-accent-foreground border border-border"
                        }`}
                      >
                        {msg.role === "user" ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                      </div>
                      <div
                        className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} max-w-[80%]`}
                      >
                        <div
                          className={`px-4 py-3 rounded-xl ${
                            msg.role === "user"
                              ? "bg-primary/10 border border-primary/20 text-foreground rounded-tr-sm"
                              : "glass-panel text-foreground rounded-tl-sm"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        </div>
                        {msg.tokens && (
                          <span className="text-[10px] text-muted-foreground mt-1 font-mono">
                            {msg.tokens} tokens
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* ── Live Streaming Output ─────────────────────────────────── */}
                {isStreaming && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-4"
                  >
                    {/* AI Avatar with pulse ring when thinking */}
                    <div className="relative w-8 h-8 shrink-0">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center bg-accent text-accent-foreground border border-border">
                        {streamPhase === "init" ? (
                          <Sparkles className="w-4 h-4 text-primary" style={{ animation: "neural-pulse 1.2s ease-in-out infinite" }} />
                        ) : (
                          <Bot className="w-5 h-5" />
                        )}
                      </div>
                      {streamPhase === "init" && (
                        <span
                          className="absolute inset-0 rounded-md border border-primary/40"
                          style={{ animation: "neural-pulse 1.2s ease-in-out infinite" }}
                        />
                      )}
                    </div>

                    <div className="flex flex-col items-start max-w-[80%]">
                      <div className="px-4 py-3 rounded-xl rounded-tl-sm glass-panel text-foreground min-w-[120px]">
                        {streamPhase === "init" ? (
                          // Neural init state — pulsing rings
                          <NeuralPulse />
                        ) : streamingText ? (
                          // Streaming tokens with waveform
                          <div>
                            {streamingText.length > 20 && (
                              <div className="mb-2">
                                <ThinkingWave model={activeModel} />
                              </div>
                            )}
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                              {streamingText}
                              <span
                                className="inline-block w-0.5 h-4 bg-primary ml-0.5 rounded-sm align-middle"
                                style={{ animation: "cursor-blink 0.7s step-end infinite" }}
                              />
                            </p>
                          </div>
                        ) : (
                          <ThinkingWave model={activeModel} />
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-1 font-mono flex items-center gap-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-primary inline-block"
                          style={{ animation: "neural-pulse 1s ease-in-out infinite" }}
                        />
                        {streamPhase === "init" ? "Initializing model..." : `Streaming · ${activeModel}`}
                      </span>
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t border-border bg-background">
              <form onSubmit={handleSend} className="max-w-3xl mx-auto relative">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={voiceActive ? "🎙 Listening..." : isStreaming ? "AI is responding..." : "Query NEXUS_OS..."}
                  className="pr-24 h-12 bg-card border-card-border focus-visible:ring-primary font-mono text-sm"
                  disabled={isStreaming}
                />
                <div className="absolute right-1 top-1 flex gap-1">
                  {/* Voice input button */}
                  {!isStreaming && (
                    <Button
                      type="button"
                      size="icon"
                      variant={voiceActive ? "destructive" : "ghost"}
                      className="h-10 w-10"
                      onClick={handleVoiceToggle}
                      title={voiceActive ? "Stop recording" : "Voice input"}
                    >
                      {voiceActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                  )}
                  {isStreaming ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="h-10 w-10"
                      onClick={handleStopStream}
                    >
                      <StopCircle className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="icon"
                      className="h-10 w-10"
                      disabled={!input.trim()}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </form>
              <div className="max-w-3xl mx-auto mt-2 text-center">
                <span className="text-xs text-muted-foreground font-mono">
                  {isStreaming
                    ? "Generating response — click ■ to stop"
                    : `${activeModel ? `${activeModel} ·` : ""} Enter to send · ${
                        activeModel.startsWith("kimi/")
                          ? "🌙 Kimi K2 via HuggingFace Router"
                          : activeModel.startsWith("puter/")
                          ? "☁ Cloud AI via Puter.js"
                          : "⚡ Local AI via Ollama"
                      }`}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
