/**
 * DLavie OS — Model Playground
 * Compare two AI models side-by-side with real streaming responses.
 * No simulation — all calls go through the real provider chain.
 */
import React, { useState, useRef, useCallback } from "react";
import { Loader2, Send, RotateCcw, Zap, Copy, Check, ChevronDown, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const BASE = (import.meta.env.BASE_URL || "").replace(/\/$/, "");

// ─── All available models (Groq + OpenRouter) ────────────────────────────────
const MODELS = [
  // ── Groq ──────────────────────────────────────────────────────────────────
  { id: "groq:openai/gpt-oss-120b",                            label: "OpenAI OSS 120B",      provider: "Groq",       badge: "120B",  color: "text-orange-400" },
  { id: "groq:meta-llama/llama-4-scout-17b-16e-instruct",      label: "Llama 4 Scout 17B",    provider: "Groq",       badge: "17B",   color: "text-blue-400"   },
  { id: "groq:qwen/qwen3-32b",                                  label: "Qwen3 32B",            provider: "Groq",       badge: "32B",   color: "text-cyan-400"   },
  { id: "groq:groq/compound",                                   label: "Groq Compound",        provider: "Groq",       badge: "MoE",   color: "text-emerald-400"},
  { id: "groq:llama-3.3-70b-versatile",                         label: "Llama 3.3 70B",        provider: "Groq",       badge: "70B",   color: "text-blue-400"   },
  { id: "groq:gemma2-9b-it",                                    label: "Gemma 2 9B",           provider: "Groq",       badge: "9B",    color: "text-violet-400" },
  { id: "groq:llama-3.1-8b-instant",                            label: "Llama 3.1 8B",         provider: "Groq",       badge: "Fast",  color: "text-green-400"  },
  { id: "groq:mixtral-8x7b-32768",                              label: "Mixtral 8x7B",         provider: "Groq",       badge: "MoE",   color: "text-pink-400"   },
  // ── OpenRouter ─────────────────────────────────────────────────────────────
  { id: "openrouter:deepseek/deepseek-r1:free",                 label: "DeepSeek R1",          provider: "OpenRouter", badge: "671B",  color: "text-amber-400"  },
  { id: "openrouter:qwen/qwen3-14b:free",                       label: "Qwen3 14B",            provider: "OpenRouter", badge: "14B",   color: "text-cyan-400"   },
  { id: "openrouter:microsoft/phi-4",                           label: "Phi-4",                provider: "OpenRouter", badge: "14B",   color: "text-violet-400" },
  { id: "openrouter:google/gemma-3-12b-it:free",                label: "Gemma 3 12B",          provider: "OpenRouter", badge: "12B",   color: "text-green-400"  },
  { id: "openrouter:meta-llama/llama-3.2-3b-instruct:free",     label: "Llama 3.2 3B",        provider: "OpenRouter", badge: "3B",    color: "text-blue-400"   },
];

const DEFAULT_LEFT  = MODELS[1].id; // Llama 4 Scout
const DEFAULT_RIGHT = MODELS[8].id; // DeepSeek R1

// ─── Model selector dropdown ─────────────────────────────────────────────────
function ModelSelector({ value, onChange, side }: { value: string; onChange: (v: string) => void; side: "L" | "R" }) {
  const [open, setOpen] = useState(false);
  const m = MODELS.find((x) => x.id === value) ?? MODELS[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-slate-900/80 hover:bg-slate-800/80 text-xs font-mono transition-all"
      >
        <span className={cn("font-semibold", m.color)}>{m.label}</span>
        <span className="text-slate-600 text-[10px]">{m.badge}</span>
        <span className="text-[10px] text-slate-600 ml-0.5">{m.provider}</span>
        <ChevronDown className="w-3 h-3 text-slate-500 ml-1" />
      </button>
      {open && (
        <div className={cn(
          "absolute z-50 top-full mt-1 w-64 rounded-xl border border-white/10 bg-slate-950 shadow-2xl py-1 max-h-72 overflow-y-auto",
          side === "R" ? "right-0" : "left-0"
        )}>
          {MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => { onChange(model.id); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-mono hover:bg-white/5 transition-colors",
                model.id === value && "bg-white/5"
              )}
            >
              <span className={cn("font-semibold truncate flex-1", model.color)}>{model.label}</span>
              <span className="text-[10px] text-slate-600 shrink-0">{model.badge}</span>
              <span className="text-[10px] text-slate-700 shrink-0">{model.provider}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single panel (one model's response) ─────────────────────────────────────
interface PanelState {
  text:       string;
  loading:    boolean;
  done:       boolean;
  error:      string | null;
  latencyMs:  number | null;
  startedAt:  number | null;
}

const EMPTY: PanelState = { text: "", loading: false, done: false, error: null, latencyMs: null, startedAt: null };

function ResponsePanel({
  state, model, side,
}: { state: PanelState; model: string; side: "L" | "R" }) {
  const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(state.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const elapsed = state.loading && state.startedAt ? Math.round((Date.now() - state.startedAt) / 100) / 10 : null;

  return (
    <div className={cn(
      "flex-1 min-w-0 flex flex-col rounded-xl border bg-slate-900/60 overflow-hidden",
      side === "L" ? "border-blue-500/20" : "border-violet-500/20"
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-4 py-2.5 border-b",
        side === "L" ? "border-blue-500/15 bg-blue-500/5" : "border-violet-500/15 bg-violet-500/5"
      )}>
        <div className="flex items-center gap-2">
          <Cpu className={cn("w-3.5 h-3.5", m.color)} />
          <span className={cn("text-xs font-semibold", m.color)}>{m.label}</span>
          <span className="text-[10px] text-slate-600 font-mono">{m.provider}</span>
        </div>
        <div className="flex items-center gap-2">
          {state.loading && elapsed && (
            <span className="text-[10px] text-slate-500 font-mono animate-pulse">{elapsed}s…</span>
          )}
          {state.done && state.latencyMs && (
            <span className="text-[10px] text-emerald-500/80 font-mono">{(state.latencyMs / 1000).toFixed(1)}s</span>
          )}
          {state.text && state.done && (
            <button onClick={copy} className="text-slate-500 hover:text-slate-300 transition-colors">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-4 overflow-y-auto min-h-[200px] max-h-[60vh] font-mono text-sm leading-relaxed">
        {!state.loading && !state.text && !state.error && (
          <span className="text-slate-600 text-xs italic">Menunggu prompt…</span>
        )}
        {state.loading && !state.text && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs animate-pulse">Menghubungi {m.provider}…</span>
          </div>
        )}
        {state.error && (
          <div className="text-red-400 text-xs p-2 rounded bg-red-500/10 border border-red-500/20">{state.error}</div>
        )}
        {state.text && (
          <div className="text-slate-200 whitespace-pre-wrap">{state.text}
            {state.loading && <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse rounded-sm" />}
          </div>
        )}
      </div>

      {/* Token count estimate */}
      {state.done && state.text && (
        <div className="px-4 py-1.5 border-t border-white/5 flex items-center gap-3 text-[10px] font-mono text-slate-600">
          <span>~{Math.round(state.text.length / 4)} tokens</span>
          <span>{state.text.split(/\s+/).length} words</span>
        </div>
      )}
    </div>
  );
}

// ─── Main playground page ────────────────────────────────────────────────────
export default function PlaygroundPage() {
  const [modelL, setModelL]   = useState(DEFAULT_LEFT);
  const [modelR, setModelR]   = useState(DEFAULT_RIGHT);
  const [prompt, setPrompt]   = useState("");
  const [system, setSystem]   = useState("Kamu adalah DLavie OS, asisten AI yang sangat membantu. Jawab dalam bahasa Indonesia kecuali jika diminta bahasa lain.");
  const [panelL, setPanelL]   = useState<PanelState>(EMPTY);
  const [panelR, setPanelR]   = useState<PanelState>(EMPTY);
  const [running, setRunning] = useState(false);
  const abortRef              = useRef<AbortController | null>(null);

  const streamFromProvider = useCallback(async (
    model: string,
    userPrompt: string,
    systemPrompt: string,
    setPanel: React.Dispatch<React.SetStateAction<PanelState>>,
    signal: AbortSignal
  ) => {
    const startedAt = Date.now();
    setPanel({ text: "", loading: true, done: false, error: null, latencyMs: null, startedAt });

    try {
      // Create a temporary conversation for the playground
      const convRes = await fetch(`${BASE}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `[Playground] ${userPrompt.slice(0, 40)}`, model }),
        signal,
      });
      if (!convRes.ok) throw new Error(`Gagal buat sesi: HTTP ${convRes.status}`);
      const conv = await convRes.json() as { id: number };

      // Stream the message
      const streamRes = await fetch(`${BASE}/api/conversations/${conv.id}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: systemPrompt ? `[System: ${systemPrompt}]\n\n${userPrompt}` : userPrompt }),
        signal,
      });

      if (!streamRes.ok || !streamRes.body) throw new Error(`HTTP ${streamRes.status}`);

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6)) as { token?: string; done?: boolean; fullText?: string; error?: string };
            if (d.token) { fullText += d.token; setPanel((p) => ({ ...p, text: fullText })); }
            if (d.fullText) { fullText = d.fullText; setPanel((p) => ({ ...p, text: fullText })); }
            if (d.error) throw new Error(d.error);
            if (d.done) break;
          } catch (parseErr) { /* skip bad lines */ }
        }
      }

      const latencyMs = Date.now() - startedAt;
      setPanel({ text: fullText, loading: false, done: true, error: null, latencyMs, startedAt });

      // Clean up playground conversation (fire and forget)
      fetch(`${BASE}/api/conversations/${conv.id}`, { method: "DELETE" }).catch(() => {});

    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setPanel((p) => ({ ...p, loading: false, done: true }));
      } else {
        setPanel({ text: "", loading: false, done: true, error: String(err), latencyMs: null, startedAt: null });
      }
    }
  }, []);

  const run = useCallback(async () => {
    if (!prompt.trim() || running) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);

    // Fire both providers simultaneously
    await Promise.all([
      streamFromProvider(modelL, prompt, system, setPanelL, ctrl.signal),
      streamFromProvider(modelR, prompt, system, setPanelR, ctrl.signal),
    ]);
    setRunning(false);
  }, [prompt, system, modelL, modelR, running, streamFromProvider]);

  const reset = () => {
    abortRef.current?.abort();
    setPanelL(EMPTY);
    setPanelR(EMPTY);
    setPrompt("");
    setRunning(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Model Playground</h1>
            <p className="text-xs text-slate-400">Bandingkan dua model AI secara side-by-side — real streaming, tanpa simulasi</p>
          </div>
        </div>
      </div>

      {/* Model selectors */}
      <div className="px-6 py-3 border-b border-white/5 flex items-center justify-between gap-4 flex-shrink-0">
        <ModelSelector value={modelL} onChange={setModelL} side="L" />
        <span className="text-[10px] font-mono text-slate-600 shrink-0">VS</span>
        <ModelSelector value={modelR} onChange={setModelR} side="R" />
      </div>

      {/* Response panels */}
      <div className="flex-1 flex gap-3 p-4 overflow-hidden min-h-0">
        <ResponsePanel state={panelL} model={modelL} side="L" />
        <ResponsePanel state={panelR} model={modelR} side="R" />
      </div>

      {/* System prompt (collapsible) */}
      <details className="px-4 py-1 border-t border-white/5 flex-shrink-0">
        <summary className="text-[11px] text-slate-500 font-mono cursor-pointer hover:text-slate-300 select-none py-1">System prompt (klik untuk edit)</summary>
        <textarea
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          rows={2}
          className="mt-1 w-full bg-slate-900/60 border border-white/8 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 resize-none focus:outline-none focus:border-primary/50"
        />
      </details>

      {/* Input bar */}
      <div className="px-4 pb-4 pt-2 flex-shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-slate-900/80 p-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ketik prompt… (Ctrl+Enter untuk kirim ke kedua model)"
            rows={2}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none font-mono leading-relaxed"
          />
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={reset}
              className="border-white/10 text-slate-400 hover:text-slate-200 h-8 px-2" title="Reset">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" onClick={run}
              disabled={!prompt.trim() || running}
              className="h-8 gap-1.5 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white border-0">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {running ? "Streaming…" : "Kirim"}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-slate-700 font-mono mt-1.5 text-center">
          Kedua model dikirim prompt bersamaan · Waktu respons terukur nyata dari API provider
        </p>
      </div>
    </div>
  );
}
