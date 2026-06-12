import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  BookOpen, Plus, Trash2, Pencil, Copy, CheckCheck, Search,
  Loader2, AlertCircle, X, Sparkles, ArrowUpRight, MessageSquare,
  ChevronDown, ChevronUp, RotateCcw, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");
function getApiBase() {
  if (API_BASE) return API_BASE;
  return "";
}
async function api(path: string, opts?: RequestInit) {
  const r = await fetch(`${getApiBase()}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok && r.status !== 204) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

interface Prompt {
  id: number;
  name: string;
  content: string;
  description: string | null;
  category: string;
  tags: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  "all", "general", "coding", "writing", "analysis",
  "creative", "business", "research", "education", "custom",
];

const CAT_COLOR: Record<string, string> = {
  general:   "border-slate-500/40 text-slate-300 bg-slate-500/10",
  coding:    "border-cyan-500/40 text-cyan-300 bg-cyan-500/10",
  writing:   "border-blue-500/40 text-blue-300 bg-blue-500/10",
  analysis:  "border-violet-500/40 text-violet-300 bg-violet-500/10",
  creative:  "border-pink-500/40 text-pink-300 bg-pink-500/10",
  business:  "border-amber-500/40 text-amber-300 bg-amber-500/10",
  research:  "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  education: "border-orange-500/40 text-orange-300 bg-orange-500/10",
  custom:    "border-rose-500/40 text-rose-300 bg-rose-500/10",
};

function PromptCard({
  prompt,
  onEdit,
  onDelete,
  onUseInChat,
  copiedId,
  onCopy,
}: {
  prompt: Prompt;
  onEdit: (p: Prompt) => void;
  onDelete: (id: number) => void;
  onUseInChat: (p: Prompt) => void;
  copiedId: number | null;
  onCopy: (id: number, text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tags: string[] = (() => { try { return JSON.parse(prompt.tags || "[]") as string[]; } catch { return []; } })();
  const colorClass = CAT_COLOR[prompt.category] || CAT_COLOR.general;
  const contentPreview = prompt.content.slice(0, 200);
  const isLong = prompt.content.length > 200;

  return (
    <Card className="bg-slate-900/60 border-white/8 hover:border-white/15 transition-all group flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm text-white">{prompt.name}</CardTitle>
              <Badge variant="outline" className={cn("text-[10px] border shrink-0", colorClass)}>
                {prompt.category}
              </Badge>
            </div>
            {prompt.description && (
              <p className="text-xs text-slate-500 mt-1">{prompt.description}</p>
            )}
          </div>
          {/* Action row (always visible) */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onUseInChat(prompt)}
              className="p-1.5 rounded hover:bg-emerald-500/15 text-slate-500 hover:text-emerald-400 transition-colors"
              title="Use in Chat"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onCopy(prompt.id, prompt.content)}
              className="p-1.5 rounded hover:bg-blue-500/15 text-slate-500 hover:text-blue-400 transition-colors"
              title="Copy"
            >
              {copiedId === prompt.id ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => onEdit(prompt)}
              className="p-1.5 rounded hover:bg-white/10 text-slate-600 hover:text-slate-300 transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(prompt.id)}
              className="p-1.5 rounded hover:bg-red-500/15 text-slate-600 hover:text-red-400 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 flex-1 flex flex-col">
        <div className="relative">
          <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap leading-relaxed bg-slate-800/40 rounded-md p-3 mb-2">
            {expanded ? prompt.content : contentPreview}
            {!expanded && isLong && "…"}
          </pre>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 mb-2"
            >
              {expanded ? <><ChevronUp className="w-3 h-3" /> Collapse</> : <><ChevronDown className="w-3 h-3" /> Show full prompt</>}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between mt-auto pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            {tags.map((t) => (
              <span key={t} className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-slate-500">#{t}</span>
            ))}
          </div>
          <span className="text-[10px] text-slate-600 font-mono flex items-center gap-1">
            <ArrowUpRight className="w-2.5 h-2.5" />
            {prompt.useCount} uses
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PromptForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Prompt | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [content, setContent] = useState(initial?.content || "");
  const [category, setCategory] = useState(initial?.category || "general");
  const [desc, setDesc] = useState(initial?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim() || !content.trim()) { setError("Name and content are required"); return; }
    setSaving(true);
    try {
      if (initial) {
        await api(`/prompts/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name, content, category, description: desc }),
        });
      } else {
        await api("/prompts", {
          method: "POST",
          body: JSON.stringify({ name, content, category, description: desc }),
        });
      }
      onSave();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 mt-2">
      {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block font-medium">Name *</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My prompt name…"
          className="bg-slate-800/60 border-white/10 text-white text-sm" autoFocus />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block font-medium">Description</label>
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description…"
          className="bg-slate-800/60 border-white/10 text-white text-sm" />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block font-medium">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="w-full bg-slate-800/60 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25">
          {CATEGORIES.filter((c) => c !== "all").map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1.5 block font-medium">
          Prompt Content * <span className="text-slate-600">(use {"{variable}"} as placeholders)</span>
        </label>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="You are a helpful assistant. Given {input}, please…"
          className="bg-slate-800/60 border-white/10 text-white text-sm min-h-[180px] resize-y font-mono" />
      </div>
      <div className="flex gap-3 justify-end pt-1">
        <Button variant="outline" onClick={onClose} size="sm" className="border-white/10 text-slate-300 hover:bg-white/5">
          <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving || !name.trim() || !content.trim()} size="sm"
          className="bg-amber-600 hover:bg-amber-500 text-white">
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {initial ? "Save Changes" : "Create Prompt"}
        </Button>
      </div>
    </div>
  );
}

export default function PromptsPage() {
  const [, navigate] = useLocation();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState<Prompt | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"recent" | "popular">("popular");

  const fetchPrompts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeCategory !== "all") params.set("category", activeCategory);
      const data = await api(`/prompts?${params}&limit=100`);
      setPrompts(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const result = await api("/prompts/seed", { method: "POST" });
      await fetchPrompts();
      if (result?.seeded > 0) {
        setActiveCategory("all");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSeeding(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this prompt?")) return;
    try {
      await api(`/prompts/${id}`, { method: "DELETE" });
      setPrompts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) { setError(String(e)); }
  };

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    api(`/prompts/${id}/use`, { method: "POST" }).catch(() => {});
    setCopiedId(id);
    setPrompts((prev) => prev.map((p) => p.id === id ? { ...p, useCount: p.useCount + 1 } : p));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleUseInChat = (p: Prompt) => {
    api(`/prompts/${p.id}/use`, { method: "POST" }).catch(() => {});
    // Navigate to chat with the prompt pre-seeded as a system message
    sessionStorage.setItem("dlavie_prompt_inject", p.content);
    sessionStorage.setItem("dlavie_prompt_name", p.name);
    navigate("/chat");
  };

  const openCreate = () => { setEditPrompt(null); setCreateOpen(true); };
  const openEdit = (p: Prompt) => { setEditPrompt(p); setCreateOpen(true); };

  const filtered = prompts
    .filter((p) => {
      const q = search.toLowerCase();
      if (q && !p.name.toLowerCase().includes(q) && !p.content.toLowerCase().includes(q) &&
        !(p.description || "").toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => sortBy === "popular"
      ? b.useCount - a.useCount
      : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const totalByCategory = CATEGORIES.slice(1).reduce((acc, cat) => {
    acc[cat] = prompts.filter((p) => p.category === cat).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Prompt Library</h1>
              <p className="text-xs text-slate-400">
                {prompts.length} saved prompt{prompts.length !== 1 ? "s" : ""}
                {filtered.length !== prompts.length && ` · ${filtered.length} shown`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSeedDefaults}
              disabled={seeding}
              variant="outline"
              size="sm"
              className="border-white/10 text-slate-300 hover:bg-white/5 text-xs"
              title="Seed 15 expert prompts into library"
            >
              {seeding
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              }
              Seed Defaults
            </Button>
            <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setEditPrompt(null); }}>
              <DialogTrigger asChild>
                <Button onClick={openCreate} size="sm" className="bg-amber-600 hover:bg-amber-500 text-white">
                  <Plus className="w-4 h-4 mr-1.5" />
                  New Prompt
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-slate-900 border-white/10 max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-white">
                    {editPrompt ? "Edit Prompt" : "Create New Prompt"}
                  </DialogTitle>
                </DialogHeader>
                <PromptForm
                  initial={editPrompt}
                  onSave={() => { setCreateOpen(false); setEditPrompt(null); fetchPrompts(); }}
                  onClose={() => { setCreateOpen(false); setEditPrompt(null); }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search + sort + filters */}
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, content, or description…"
                className="pl-9 bg-slate-800/60 border-white/10 text-white text-sm h-9"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex rounded-lg border border-white/10 overflow-hidden shrink-0">
              {(["popular", "recent"] as const).map((s) => (
                <button key={s} onClick={() => setSortBy(s)}
                  className={cn("px-3 py-1.5 text-xs transition-all capitalize", sortBy === s ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Category pills */}
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((cat) => {
              const cnt = cat === "all" ? prompts.length : (totalByCategory[cat] || 0);
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5",
                    activeCategory === cat
                      ? "bg-amber-600 border-amber-500 text-white"
                      : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"
                  )}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  {cnt > 0 && (
                    <span className={cn("text-[9px] px-1 py-0.5 rounded-full font-mono",
                      activeCategory === cat ? "bg-white/20 text-white" : "bg-white/8 text-slate-500"
                    )}>{cnt}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 text-red-400 text-sm py-4">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-slate-400 text-sm mb-2">
              {prompts.length === 0
                ? "No prompts yet. Create your first or load the expert defaults."
                : "No prompts match your search."}
            </p>
            {prompts.length === 0 && (
              <Button onClick={handleSeedDefaults} disabled={seeding} variant="outline" size="sm"
                className="border-white/10 text-slate-300 hover:bg-white/5 mt-2">
                {seeding ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                Load 15 expert prompts
              </Button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                onEdit={openEdit}
                onDelete={handleDelete}
                onUseInChat={handleUseInChat}
                copiedId={copiedId}
                onCopy={handleCopy}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
