import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Database,
  Network,
  Activity,
  Cpu,
  BookOpen,
  Box,
  ImageIcon,
  Menu,
  X,
  Zap,
  ChevronRight,
  KeyRound,
  Settings,
  Brain,
  BarChart2,
  Wand2,
  BookMarked,
  Search,
  FileText,
  Bot,
  BookMarked as PromptIcon,
  HardDrive,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Global Agent Running Indicator hook ─────────────────────────────────────
function useAgentRunning() {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const base = "";

    const check = async () => {
      try {
        const res = await fetch(`${base}/api/agent/sessions`);
        if (res.ok) {
          const sessions = await res.json() as Array<{ status: string }>;
          setRunning(sessions.some((s) => s.status === "running"));
        }
      } catch { /* ignore */ }
    };

    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  return running;
}

const NAV_GROUPS = [
  {
    label: "Core",
    items: [
      { href: "/dashboard",  label: "Dashboard",      icon: LayoutDashboard,  color: "text-emerald-400" },
      { href: "/chat",       label: "Chat",           icon: MessageSquare,    color: "text-blue-400" },
      { href: "/analytics",  label: "Analytics",      icon: BarChart2,        color: "text-cyan-400" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/playground",  label: "Playground",     icon: Zap,              color: "text-yellow-400" },
      { href: "/ai-tools",   label: "AI Tools",       icon: Wand2,            color: "text-violet-400" },
      { href: "/notebook",   label: "Notebook",       icon: BookMarked,       color: "text-violet-300" },
      { href: "/web-search", label: "Web Search",     icon: Search,           color: "text-sky-400" },
      { href: "/prompts",    label: "Prompts",        icon: Brain,            color: "text-amber-400" },
      { href: "/rag",        label: "Knowledge Base", icon: Database,         color: "text-purple-400" },
      { href: "/generate",   label: "Image Gen",      icon: ImageIcon,        color: "text-pink-400" },
    ],
  },
  {
    label: "Training & Models",
    items: [
      { href: "/agent",        label: "AI Agent",       icon: Bot,              color: "text-emerald-400" },
      { href: "/training",     label: "Training Hub",   icon: Network,          color: "text-orange-400" },
      { href: "/training-lab", label: "Training Lab",   icon: Activity,         color: "text-green-400" },
      { href: "/models",       label: "Models",         icon: Box,              color: "text-rose-400" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/bots",       label: "Bot Center",     icon: Bot,              color: "text-green-400" },
      { href: "/storage",    label: "OneDrive",       icon: HardDrive,        color: "text-blue-400" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/api-keys",   label: "API Keys",       icon: KeyRound,         color: "text-violet-400" },
      { href: "/api-docs",   label: "API Docs",       icon: BookOpen,         color: "text-teal-400" },
      { href: "/settings",   label: "Settings",       icon: Settings,         color: "text-slate-400" },
    ],
  },
];

const API_BASE = typeof import.meta !== "undefined" && (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL
  ? ((import.meta as { env: { VITE_API_URL: string } }).env.VITE_API_URL || "").replace(/\/$/, "")
  : "";

function getApiBase() {
  if (API_BASE) return API_BASE;
  return "";
}

interface SearchResult {
  id: number; type: string; title?: string; name?: string; snippet?: string; conversationId?: number;
}
interface GlobalSearchData {
  query: string; totalHits: number;
  results: { conversations: SearchResult[]; messages: SearchResult[]; documents: SearchResult[]; prompts: SearchResult[] };
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GlobalSearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/api/global-search?q=${encodeURIComponent(q)}`);
      if (r.ok) setResults(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const allHits = results ? [
    ...results.results.conversations.map((r) => ({ ...r, label: r.title || "Conversation", href: `/chat/${r.id}`, icon: MessageSquare, color: "text-blue-400" })),
    ...results.results.messages.map((r) => ({ ...r, label: `Message in chat #${r.conversationId}`, href: `/chat/${r.conversationId}`, icon: MessageSquare, color: "text-blue-300" })),
    ...results.results.documents.map((r) => ({ ...r, label: r.title || "Document", href: "/rag", icon: FileText, color: "text-purple-400" })),
    ...results.results.prompts.map((r) => ({ ...r, label: r.name || "Prompt", href: "/prompts", icon: PromptIcon, color: "text-amber-400" })),
  ] : [];

  return (
    <>
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="w-full flex items-center gap-2 px-3 py-2 mx-2.5 mt-2 mb-1 rounded-lg border border-white/8 bg-white/3 text-slate-500 hover:text-slate-300 hover:bg-white/5 hover:border-white/12 transition-all text-xs"
        style={{ width: "calc(100% - 20px)" }}
      >
        <Search className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="text-[9px] border border-white/10 rounded px-1 py-0.5 bg-white/5">⌘K</kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4"
            onClick={() => setOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8">
                {loading
                  ? <div className="w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin flex-shrink-0" />
                  : <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                }
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search conversations, docs, prompts…"
                  className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-600"
                  autoFocus
                />
                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/10">
                  <X className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>

              {allHits.length > 0 && (
                <div className="max-h-80 overflow-y-auto py-2">
                  {allHits.map((hit, i) => {
                    const Icon = hit.icon;
                    return (
                      <button
                        key={i}
                        className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                        onClick={() => { navigate(hit.href); setOpen(false); setQuery(""); }}
                      >
                        <Icon className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", hit.color)} />
                        <div className="min-w-0">
                          <div className="text-sm text-white truncate">{hit.label}</div>
                          {hit.snippet && (
                            <div className="text-xs text-slate-500 truncate mt-0.5">{hit.snippet}</div>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-700 font-mono ml-auto mt-0.5 shrink-0">{hit.type}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {query.length >= 2 && !loading && allHits.length === 0 && (
                <div className="py-10 text-center text-slate-600 text-sm">
                  No results for "{query}"
                </div>
              )}

              {!query && (
                <div className="py-6 text-center text-slate-700 text-xs font-mono">
                  Type to search across conversations, documents & prompts
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarContent({ location, onClose }: { location: string; onClose?: () => void }) {
  const agentRunning = useAgentRunning();
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Cpu className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-sm tracking-wider text-white">DLavie OS</span>
            <span className="text-[10px] text-emerald-400/70 font-mono tracking-widest">AI ENGINE v2</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Global Search */}
      <GlobalSearch />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-600 tracking-widest uppercase">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
                const Icon = item.icon;
                const isAgent = item.href === "/agent";
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                      isActive
                        ? "bg-white/8 text-white shadow-sm"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    )}
                  >
                    <Icon className={cn("w-4 h-4 flex-shrink-0 transition-colors", isActive ? item.color : "opacity-60 group-hover:opacity-100")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {isAgent && agentRunning && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" title="Agent running in background" />
                    )}
                    {isActive && !agentRunning && <ChevronRight className="w-3 h-3 text-emerald-400 opacity-60 flex-shrink-0" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
          <div className="relative">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <span className="text-xs font-mono text-emerald-400/80">System Online</span>
          <Zap className="w-3 h-3 text-emerald-400/50 ml-auto" />
        </div>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close sidebar when route changes on mobile
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden">
      {/* ── Desktop Sidebar (lg+) ── */}
      <aside className="hidden lg:flex w-56 xl:w-60 flex-shrink-0 flex-col bg-slate-900/80 border-r border-white/5 backdrop-blur-xl">
        <SidebarContent location={location} />
      </aside>

      {/* ── Mobile Overlay ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            {/* Sidebar drawer */}
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 250 }}
              className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-slate-900 border-r border-white/5 shadow-2xl lg:hidden"
            >
              <SidebarContent location={location} onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-white/5 bg-slate-900/80 backdrop-blur-xl flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
              <Cpu className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm text-white tracking-wide">DLavie OS</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400/80 font-mono">Online</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-16">
          {children}
        </div>
      </main>
    </div>
  );
}
