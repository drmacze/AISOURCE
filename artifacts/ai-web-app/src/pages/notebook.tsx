/**
 * DLavie OS — AI Notebook
 *
 * A scratchpad with AI assistance — write, analyze, transform text
 * with one-click AI operations powered by local Ollama and HuggingFace.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  BookMarked, Sparkles, Copy, Check, Trash2, Download, Save,
  ChevronDown, Loader2, RefreshCw, Wand2, MessageSquare, Brain,
  FileText, Zap, RotateCcw, AlignLeft, List, Type, Languages,
  Lightbulb, Code2, SplitSquareHorizontal, ArrowRight, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_BASE = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");
function getApiBase() {
  if (API_BASE) return API_BASE;
  return "";
}

async function callTool(endpoint: string, body: object): Promise<Record<string, unknown>> {
  const r = await fetch(`${getApiBase()}/api/tools/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.message || `HTTP ${r.status}`);
  return data;
}

interface ToolAction {
  id: string;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
  requiresOllama?: boolean;
  requiresHF?: boolean;
  action: (text: string) => Promise<string>;
}

const TOOLS: ToolAction[] = [
  {
    id: "summarize", label: "Summarize", icon: AlignLeft, color: "text-blue-400",
    description: "Create a concise summary",
    requiresHF: true,
    action: async (text) => {
      const d = await callTool("summarize", { text, maxLength: 200 });
      return String(d.summary || "");
    },
  },
  {
    id: "bullets", label: "Bullet Points", icon: List, color: "text-emerald-400",
    description: "Convert to structured bullets",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("bullets", { text, style: "bullets" });
      return String(d.output || "");
    },
  },
  {
    id: "expand", label: "Expand", icon: SplitSquareHorizontal, color: "text-violet-400",
    description: "Expand into detailed content",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("expand", { text, targetWords: 300, style: "informative" });
      return String(d.expanded || "");
    },
  },
  {
    id: "grammar", label: "Grammar Fix", icon: Check, color: "text-cyan-400",
    description: "Fix grammar and spelling",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("grammar", { text });
      return String(d.corrected || "");
    },
  },
  {
    id: "paraphrase", label: "Paraphrase", icon: RotateCcw, color: "text-amber-400",
    description: "Rewrite in different words",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("paraphrase", { text });
      return String(d.paraphrased || "");
    },
  },
  {
    id: "tone-formal", label: "Make Formal", icon: Type, color: "text-pink-400",
    description: "Rewrite in professional tone",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("tone-adjust", { text, targetTone: "formal professional" });
      return String(d.rewritten || "");
    },
  },
  {
    id: "tone-casual", label: "Make Casual", icon: MessageSquare, color: "text-orange-400",
    description: "Rewrite in casual friendly tone",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("tone-adjust", { text, targetTone: "casual conversational" });
      return String(d.rewritten || "");
    },
  },
  {
    id: "questions", label: "Generate Questions", icon: Lightbulb, color: "text-yellow-400",
    description: "Create comprehension questions",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("question-gen", { text, count: 5 });
      const qs = d.questions as string[] | undefined;
      if (Array.isArray(qs)) return qs.map((q, i) => `${i + 1}. ${q}`).join("\n");
      return String(d.questions || "");
    },
  },
  {
    id: "sentiment", label: "Sentiment", icon: Brain, color: "text-rose-400",
    description: "Analyze emotional tone",
    requiresHF: true,
    action: async (text) => {
      const d = await callTool("sentiment", { text });
      const s = d.sentiment as string;
      const c = d.confidence as number;
      const detail = d.detail as Array<{ label: string; score: number }> | undefined;
      let out = `Sentiment: ${s} (${c ? Math.round(c * 100) : "?"}% confidence)`;
      if (Array.isArray(detail)) out += "\n\n" + detail.map((x) => `${x.label}: ${Math.round(x.score * 100)}%`).join("\n");
      return out;
    },
  },
  {
    id: "keywords", label: "Keywords", icon: Zap, color: "text-emerald-300",
    description: "Extract key terms (TF-IDF)",
    action: async (text) => {
      const d = await callTool("keywords", { text, topK: 15 });
      const kws = d.keywords as Array<{ word: string; score: number }> | undefined;
      if (Array.isArray(kws)) return kws.map((k) => `${k.word} (${Math.round(k.score * 100)}%)`).join(", ");
      return String(d.keywords || "");
    },
  },
  {
    id: "code-gen", label: "Code from Text", icon: Code2, color: "text-teal-400",
    description: "Generate code from description",
    requiresOllama: true,
    action: async (text) => {
      const d = await callTool("code-gen", { prompt: text, language: "python" });
      return String(d.code || "");
    },
  },
  {
    id: "detect-lang", label: "Detect Language", icon: Languages, color: "text-indigo-400",
    description: "Identify the text language",
    action: async (text) => {
      const d = await callTool("detect-language", { text });
      return `Language: ${d.language} (${d.confidence}% confidence, method: ${d.method})`;
    },
  },
];

interface HistoryEntry {
  id: number;
  tool: string;
  inputSnippet: string;
  output: string;
  at: Date;
}

let historyIdCounter = 0;

export default function NotebookPage() {
  const { toast } = useToast();
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [wordCount, setWordCount] = useState({ input: 0, output: 0 });
  const outputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const iw = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
    const ow = outputText.trim() ? outputText.trim().split(/\s+/).length : 0;
    setWordCount({ input: iw, output: ow });
  }, [inputText, outputText]);

  const runTool = useCallback(async (tool: ToolAction) => {
    if (!inputText.trim()) {
      toast({ title: "No input", description: "Type or paste text in the left panel first.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setError("");
    setActiveToolId(tool.id);
    try {
      const result = await tool.action(inputText);
      setOutputText(result);
      setHistory((prev) => [
        { id: ++historyIdCounter, tool: tool.label, inputSnippet: inputText.slice(0, 60), output: result, at: new Date() },
        ...prev.slice(0, 19),
      ]);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      toast({ title: `${tool.label} failed`, description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
      setActiveToolId(null);
    }
  }, [inputText, toast]);

  const copyOutput = () => {
    navigator.clipboard.writeText(outputText);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
  };

  const moveOutputToInput = () => {
    setInputText(outputText);
    setOutputText("");
  };

  const downloadOutput = () => {
    const blob = new Blob([outputText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notebook-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
              <BookMarked className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">AI Notebook</h1>
              <p className="text-xs text-slate-400">Transform text with {TOOLS.length} AI operations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => { setInputText(""); setOutputText(""); setError(""); }}
              className="border-white/10 text-slate-400 hover:text-white h-8 text-xs"
              disabled={!inputText && !outputText}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear All
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Tools Panel */}
        <div className="w-52 shrink-0 border-r border-white/5 overflow-y-auto p-3 space-y-1.5">
          <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 mb-2">
            AI Operations
          </div>
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeToolId === tool.id && loading;
            return (
              <button
                key={tool.id}
                onClick={() => runTool(tool)}
                disabled={loading}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all",
                  "border border-transparent hover:border-white/10 hover:bg-white/5",
                  isActive && "bg-white/5 border-white/10",
                  loading && !isActive && "opacity-40"
                )}
              >
                {isActive
                  ? <Loader2 className={cn("w-3.5 h-3.5 shrink-0 animate-spin", tool.color)} />
                  : <Icon className={cn("w-3.5 h-3.5 shrink-0", tool.color)} />
                }
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-200 leading-tight">{tool.label}</div>
                  <div className="text-[10px] text-slate-600 leading-tight mt-0.5 truncate">{tool.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main Panels */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Error bar */}
          {error && (
            <div className="shrink-0 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError("")} className="ml-auto"><Check className="w-3.5 h-3.5" /></button>
            </div>
          )}

          <div className="flex-1 flex overflow-hidden">
            {/* Input panel */}
            <div className="flex-1 flex flex-col border-r border-white/5">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Input
                </span>
                <span className="text-[10px] text-slate-600 font-mono">{wordCount.input} words · {inputText.length} chars</span>
              </div>
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type or paste your text here…

Then click any AI operation in the left panel to transform it.

Examples:
• Paste an article → Summarize
• Write rough notes → Expand
• Paste messy text → Grammar Fix
• Write a description → Code from Text"
                className="flex-1 resize-none rounded-none border-0 bg-transparent text-slate-200 text-sm font-mono leading-relaxed placeholder:text-slate-700 focus-visible:ring-0 focus-visible:ring-offset-0 p-4"
              />
            </div>

            {/* Output panel */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" /> Output
                </span>
                <div className="flex items-center gap-1">
                  {outputText && (
                    <>
                      <span className="text-[10px] text-slate-600 font-mono mr-2">{wordCount.output} words</span>
                      <button
                        onClick={moveOutputToInput}
                        title="Move output to input"
                        className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={copyOutput}
                        className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                        title="Copy output"
                      >
                        {copiedOutput ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={downloadOutput}
                        className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                        title="Download as .txt"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
                  <p className="text-sm text-slate-500 font-mono animate-pulse">
                    Processing with {TOOLS.find((t) => t.id === activeToolId)?.label || "AI"}…
                  </p>
                </div>
              ) : outputText ? (
                <Textarea
                  ref={outputRef}
                  value={outputText}
                  onChange={(e) => setOutputText(e.target.value)}
                  className="flex-1 resize-none rounded-none border-0 bg-violet-500/3 text-slate-200 text-sm font-mono leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 p-4"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
                  <Wand2 className="w-10 h-10 text-slate-800" />
                  <p className="text-slate-600 text-sm">
                    Select an AI operation from the left to transform your input
                  </p>
                  <p className="text-slate-700 text-xs">
                    Results appear here and can be edited, copied, or chained
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* History Panel */}
        {history.length > 0 && (
          <div className="w-48 shrink-0 border-l border-white/5 overflow-y-auto p-3">
            <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 mb-2">
              History ({history.length})
            </div>
            <div className="space-y-1.5">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setOutputText(h.output)}
                  className="w-full text-left p-2 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/10 transition-all"
                >
                  <div className="text-[10px] font-medium text-violet-400">{h.tool}</div>
                  <div className="text-[10px] text-slate-600 truncate mt-0.5">{h.inputSnippet}…</div>
                  <div className="text-[10px] text-slate-700 mt-0.5">
                    {h.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
