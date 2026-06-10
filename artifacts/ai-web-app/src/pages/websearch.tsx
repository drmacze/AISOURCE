/**
 * DLavie OS — Web Search
 *
 * Real-time web search via DuckDuckGo — no API key required.
 * Results are then optionally summarized by the local Ollama model.
 */

import React, { useState, useRef, useEffect } from "react";
import {
  Globe, Search, Loader2, ExternalLink, Sparkles, RefreshCw,
  BookOpen, Zap, AlertCircle, Copy, Check, ChevronDown, ChevronUp,
  Clock, Star, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");
function getApiBase() {
  if (API_BASE) return API_BASE;
  return window.location.port === "5000"
    ? `${window.location.protocol}//${window.location.hostname}:8080`
    : "";
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "instant" | "related";
}

interface SearchData {
  query: string;
  results: SearchResult[];
  count: number;
  via: string;
}

const SUGGESTED = [
  "Latest AI research papers",
  "Transformer architecture explained",
  "Python async programming",
  "Open source LLM comparison",
  "RAG system design patterns",
  "Fine-tuning LLMs guide",
  "Vector database comparison",
];

function ResultCard({ result, onSummarize }: { result: SearchResult; onSummarize: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isInstant = result.source === "instant";

  return (
    <div className={cn(
      "rounded-xl border p-4 transition-all hover:border-white/20",
      isInstant
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-white/8 bg-slate-800/40"
    )}>
      {isInstant && (
        <div className="flex items-center gap-1.5 mb-2">
          <Zap className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Instant Answer</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h3 className="text-sm font-semibold text-white leading-snug">{result.title}</h3>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => { navigator.clipboard.writeText(result.snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="p-1 rounded hover:bg-white/10 text-slate-600 hover:text-slate-400 transition-colors"
            title="Copy snippet"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {result.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer"
              className="p-1 rounded hover:bg-white/10 text-slate-600 hover:text-slate-400 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
      {result.url && (
        <div className="text-[10px] text-slate-600 font-mono mb-2 truncate">
          {result.url.replace(/^https?:\/\//, "").slice(0, 60)}
        </div>
      )}
      <p className={cn("text-xs text-slate-400 leading-relaxed", !expanded && "line-clamp-3")}>
        {result.snippet}
      </p>
      {result.snippet.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 mt-1 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {result.snippet.length > 50 && (
        <button
          onClick={() => onSummarize(result.snippet)}
          className="mt-2 flex items-center gap-1.5 text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
        >
          <Sparkles className="w-3 h-3" />
          Summarize with AI
        </button>
      )}
    </div>
  );
}

export default function WebSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = async (q: string = query) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true); setError(""); setResults(null); setAiSummary("");
    try {
      const r = await fetch(`${getApiBase()}/api/search?q=${encodeURIComponent(trimmed)}&max=10`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setResults(data);
      setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 8));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const summarizeWithAI = async (text: string) => {
    setAiLoading(true); setAiSummary("");
    try {
      const r = await fetch(`${getApiBase()}/api/tools/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, maxLength: 120, minLength: 30 }),
      });
      if (!r.ok) {
        // Fallback to Ollama expand
        const r2 = await fetch(`${getApiBase()}/api/tools/bullets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, style: "bullets" }),
        });
        const d2 = await r2.json();
        setAiSummary(String(d2.output || ""));
      } else {
        const d = await r.json();
        setAiSummary(String(d.summary || ""));
      }
    } catch (e) {
      setAiSummary(`Error: ${String(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  const summarizeAll = async () => {
    if (!results?.results.length) return;
    const combined = results.results
      .slice(0, 5)
      .map((r) => `${r.title}: ${r.snippet}`)
      .join("\n\n");
    await summarizeWithAI(combined);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center">
            <Globe className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Web Search</h1>
            <p className="text-xs text-slate-400">Real-time DuckDuckGo search + AI summarization</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* Search box */}
          <div className="flex gap-2 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="Search the web…"
                className="pl-9 bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 h-11"
              />
            </div>
            <Button onClick={() => search()} disabled={loading || !query.trim()} className="bg-sky-600 hover:bg-sky-500 h-11 px-5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>

          {/* Suggested searches */}
          {!results && !loading && (
            <div className="space-y-5">
              <div>
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">Try searching for</div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setQuery(s); search(s); }}
                      className="px-3 py-1.5 rounded-full border border-white/10 text-xs text-slate-400 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {history.length > 0 && (
                <div>
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> Recent
                  </div>
                  <div className="space-y-1">
                    {history.map((h) => (
                      <button
                        key={h}
                        onClick={() => { setQuery(h); search(h); }}
                        className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
                      >
                        <RefreshCw className="w-3 h-3 text-slate-600" />
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-white/5 bg-slate-800/30 p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Search uses the DuckDuckGo Instant Answer API — no tracking, no API key needed.
                    Results can be summarized or analyzed using your local Ollama model.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
              <p className="text-sm text-slate-500 font-mono animate-pulse">Searching DuckDuckGo…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-red-400 font-medium">Search failed</p>
                <p className="text-xs text-slate-500 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Results */}
          {results && !loading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-400">
                    <span className="text-white font-medium">{results.count}</span> results for{" "}
                    <span className="text-sky-400 font-medium">"{results.query}"</span>
                  </span>
                  <Badge variant="outline" className="border-white/10 text-slate-500 text-[10px] font-mono px-1.5">
                    via {results.via}
                  </Badge>
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={summarizeAll}
                  disabled={aiLoading}
                  className="border-violet-500/30 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 h-7 text-xs"
                >
                  {aiLoading
                    ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                    : <Sparkles className="w-3 h-3 mr-1.5" />
                  }
                  Summarize All with AI
                </Button>
              </div>

              {/* AI Summary */}
              {(aiSummary || aiLoading) && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-semibold text-violet-400">AI Summary</span>
                  </div>
                  {aiLoading
                    ? <div className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" /><span className="text-xs text-slate-500 animate-pulse">Summarizing…</span></div>
                    : <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{aiSummary}</p>
                  }
                </div>
              )}

              {results.count === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Globe className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No results found. Try a different query.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {results.results.map((result, i) => (
                    <ResultCard key={i} result={result} onSummarize={summarizeWithAI} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
