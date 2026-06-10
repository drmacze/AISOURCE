import React, { useState } from "react";
import {
  Wand2, Languages, Heart, Tag, User, Key, MessageSquare, CheckSquare,
  Loader2, Copy, CheckCheck, AlertCircle, ChevronDown, ChevronRight,
  Sparkles, Zap, Globe, BookOpen, Brain, Cpu,
  Code2, List, SplitSquareHorizontal, RotateCcw, Type, Lightbulb,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");

function getApiBase() {
  if (API_BASE) return API_BASE;
  return window.location.port === "5000" ? `${window.location.protocol}//${window.location.hostname}:8080` : "";
}

async function callTool(endpoint: string, body: object) {
  const res = await fetch(`${getApiBase()}/api/tools/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function ResultBox({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-slate-800/60 p-4", className)}>
      {title && <div className="text-xs text-slate-400 font-mono mb-2 uppercase tracking-wider">{title}</div>}
      {children}
    </div>
  );
}

// ─── Summarize ────────────────────────────────────────────────────────────────
function SummarizeTab() {
  const [text, setText] = useState("");
  const [maxLen, setMaxLen] = useState("150");
  const [result, setResult] = useState<{ summary: string; compressionRatio: number; model: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await callTool("summarize", { text, maxLength: parseInt(maxLen) || 150, minLength: 30 });
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Paste long text here to summarize…"
        className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[140px] text-sm resize-none"
      />
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-400">Max length:</label>
        <Input value={maxLen} onChange={(e) => setMaxLen(e.target.value)} className="w-24 h-8 bg-slate-800/60 border-white/10 text-white text-sm" type="number" min="30" max="500" />
        <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-emerald-600 hover:bg-emerald-500 ml-auto">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
          Summarize
        </Button>
      </div>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Summary">
          <div className="flex items-start justify-between gap-2">
            <p className="text-slate-200 text-sm leading-relaxed">{result.summary}</p>
            <CopyButton text={result.summary} />
          </div>
          <div className="flex gap-3 mt-3 pt-3 border-t border-white/5">
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs">
              {result.compressionRatio}% compressed
            </Badge>
            <Badge variant="outline" className="border-slate-500/30 text-slate-400 text-xs">
              {result.model.split("/").pop()}
            </Badge>
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Translate ────────────────────────────────────────────────────────────────
const LANGS = [
  { code: "en", label: "English" }, { code: "fr", label: "French" }, { code: "de", label: "German" },
  { code: "es", label: "Spanish" }, { code: "it", label: "Italian" }, { code: "pt", label: "Portuguese" },
  { code: "zh", label: "Chinese" }, { code: "ar", label: "Arabic" }, { code: "ja", label: "Japanese" },
  { code: "ru", label: "Russian" }, { code: "id", label: "Indonesian" },
];

function TranslateTab() {
  const [text, setText] = useState("");
  const [from, setFrom] = useState("en");
  const [to, setTo] = useState("fr");
  const [result, setResult] = useState<{ translation: string; model: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await callTool("translate", { text, from, to });
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs text-slate-400 mb-1.5 block">From</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full bg-slate-800/60 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-slate-400 mb-1.5 block">To</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full bg-slate-800/60 border border-white/10 rounded-md px-3 py-2 text-sm text-white">
            {LANGS.filter((l) => l.code !== from).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to translate…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-blue-600 hover:bg-blue-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />}
        Translate
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Translation">
          <div className="flex items-start justify-between gap-2">
            <p className="text-slate-200 text-sm leading-relaxed">{result.translation}</p>
            <CopyButton text={result.translation} />
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono">{result.model}</div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Sentiment ────────────────────────────────────────────────────────────────
function SentimentTab() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ label: string; confidence: number; all: Array<{ label: string; score: number }> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("sentiment", { text })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const sentColor = result?.label === "POSITIVE" ? "text-emerald-400" : result?.label === "NEGATIVE" ? "text-red-400" : "text-amber-400";
  const sentBg = result?.label === "POSITIVE" ? "bg-emerald-500/10 border-emerald-500/20" : result?.label === "NEGATIVE" ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20";

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text to analyze sentiment…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-pink-600 hover:bg-pink-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Heart className="w-4 h-4 mr-2" />}
        Analyze Sentiment
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <div className={cn("rounded-lg border p-4 text-center", sentBg)}>
          <div className={cn("text-2xl font-bold tracking-wide mb-1", sentColor)}>{result.label}</div>
          <div className="text-slate-300 text-sm">{result.confidence}% confidence</div>
          <div className="mt-3 pt-3 border-t border-white/5 flex gap-3 justify-center">
            {result.all.map((r) => (
              <span key={r.label} className="text-xs text-slate-400">{r.label}: <span className="text-slate-200">{Math.round(r.score * 100)}%</span></span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Zero-shot Classify ───────────────────────────────────────────────────────
function ClassifyTab() {
  const [text, setText] = useState("");
  const [labelsRaw, setLabelsRaw] = useState("technology, sports, politics, entertainment, science, business");
  const [result, setResult] = useState<{ topLabel: string; confidence: number; results: Array<{ label: string; confidence: number }> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    const labels = labelsRaw.split(",").map((l) => l.trim()).filter(Boolean);
    if (labels.length === 0) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("classify", { text, labels })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to classify…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block">Labels (comma-separated)</label>
        <Input value={labelsRaw} onChange={(e) => setLabelsRaw(e.target.value)} className="bg-slate-800/60 border-white/10 text-white text-sm" placeholder="label1, label2, label3…" />
      </div>
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-violet-600 hover:bg-violet-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Tag className="w-4 h-4 mr-2" />}
        Classify
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Classification Results">
          <div className="space-y-2">
            {result.results.map((r, i) => (
              <div key={r.label} className="flex items-center gap-3">
                <div className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0", i === 0 ? "border-violet-400 bg-violet-400/20" : "border-slate-600")} />
                <span className={cn("text-sm flex-1", i === 0 ? "text-white font-medium" : "text-slate-400")}>{r.label}</span>
                <div className="flex items-center gap-2 min-w-[80px]">
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${r.confidence}%` }} />
                  </div>
                  <span className="text-xs text-slate-400 w-8 text-right">{r.confidence}%</span>
                </div>
              </div>
            ))}
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── NER ─────────────────────────────────────────────────────────────────────
const NER_COLORS: Record<string, string> = {
  PER: "text-blue-300 bg-blue-500/15 border-blue-500/30",
  ORG: "text-amber-300 bg-amber-500/15 border-amber-500/30",
  LOC: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
  MISC: "text-violet-300 bg-violet-500/15 border-violet-500/30",
};

function NERTab() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ entities: Array<{ type: string; text: string; score: number }>; byType: Record<string, number>; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("ner", { text })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text to extract entities…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-cyan-600 hover:bg-cyan-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <User className="w-4 h-4 mr-2" />}
        Extract Entities
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title={`${result.count} Entities Found`}>
          {result.count === 0 ? (
            <p className="text-slate-400 text-sm">No named entities detected in this text.</p>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap mb-3">
                {Object.entries(result.byType).map(([type, count]) => (
                  <Badge key={type} variant="outline" className={cn("text-xs border", NER_COLORS[type] || "text-slate-300 bg-slate-500/15 border-slate-500/30")}>
                    {type}: {count}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {result.entities.map((e, i) => (
                  <span key={i} className={cn("px-2 py-0.5 rounded border text-xs font-medium", NER_COLORS[e.type] || "text-slate-300 bg-slate-500/15 border-slate-500/30")}>
                    {e.text}
                    <span className="opacity-60 ml-1 text-[10px]">{e.type}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </ResultBox>
      )}
    </div>
  );
}

// ─── Keywords ─────────────────────────────────────────────────────────────────
function KeywordsTab() {
  const [text, setText] = useState("");
  const [topK, setTopK] = useState("15");
  const [result, setResult] = useState<{ keywords: Array<{ keyword: string; score: number; frequency: number }>; totalWords: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("keywords", { text, topK: parseInt(topK) || 15 })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const maxScore = result?.keywords[0]?.score || 1;

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste any text to extract keywords…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[140px] text-sm resize-none" />
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-400">Top K:</label>
        <Input value={topK} onChange={(e) => setTopK(e.target.value)} className="w-20 h-8 bg-slate-800/60 border-white/10 text-white text-sm" type="number" min="5" max="30" />
        <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-orange-600 hover:bg-orange-500 ml-auto">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
          Extract
        </Button>
      </div>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title={`Top Keywords (${result.totalWords} words analyzed)`}>
          <div className="space-y-2">
            {result.keywords.map((kw) => (
              <div key={kw.keyword} className="flex items-center gap-3">
                <span className="text-slate-200 text-sm font-mono w-28 truncate">{kw.keyword}</span>
                <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(kw.score / maxScore) * 100}%` }} />
                </div>
                <span className="text-xs text-slate-400 w-12 text-right">×{kw.frequency}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-1.5">
            {result.keywords.slice(0, 8).map((kw) => (
              <Badge key={kw.keyword} variant="outline" className="border-orange-500/30 text-orange-300 text-xs">{kw.keyword}</Badge>
            ))}
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── QA ──────────────────────────────────────────────────────────────────────
function QATab() {
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [result, setResult] = useState<{ answer: string; confidence: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!question.trim() || !context.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("qa", { question, context })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block">Context / Passage</label>
        <Textarea value={context} onChange={(e) => setContext(e.target.value)} placeholder="Paste the text passage here…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block">Question</label>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What is…?" className="bg-slate-800/60 border-white/10 text-white text-sm" onKeyDown={(e) => e.key === "Enter" && run()} />
      </div>
      <Button onClick={run} disabled={loading || !question.trim() || !context.trim()} size="sm" className="bg-teal-600 hover:bg-teal-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MessageSquare className="w-4 h-4 mr-2" />}
        Ask
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Answer">
          <div className="flex items-start justify-between gap-2">
            <p className="text-emerald-300 text-sm font-medium">{result.answer}</p>
            <CopyButton text={result.answer} />
          </div>
          <div className="mt-2 text-xs text-slate-400">{result.confidence}% confidence</div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Paraphrase ───────────────────────────────────────────────────────────────
const STYLES = ["professional", "casual", "formal", "simple", "creative", "concise"];

function ParaphraseTab() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState("professional");
  const [result, setResult] = useState<{ paraphrase: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("paraphrase", { text, style })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to paraphrase…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <div>
        <label className="text-xs text-slate-400 mb-2 block">Style</label>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <button key={s} onClick={() => setStyle(s)} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-all", style === s ? "bg-indigo-600 border-indigo-500 text-white" : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200")}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-indigo-600 hover:bg-indigo-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
        Paraphrase
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Paraphrase">
          <div className="flex items-start justify-between gap-2">
            <p className="text-slate-200 text-sm leading-relaxed">{result.paraphrase}</p>
            <CopyButton text={result.paraphrase} />
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Detect Language ──────────────────────────────────────────────────────────
function DetectTab() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ language: string; confidence: number; topLanguages?: Array<{ language: string; confidence: number }> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("detect-language", { text })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text in any language…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-sky-600 hover:bg-sky-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />}
        Detect Language
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Detected Language">
          <div className="text-center py-2">
            <div className="text-3xl font-bold text-sky-400 uppercase tracking-widest">{result.language}</div>
            <div className="text-slate-400 text-sm mt-1">{result.confidence}% confidence</div>
          </div>
          {result.topLanguages && result.topLanguages.length > 1 && (
            <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
              {result.topLanguages.slice(0, 5).map((l) => (
                <div key={l.language} className="flex items-center gap-3">
                  <span className="text-slate-300 text-xs w-8 uppercase font-mono">{l.language}</span>
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full" style={{ width: `${l.confidence}%` }} />
                  </div>
                  <span className="text-xs text-slate-400 w-8 text-right">{l.confidence}%</span>
                </div>
              ))}
            </div>
          )}
        </ResultBox>
      )}
    </div>
  );
}

// ─── Grammar ─────────────────────────────────────────────────────────────────
function GrammarTab() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ corrected: string; original: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("grammar", { text })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text with grammar or spelling errors…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-rose-600 hover:bg-rose-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckSquare className="w-4 h-4 mr-2" />}
        Fix Grammar
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Corrected Text">
          <div className="flex items-start justify-between gap-2">
            <p className="text-slate-200 text-sm leading-relaxed">{result.corrected}</p>
            <CopyButton text={result.corrected} />
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Code Gen ─────────────────────────────────────────────────────────────────
function CodeGenTab() {
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("python");
  const [result, setResult] = useState<{ code: string; language: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const langs = ["python", "javascript", "typescript", "bash", "sql", "rust", "go", "java", "cpp", "markdown"];
  const run = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("code-gen", { prompt, language })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {langs.map((l) => (
          <button key={l} onClick={() => setLanguage(l)}
            className={cn("px-2.5 py-1 rounded text-xs font-mono transition-colors border",
              language === l ? "bg-teal-500/20 border-teal-500/40 text-teal-300" : "border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20"
            )}>{l}</button>
        ))}
      </div>
      <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what the code should do…&#10;E.g: Read a CSV file, compute average of a column, plot a bar chart" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !prompt.trim()} size="sm" className="bg-teal-600 hover:bg-teal-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Code2 className="w-4 h-4 mr-2" />}
        Generate {language.charAt(0).toUpperCase() + language.slice(1)} Code
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title={`Generated ${result.language} code`}>
          <div className="flex items-start justify-between gap-2">
            <pre className="text-slate-200 text-xs leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto">{result.code}</pre>
            <CopyButton text={result.code} />
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Question Generator ────────────────────────────────────────────────────────
function QuestionGenTab() {
  const [text, setText] = useState("");
  const [count, setCount] = useState("5");
  const [result, setResult] = useState<{ questions: string[]; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("question-gen", { text, count: parseInt(count) || 5 })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a passage, article, or topic description…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[140px] text-sm resize-none" />
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-400">Questions:</label>
        {["3","5","7","10"].map((n) => (
          <button key={n} onClick={() => setCount(n)}
            className={cn("px-3 py-1 rounded text-xs font-mono border transition-colors",
              count === n ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300" : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
            )}>{n}</button>
        ))}
      </div>
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-yellow-600 hover:bg-yellow-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lightbulb className="w-4 h-4 mr-2" />}
        Generate Questions
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title={`${result.count} questions generated`}>
          <div className="space-y-2">
            {result.questions.map((q, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-yellow-400 font-mono text-xs mt-0.5 shrink-0">{i+1}.</span>
                <p className="text-slate-200 text-sm">{q}</p>
              </div>
            ))}
            <div className="pt-1 border-t border-white/5">
              <CopyButton text={result.questions.map((q,i) => `${i+1}. ${q}`).join("\n")} />
            </div>
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Text Expand ──────────────────────────────────────────────────────────────
function ExpandTab() {
  const [text, setText] = useState("");
  const [targetWords, setTargetWords] = useState("200");
  const [style, setStyle] = useState("informative");
  const [result, setResult] = useState<{ expanded: string; wordCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const styles = ["informative", "persuasive", "academic", "creative", "technical"];
  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("expand", { text, targetWords: parseInt(targetWords) || 200, style })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter a short text, outline, or bullet points to expand…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Target words:</label>
          {["100","200","400","800"].map((w) => (
            <button key={w} onClick={() => setTargetWords(w)}
              className={cn("px-2.5 py-1 rounded text-xs font-mono border transition-colors",
                targetWords === w ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
              )}>{w}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {styles.map((s) => (
          <button key={s} onClick={() => setStyle(s)}
            className={cn("px-2.5 py-1 rounded text-xs font-mono border capitalize transition-colors",
              style === s ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
            )}>{s}</button>
        ))}
      </div>
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-violet-600 hover:bg-violet-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <SplitSquareHorizontal className="w-4 h-4 mr-2" />}
        Expand Text
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title={`Expanded — ${result.wordCount} words`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-slate-200 text-sm leading-relaxed">{result.expanded}</p>
            <CopyButton text={result.expanded} />
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Bullet Points ────────────────────────────────────────────────────────────
function BulletsTab() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<"bullets"|"numbered"|"outline">("bullets");
  const [result, setResult] = useState<{ output: string; lines: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("bullets", { text, style })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter any text to convert to structured format…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[140px] text-sm resize-none" />
      <div className="flex gap-2">
        {(["bullets","numbered","outline"] as const).map((s) => (
          <button key={s} onClick={() => setStyle(s)}
            className={cn("px-3 py-1.5 rounded text-xs font-mono border capitalize flex-1 transition-colors",
              style === s ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
            )}>{s}</button>
        ))}
      </div>
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-emerald-600 hover:bg-emerald-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <List className="w-4 h-4 mr-2" />}
        Convert to {style.charAt(0).toUpperCase() + style.slice(1)}
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title="Structured Output">
          <div className="flex items-start justify-between gap-2">
            <pre className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{result.output}</pre>
            <CopyButton text={result.output} />
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Tone Adjust ──────────────────────────────────────────────────────────────
function ToneTab() {
  const [text, setText] = useState("");
  const [tone, setTone] = useState("professional");
  const [result, setResult] = useState<{ rewritten: string; targetTone: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tones = ["professional", "casual", "academic", "friendly", "assertive", "empathetic", "humorous", "formal"];
  const run = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("tone-adjust", { text, targetTone: tone })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tones.map((t) => (
          <button key={t} onClick={() => setTone(t)}
            className={cn("px-2.5 py-1 rounded text-xs font-mono border capitalize transition-colors",
              tone === t ? "bg-pink-500/20 border-pink-500/40 text-pink-300" : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
            )}>{t}</button>
        ))}
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text to rewrite in a different tone…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[120px] text-sm resize-none" />
      <Button onClick={run} disabled={loading || !text.trim()} size="sm" className="bg-pink-600 hover:bg-pink-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Type className="w-4 h-4 mr-2" />}
        Rewrite as {tone.charAt(0).toUpperCase() + tone.slice(1)}
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <ResultBox title={`Rewritten — ${result.targetTone} tone`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-slate-200 text-sm leading-relaxed">{result.rewritten}</p>
            <CopyButton text={result.rewritten} />
          </div>
        </ResultBox>
      )}
    </div>
  );
}

// ─── Text Compare ─────────────────────────────────────────────────────────────
function CompareTab() {
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [result, setResult] = useState<{ jaccardSimilarity: number; analysis: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (!textA.trim() || !textB.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await callTool("text-compare", { textA, textB })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-500 font-mono mb-1.5">TEXT A</div>
          <Textarea value={textA} onChange={(e) => setTextA(e.target.value)} placeholder="Paste first text…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[140px] text-sm resize-none" />
        </div>
        <div>
          <div className="text-xs text-slate-500 font-mono mb-1.5">TEXT B</div>
          <Textarea value={textB} onChange={(e) => setTextB(e.target.value)} placeholder="Paste second text…" className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500 min-h-[140px] text-sm resize-none" />
        </div>
      </div>
      <Button onClick={run} disabled={loading || !textA.trim() || !textB.trim()} size="sm" className="bg-sky-600 hover:bg-sky-500 w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpDown className="w-4 h-4 mr-2" />}
        Compare Texts
      </Button>
      {error && <div className="text-red-400 text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</div>}
      {result && (
        <div className="space-y-3">
          <ResultBox title="Jaccard Similarity Score">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", result.jaccardSimilarity > 70 ? "bg-emerald-500" : result.jaccardSimilarity > 40 ? "bg-yellow-500" : "bg-red-500")}
                  style={{ width: `${result.jaccardSimilarity}%` }} />
              </div>
              <span className="text-2xl font-bold text-white font-mono">{result.jaccardSimilarity}%</span>
            </div>
          </ResultBox>
          {result.analysis && (
            <ResultBox title="AI Analysis">
              <div className="flex items-start justify-between gap-2">
                <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{result.analysis}</p>
                <CopyButton text={result.analysis} />
              </div>
            </ResultBox>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const TOOL_GROUPS = [
  {
    label: "Text Analysis",
    tools: [
      { id: "summarize",  label: "Summarize",       icon: Wand2,         color: "text-emerald-400", component: SummarizeTab,  desc: "Abstractive summarization (BART)" },
      { id: "sentiment",  label: "Sentiment",        icon: Heart,         color: "text-pink-400",    component: SentimentTab,  desc: "Positive / negative / neutral" },
      { id: "classify",   label: "Classify",         icon: Tag,           color: "text-violet-400",  component: ClassifyTab,   desc: "Zero-shot text classification" },
      { id: "ner",        label: "Named Entities",   icon: User,          color: "text-cyan-400",    component: NERTab,        desc: "Persons, orgs, locations" },
      { id: "keywords",   label: "Keywords",         icon: Key,           color: "text-orange-400",  component: KeywordsTab,   desc: "TF-IDF extraction (no API)" },
      { id: "detect",     label: "Detect Language",  icon: Globe,         color: "text-sky-400",     component: DetectTab,     desc: "Identify language of any text" },
      { id: "compare",    label: "Compare Texts",    icon: ArrowUpDown,   color: "text-sky-300",     component: CompareTab,    desc: "Similarity & AI analysis" },
    ],
  },
  {
    label: "Text Transform",
    tools: [
      { id: "grammar",    label: "Grammar Fix",      icon: CheckSquare,   color: "text-rose-400",    component: GrammarTab,    desc: "Correct grammar and spelling" },
      { id: "paraphrase", label: "Paraphrase",       icon: RotateCcw,     color: "text-indigo-400",  component: ParaphraseTab, desc: "Rewrite in different styles" },
      { id: "expand",     label: "Expand",           icon: SplitSquareHorizontal, color: "text-violet-400", component: ExpandTab, desc: "Expand short text to full content" },
      { id: "bullets",    label: "Bullet Points",    icon: List,          color: "text-emerald-300", component: BulletsTab,    desc: "Convert to structured format" },
      { id: "tone",       label: "Tone Adjust",      icon: Type,          color: "text-pink-300",    component: ToneTab,       desc: "Rewrite in a different tone" },
      { id: "translate",  label: "Translate",        icon: Languages,     color: "text-blue-400",    component: TranslateTab,  desc: "Neural machine translation" },
    ],
  },
  {
    label: "AI Generation",
    tools: [
      { id: "qa",         label: "Q&A",              icon: MessageSquare, color: "text-teal-400",    component: QATab,         desc: "Extractive question answering" },
      { id: "questions",  label: "Generate Questions",icon: Lightbulb,    color: "text-yellow-400",  component: QuestionGenTab,desc: "Create comprehension questions" },
      { id: "code-gen",   label: "Code Generator",   icon: Code2,         color: "text-teal-300",    component: CodeGenTab,    desc: "Generate code from description" },
    ],
  },
];
const TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

export default function AIToolsPage() {
  const [activeTab, setActiveTab] = useState("summarize");
  const ActiveComponent = TOOLS.find((t) => t.id === activeTab)?.component || SummarizeTab;
  const activeTool = TOOLS.find((t) => t.id === activeTab);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-white">AI Tools</h1>
        </div>
        <p className="text-sm text-slate-400 ml-11">17 real AI tools — HuggingFace, local Ollama, TF-IDF</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0 border-r border-white/5 overflow-y-auto p-2">
          {TOOL_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-600 tracking-widest uppercase">
                {group.label}
              </div>
              {group.tools.map((tool) => {
                const Icon = tool.icon;
                const isActive = activeTab === tool.id;
                return (
                  <button
                    key={tool.id}
                    onClick={() => setActiveTab(tool.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all mb-0.5",
                      isActive ? "bg-white/8 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    )}
                  >
                    <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", isActive ? tool.color : "opacity-60")} />
                    <span className="font-medium text-xs">{tool.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-5">
              {activeTool && (() => { const Icon = activeTool.icon; return <Icon className={cn("w-5 h-5", activeTool.color)} />; })()}
              <h2 className="text-base font-semibold text-white">{activeTool?.label}</h2>
              <span className="text-xs text-slate-500 font-mono">{activeTool?.desc}</span>
            </div>
            <ActiveComponent />
          </div>
        </div>
      </div>
    </div>
  );
}
