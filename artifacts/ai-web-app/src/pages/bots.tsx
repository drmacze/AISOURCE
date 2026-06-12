/**
 * DLavie OS — Bot Center
 * Unified page for all chatbot integrations.
 * Each bot renders its own full UI below the switcher strip.
 */

import { useState, useEffect } from "react";
import { Bot, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import WaBotPage from "./wa-bot";
import WhatsAppPage from "./whatsapp";

type BotId = "baileys" | "meta" | "telegram";

interface BotDef {
  id:      BotId;
  label:   string;
  sub:     string;
  icon:    string;
  soon?:   boolean;
  statusUrl?: string;
}

const BOTS: BotDef[] = [
  {
    id:        "baileys",
    label:     "WhatsApp",
    sub:       "Baileys — pairing code",
    icon:      "📱",
    statusUrl: "/api/wa-bot/status",
  },
  {
    id:        "meta",
    label:     "WhatsApp",
    sub:       "Meta Cloud API — webhook",
    icon:      "🌐",
    statusUrl: "/api/whatsapp/status",
  },
  {
    id:    "telegram",
    label: "Telegram",
    sub:   "Bot API",
    icon:  "✈️",
    soon:  true,
  },
];

/** Tiny live-status dot for each card */
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
    const t = setInterval(check, 5000);
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
          {BOTS.map((bot) => (
            <button
              key={bot.id}
              disabled={bot.soon}
              onClick={() => !bot.soon && setActive(bot.id)}
              className={cn(
                "flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-lg border text-left transition-all",
                bot.soon
                  ? "border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed"
                  : active === bot.id
                    ? "border-green-500/35 bg-green-500/8 shadow-sm shadow-green-500/10"
                    : "border-slate-700/60 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/60"
              )}
            >
              {/* Icon */}
              <span className="text-base leading-none">{bot.icon}</span>

              {/* Labels */}
              <div className="min-w-0">
                <div className={cn(
                  "text-xs font-semibold leading-tight truncate",
                  bot.soon
                    ? "text-slate-500"
                    : active === bot.id ? "text-green-300" : "text-slate-300"
                )}>
                  {bot.label}
                  {bot.soon && <span className="ml-1.5 text-[9px] font-normal text-slate-500 bg-slate-800 px-1 py-0.5 rounded uppercase tracking-wider">soon</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {bot.statusUrl && !bot.soon && <StatusDot url={bot.statusUrl} />}
                  <span className="text-[10px] text-slate-500 truncate">{bot.sub}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Content — only the active bot is visible ──────────────────────── */}
      <div className={cn("flex-1 overflow-hidden", active !== "baileys" && "hidden")}>
        <WaBotPage />
      </div>
      <div className={cn("flex-1 overflow-hidden", active !== "meta" && "hidden")}>
        <WhatsAppPage />
      </div>
    </div>
  );
}
