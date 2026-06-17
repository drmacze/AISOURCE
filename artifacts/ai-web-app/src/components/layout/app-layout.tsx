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
  Palette,
  Rabbit,
  Plug,
  ServerIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── OpenClaw status hook ─────────────────────────────────────────────────────
function useOpenClawRunning() {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`/api/openclaw/status`);
        if (res.ok) {
          const data = await res.json() as { running: boolean };
          setRunning(!!data.running);
        }
      } catch { /* ignore */ }
    };
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);
  return running;
}

const NAV_GROUPS = [
  {
    label: "Core",
    items: [
      { href: "/dashboard",  label: "Dashboard",      icon: LayoutDashboard },
      { href: "/chat",       label: "Chat",           icon: MessageSquare   },
      { href: "/analytics",  label: "Analytics",      icon: BarChart2       },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/playground",  label: "Playground",    icon: Zap      },
      { href: "/ai-tools",    label: "AI Tools",      icon: Wand2    },
      { href: "/notebook",    label: "Notebook",      icon: BookMarked},
      { href: "/web-search",  label: "Web Search",    icon: Search   },
      { href: "/prompts",     label: "Prompts",       icon: Brain    },
      { href: "/rag",         label: "Knowledge Base",icon: Database  },
      { href: "/generate",    label: "Image Gen",     icon: ImageIcon },
    ],
  },
  {
    label: "Training",
    items: [
      { href: "/openclaw",     label: "AI Agent",     icon: Rabbit   },
      { href: "/training",     label: "Training Hub", icon: Network  },
      { href: "/training-lab", label: "Training Lab", icon: Activity },
      { href: "/models",       label: "Models",       icon: Box      },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/bots",      label: "Bot Center",     icon: Bot      },
      { href: "/brand-kit", label: "Brand Kit",      icon: Palette  },
      { href: "/storage",   label: "OneDrive",       icon: HardDrive},
      { href: "/chatgpt",   label: "ChatGPT Actions", icon: Plug       },
      { href: "/mcp",       label: "MCP Server",      icon: ServerIcon },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/api-keys",  label: "API Keys",  icon: KeyRound },
      { href: "/api-docs",  label: "API Docs",  icon: BookOpen },
      { href: "/settings",  label: "Settings",  icon: Settings },
    ],
  },
];

const API_BASE =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL
    ? ((import.meta as { env: { VITE_API_URL: string } }).env.VITE_API_URL || "").replace(/\/$/, "")
    : "";

function getApiBase() { return API_BASE || ""; }

interface SearchResult {
  id: number; type: string; title?: string; name?: string; snippet?: string; conversationId?: number;
}
interface GlobalSearchData {
  query: string; totalHits: number;
  results: { conversations: SearchResult[]; messages: SearchResult[]; documents: SearchResult[]; prompts: SearchResult[] };
}

function GlobalSearch() {
  const [query, setQuery]     = useState("");
  const [open, setOpen]       = useState(false);
  const [results, setResults] = useState<GlobalSearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);
  const [, navigate]          = useLocation();

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
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const allHits = results ? [
    ...results.results.conversations.map((r) => ({ ...r, label: r.title || "Conversation",              href: `/chat/${r.id}`,              icon: MessageSquare, type: "chat" })),
    ...results.results.messages.map((r)      => ({ ...r, label: `Chat #${r.conversationId}`,            href: `/chat/${r.conversationId}`,  icon: MessageSquare, type: "message" })),
    ...results.results.documents.map((r)     => ({ ...r, label: r.title || "Document",                  href: "/rag",                        icon: FileText,      type: "doc" })),
    ...results.results.prompts.map((r)       => ({ ...r, label: r.name  || "Prompt",                    href: "/prompts",                    icon: PromptIcon,    type: "prompt" })),
  ] : [];

  return (
    <>
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="w-full flex items-center gap-2 px-3 py-2 mx-3 mt-2 mb-1 rounded-lg border border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all text-xs"
        style={{ width: "calc(100% - 24px)" }}
      >
        <Search className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden sm:inline text-[9px] border border-border rounded px-1.5 py-0.5 bg-background/50 font-mono">⌘K</kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-start justify-center pt-16 sm:pt-20 px-4"
            onClick={() => setOpen(false)}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -6 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                {loading
                  ? <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
                  : <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                }
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search conversations, docs, prompts…"
                  className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground/60"
                  autoFocus
                />
                <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-muted transition-colors">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              {allHits.length > 0 && (
                <div className="max-h-72 overflow-y-auto py-1.5 scrollbar-thin">
                  {allHits.map((hit, i) => {
                    const Icon = hit.icon;
                    return (
                      <button
                        key={i}
                        className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors text-left"
                        onClick={() => { navigate(hit.href); setOpen(false); setQuery(""); }}
                      >
                        <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary/70" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-foreground truncate">{hit.label}</div>
                          {hit.snippet && <div className="text-xs text-muted-foreground truncate mt-0.5">{hit.snippet}</div>}
                        </div>
                        <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto mt-0.5 shrink-0">{hit.type}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {query.length >= 2 && !loading && allHits.length === 0 && (
                <div className="py-10 text-center text-muted-foreground text-sm">No results for "{query}"</div>
              )}

              {!query && (
                <div className="py-8 text-center text-muted-foreground/40 text-xs">
                  Type to search across conversations, documents and prompts
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Animated logo mark ────────────────────────────────────────────────────────
function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="hsl(250 84% 68% / 0.15)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="hsl(250 84% 68% / 0.3)" />
      {/* Nodes */}
      <circle cx="16" cy="8"  r="2.5" fill="hsl(250 84% 75%)" opacity="0.9">
        <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2.8s" repeatCount="indefinite" />
      </circle>
      <circle cx="8"  cy="22" r="2"   fill="hsl(250 84% 68%)" opacity="0.7">
        <animate attributeName="opacity" values="0.7;0.3;0.7" dur="3.2s" begin="0.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="24" cy="22" r="2"   fill="hsl(250 84% 68%)" opacity="0.7">
        <animate attributeName="opacity" values="0.7;0.3;0.7" dur="2.5s" begin="0.9s" repeatCount="indefinite" />
      </circle>
      <circle cx="16" cy="18" r="1.5" fill="hsl(250 84% 80%)" opacity="0.9" />
      {/* Connections */}
      <line x1="16" y1="10.5" x2="16" y2="16.5" stroke="hsl(250 84% 68%)" strokeWidth="1" strokeOpacity="0.35" />
      <line x1="14.8" y1="19"  x2="9.5"  y2="21"   stroke="hsl(250 84% 68%)" strokeWidth="1" strokeOpacity="0.25" />
      <line x1="17.2" y1="19"  x2="22.5" y2="21"   stroke="hsl(250 84% 68%)" strokeWidth="1" strokeOpacity="0.25" />
      <line x1="16"   y1="8"   x2="8"    y2="22"   stroke="hsl(250 84% 68%)" strokeWidth="0.5" strokeOpacity="0.12" />
      <line x1="16"   y1="8"   x2="24"   y2="22"   stroke="hsl(250 84% 68%)" strokeWidth="0.5" strokeOpacity="0.12" />
    </svg>
  );
}

// ── Status indicator SVG ──────────────────────────────────────────────────────
function StatusDot({ active = true }: { active?: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8">
      <circle cx="4" cy="4" r="3" fill={active ? "hsl(155 60% 50%)" : "hsl(0 0% 35%)"}>
        {active && <animate attributeName="opacity" values="1;0.4;1" dur="2.5s" repeatCount="indefinite" />}
      </circle>
    </svg>
  );
}

// ── Sidebar Content ───────────────────────────────────────────────────────────
function SidebarContent({ location, onClose }: { location: string; onClose?: () => void }) {
  const openClawRunning = useOpenClawRunning();

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <div className="flex flex-col leading-none">
            <span className="font-bold text-sm tracking-tight text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
              DLavie OS
            </span>
            <span className="text-[10px] text-muted-foreground/70 tracking-wide mt-0.5">AI Engine v2</span>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Global Search */}
      <GlobalSearch />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 scrollbar-none">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground/50 tracking-widest uppercase select-none">
              {group.label}
            </div>
            <div className="space-y-0.5 mt-0.5">
              {group.items.map((item) => {
                const isActive =
                  location === item.href ||
                  (item.href !== "/dashboard" && location.startsWith(item.href));
                const Icon = item.icon;
                const isAgent = item.href === "/openclaw";

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-100",
                      isActive
                        ? "bg-primary/10 text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground font-normal"
                    )}
                  >
                    <Icon
                      className={cn(
                        "w-4 h-4 flex-shrink-0 transition-colors",
                        isActive ? "text-primary" : "text-muted-foreground/60 group-hover:text-muted-foreground"
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {isAgent && openClawRunning && (
                      <StatusDot active />
                    )}
                    {isActive && (
                      <ChevronRight className="w-3 h-3 text-primary/50 flex-shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-border/60">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-muted/30">
          <StatusDot active />
          <span className="text-xs text-muted-foreground flex-1">System Online</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-40">
            <path d="M7 1.5A5.5 5.5 0 1 1 7 12.5A5.5 5.5 0 0 1 7 1.5Z" stroke="currentColor" strokeWidth="1" fill="none">
              <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="8s" repeatCount="indefinite" />
            </path>
            <circle cx="7" cy="7" r="1.5" fill="currentColor" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── App Layout ────────────────────────────────────────────────────────────────
export function AppLayout({ children }: { children: ReactNode }) {
  const [location]    = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">

      {/* ── Desktop Sidebar ─────────────────────────────────────── */}
      <aside className="hidden lg:flex w-56 xl:w-60 flex-shrink-0 flex-col bg-card border-r border-border/70">
        <SidebarContent location={location} />
      </aside>

      {/* ── Mobile Overlay Sidebar ──────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: -264 }}
              animate={{ x: 0 }}
              exit={{ x: -264 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-card border-r border-border shadow-2xl lg:hidden"
            >
              <SidebarContent location={location} onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-border/60 bg-card flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-1 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <LogoMark size={24} />
            <span className="font-bold text-sm tracking-tight" style={{ fontFamily: "Syne, sans-serif" }}>
              DLavie OS
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot active />
            <span className="text-xs text-muted-foreground">Online</span>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin pb-safe">
          {children}
        </div>
      </main>
    </div>
  );
}
