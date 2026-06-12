/**
 * DLavie OS — Bot Center
 * Unified page: WhatsApp (Baileys), Meta Cloud API, Telegram, Tickets
 */

import { useState, useEffect, useRef } from "react";
import { Bot, MessageCircle, Send, Ticket, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import WaBotPage from "./wa-bot";
import WhatsAppPage from "./whatsapp";
import TgBotPage from "./tg-bot";

type BotId = "baileys" | "meta" | "telegram" | "tickets";

interface BotDef {
  id:        BotId;
  label:     string;
  sub:       string;
  icon:      string;
  soon?:     boolean;
  statusUrl?: string;
  color:     string;
}

const BOTS: BotDef[] = [
  {
    id: "baileys", label: "WhatsApp", sub: "Baileys — pairing code",
    icon: "📱", statusUrl: "/api/wa-bot/status", color: "green",
  },
  {
    id: "meta", label: "WhatsApp", sub: "Meta Cloud API — webhook",
    icon: "🌐", statusUrl: "/api/whatsapp/status", color: "green",
  },
  {
    id: "telegram", label: "Telegram", sub: "Bot API — long-poll",
    icon: "✈️", statusUrl: "/api/tg-bot/status", color: "blue",
  },
  {
    id: "tickets", label: "Tiket", sub: "Laporan dari semua bot",
    icon: "🎫", color: "yellow",
  },
];

// ── Ticket types ──────────────────────────────────────────────────────────────

interface BotTicket {
  id:          number;
  platform:    string;
  fromJid:     string;
  fromName:    string;
  title:       string;
  description: string;
  steps?:      string | null;
  status:      string;
  priority:    string;
  agentNotes?: string | null;
  createdAt:   string;
  resolvedAt?: string | null;
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ url }: { url?: string }) {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const check = () => {
      fetch(url)
        .then((r) => r.json())
        .then((d: { connected?: boolean; enabled?: boolean }) => {
          if (alive) setOnline(d.connected ?? d.enabled ?? false);
        })
        .catch(() => { if (alive) setOnline(false); });
    };
    check();
    const t = setInterval(check, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [url]);

  if (online === null) return <span className="w-2 h-2 rounded-full bg-slate-600" />;
  return (
    <span className={cn(
      "w-2 h-2 rounded-full flex-shrink-0",
      online ? "bg-green-400 animate-pulse" : "bg-slate-600"
    )} />
  );
}

// ── Ticket row ────────────────────────────────────────────────────────────────

function TicketRow({ ticket, onResolved }: { ticket: BotTicket; onResolved: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [notes, setNotes]         = useState("");
  const [expanded, setExpanded]   = useState(false);

  const statusColor = {
    open:       "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    in_progress:"bg-blue-500/15 text-blue-400 border-blue-500/20",
    resolved:   "bg-green-500/15 text-green-400 border-green-500/20",
    closed:     "bg-slate-700 text-slate-400 border-slate-600",
  }[ticket.status] ?? "bg-slate-700 text-slate-400 border-slate-600";

  const priorityColor = {
    low:    "text-slate-400",
    medium: "text-yellow-400",
    high:   "text-orange-400",
    urgent: "text-red-400",
  }[ticket.priority] ?? "text-slate-400";

  const platformIcon = ticket.platform === "telegram" ? "✈️" : "📱";

  async function resolve() {
    setResolving(true);
    try {
      await fetch(`/api/bot-tickets/${ticket.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentNotes: notes || undefined, platform: ticket.platform }),
      });
      onResolved();
    } catch { /* ignore */ }
    finally { setResolving(false); }
  }

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-slate-800/20 transition-colors"
      >
        <span className="text-base mt-0.5 flex-shrink-0">{platformIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate">#{ticket.id} — {ticket.title}</span>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0", statusColor)}>
              {ticket.status}
            </span>
            <span className={cn("text-[10px] font-semibold flex-shrink-0", priorityColor)}>
              [{ticket.priority}]
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{ticket.fromName} · {new Date(ticket.createdAt).toLocaleString("id-ID")}</p>
        </div>
        <span className="text-slate-500 text-xs flex-shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-slate-800/60"
          >
            <div className="p-4 space-y-3">
              <div>
                <p className="text-[10px] text-slate-500 mb-1">Deskripsi</p>
                <p className="text-xs text-slate-300 whitespace-pre-wrap">{ticket.description}</p>
              </div>
              {ticket.steps && (
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Langkah Reproduksi</p>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap">{ticket.steps}</p>
                </div>
              )}
              {ticket.agentNotes && (
                <div className="bg-green-500/5 border border-green-500/15 rounded-lg p-3">
                  <p className="text-[10px] text-green-400 mb-1">Catatan Agent</p>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap">{ticket.agentNotes}</p>
                </div>
              )}
              {ticket.status !== "resolved" && ticket.status !== "closed" && (
                <div className="space-y-2 pt-1">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Catatan agent (opsional) — akan dikirim ke pelapor via bot"
                    rows={2}
                    className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors resize-none"
                  />
                  <button onClick={resolve} disabled={resolving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700/80 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                    {resolving ? "Mengirim..." : "✅ Tandai Selesai & Notifikasi"}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────────────────

function TicketsTab() {
  const [tickets, setTickets]     = useState<BotTicket[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<"all" | "open" | "resolved">("open");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    loadTickets();
    // Listen to new_ticket from both WA and TG SSE streams
    const waEs = new EventSource("/api/wa-bot/events");
    const tgEs = new EventSource("/api/tg-bot/events");
    const onNewTicket = () => loadTickets();
    waEs.addEventListener("new_ticket", onNewTicket);
    tgEs.addEventListener("new_ticket", onNewTicket);
    return () => { waEs.close(); tgEs.close(); };
  }, []);

  async function loadTickets() {
    try {
      const r = await fetch("/api/bot-tickets");
      const d = await r.json() as { tickets: BotTicket[] };
      setTickets(d.tickets);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  const filtered = tickets.filter((t) => {
    if (filter === "open")     return t.status !== "resolved" && t.status !== "closed";
    if (filter === "resolved") return t.status === "resolved" || t.status === "closed";
    return true;
  });

  const openCount = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      <div className="flex-none border-b border-slate-800/60 bg-slate-900/40 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <Ticket className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Tiket Laporan</h1>
              <p className="text-xs text-slate-400">Laporan dari WhatsApp & Telegram via perintah .report</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {openCount > 0 && (
              <span className="text-xs text-yellow-400 bg-yellow-500/15 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                {openCount} terbuka
              </span>
            )}
            <button onClick={loadTickets} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex gap-1 mt-4">
          {(["open", "all", "resolved"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                filter === f
                  ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25"
                  : "text-slate-400 hover:text-slate-300 hover:bg-slate-800"
              )}>
              {f === "open" ? "Terbuka" : f === "resolved" ? "Selesai" : "Semua"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loading && (
          <div className="text-center text-slate-500 text-sm py-12">
            <Ticket className="w-8 h-8 mx-auto mb-3 opacity-30 animate-pulse" />
            <p>Memuat tiket...</p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-12">
            <Ticket className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p>Tidak ada tiket {filter === "open" ? "terbuka" : filter === "resolved" ? "selesai" : ""}.</p>
            <p className="text-xs mt-1">Pengguna dapat membuat tiket via perintah <span className="font-mono text-slate-400">.report</span> di WhatsApp/Telegram.</p>
          </div>
        )}
        {filtered.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} onResolved={loadTickets} />
        ))}
      </div>
    </div>
  );
}

// ── Bot Center ─────────────────────────────────────────────────────────────────

export default function BotsPage() {
  const [active, setActive] = useState<BotId>("baileys");

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">

      {/* ── Switcher strip ─────────────────────────────────────────────────── */}
      <div className="flex-none border-b border-slate-800/60 bg-slate-900/60 px-5 py-2.5">
        <div className="flex items-center gap-3 flex-wrap">

          {/* Title */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold pr-3 border-r border-slate-700/60">
            <Bot className="w-3.5 h-3.5 text-slate-500" />
            <span>Bot Center</span>
          </div>

          {/* Bot cards */}
          {BOTS.map((bot) => {
            const isActive = active === bot.id;
            const colorMap: Record<string, string> = {
              green:  isActive ? "border-green-500/35 bg-green-500/8 shadow-sm shadow-green-500/10"  : "",
              blue:   isActive ? "border-blue-500/35 bg-blue-500/8 shadow-sm shadow-blue-500/10"     : "",
              yellow: isActive ? "border-yellow-500/35 bg-yellow-500/8 shadow-sm shadow-yellow-500/10" : "",
            };
            const labelColor: Record<string, string> = {
              green:  isActive ? "text-green-300"  : "text-slate-300",
              blue:   isActive ? "text-blue-300"   : "text-slate-300",
              yellow: isActive ? "text-yellow-300" : "text-slate-300",
            };
            return (
              <button
                key={bot.id}
                disabled={bot.soon}
                onClick={() => !bot.soon && setActive(bot.id)}
                className={cn(
                  "flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg border text-left transition-all",
                  bot.soon
                    ? "border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed"
                    : isActive
                      ? colorMap[bot.color]
                      : "border-slate-700/60 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/60"
                )}
              >
                <span className="text-base leading-none">{bot.icon}</span>
                <div className="min-w-0">
                  <div className={cn("text-xs font-semibold leading-tight truncate", bot.soon ? "text-slate-500" : labelColor[bot.color])}>
                    {bot.label}
                    {bot.soon && <span className="ml-1.5 text-[9px] font-normal text-slate-500 bg-slate-800 px-1 py-0.5 rounded uppercase tracking-wider">soon</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {bot.statusUrl && !bot.soon && <StatusDot url={bot.statusUrl} />}
                    <span className="text-[10px] text-slate-500 truncate">{bot.sub}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content panels ───────────────────────────────────────────────── */}
      <div className={cn("flex-1 overflow-hidden", active !== "baileys"  && "hidden")}><WaBotPage /></div>
      <div className={cn("flex-1 overflow-hidden", active !== "meta"     && "hidden")}><WhatsAppPage /></div>
      <div className={cn("flex-1 overflow-hidden", active !== "telegram" && "hidden")}><TgBotPage /></div>
      <div className={cn("flex-1 overflow-hidden", active !== "tickets"  && "hidden")}><TicketsTab /></div>
    </div>
  );
}
