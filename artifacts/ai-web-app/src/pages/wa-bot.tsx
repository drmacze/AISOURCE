/**
 * DLavie OS — WhatsApp Bot Page (Baileys / Pairing Code)
 */

import { useState, useEffect, useRef } from "react";
import {
  MessageCircle, Plug, PlugZap, Settings, Bot, User, Phone,
  Loader2, CheckCircle2, XCircle, RefreshCw, LogOut, Zap,
  MessageSquare, Clock, ChevronRight, Sliders, AlertCircle,
  ImageIcon, Sparkles, Shield, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BotStatus {
  connected:    boolean;
  phoneNumber?: string;
  botName?:     string;
  pairingCode?: string;
  pairingStep?: "idle" | "waiting_code" | "waiting_scan" | "connected" | "error";
  error?:       string;
  messageCount: number;
  uptime?:      number;
  hasThumb:     boolean;
}

interface BotConfig {
  botName:        string;
  ownerName:      string;
  ownerNumber:    string;
  prefix:         string;
  style:          "formal" | "santai" | "custom";
  customPrompt:   string;
  activeModel:    string;
  autoReply:      boolean;
  replyInGroup:   boolean;
  welcomeMessage: string;
  phoneNumber:    string;
  deviceType:     "personal" | "business" | "mac" | "windows";
}

interface BotLog {
  ts:      number;
  from:    string;
  name:    string;
  isGroup: boolean;
  message: string;
  reply:   string;
  model:   string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BotConfig = {
  botName:        "DLavie Bot",
  ownerName:      "Owner",
  ownerNumber:    "",
  prefix:         ".",
  style:          "santai",
  customPrompt:   "",
  activeModel:    "auto",
  autoReply:      true,
  replyInGroup:   false,
  welcomeMessage: "Halo! Saya DLavie Bot, asisten AI Anda.",
  phoneNumber:    "",
  deviceType:     "personal",
};

const DEVICE_OPTIONS = [
  { value: "personal"  as const, label: "WA Personal",  desc: "Nomor biasa",          icon: "📱" },
  { value: "business"  as const, label: "WA Business",   desc: "Akun Business / UMKM", icon: "💼" },
  { value: "mac"       as const, label: "macOS Desktop", desc: "Fingerprint macOS",    icon: "🍎" },
  { value: "windows"   as const, label: "Windows",       desc: "Fingerprint Windows",  icon: "🖥️" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Save Confirmation Modal ──────────────────────────────────────────────────

function SaveModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5"
      >
        {/* Icon */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/25 flex items-center justify-center flex-shrink-0">
            <Shield className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Tentang Branding DLavie OS</h3>
            <p className="text-xs text-slate-400 mt-0.5">Dibaca sebelum menyimpan</p>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3 text-sm text-slate-300">
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <span className="text-base flex-shrink-0">🖼️</span>
              <div>
                <p className="font-medium text-white text-xs">Thumbnail otomatis di-generate AI</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Setiap bot mendapatkan foto profil unik bergambar <span className="text-green-400 font-medium">"DLavie OS"</span> yang
                  di-generate oleh AI (FLUX). Desain elegan, profesional, berbeda untuk tiap pengguna.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="text-base flex-shrink-0">✍️</span>
              <div>
                <p className="font-medium text-white text-xs">Footer "Powered by DLavie OS" di tiap pesan</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Setiap balasan bot menyertakan watermark teks untuk menghindari klaim hak cipta atas konten AI.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="text-base flex-shrink-0">✅</span>
              <div>
                <p className="font-medium text-white text-xs">Nama bot boleh bebas dikustomisasi</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Branding DLavie OS di thumbnail &amp; footer menjamin kepatuhan hak cipta tanpa membatasi kreativitas Anda.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm transition-colors">
            Batal
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors">
            Mengerti &amp; Simpan
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Thumbnail Panel ──────────────────────────────────────────────────────────

function ThumbnailPanel({ connected }: { connected: boolean }) {
  const [thumbSrc, setThumbSrc]         = useState<string | null>(null);
  const [generating, setGenerating]     = useState(false);
  const [applying, setApplying]         = useState(false);
  const [thumbMsg, setThumbMsg]         = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/wa-bot/thumbnail")
      .then((r) => r.json())
      .then((d: { data: string | null }) => setThumbSrc(d.data))
      .catch(() => {});
  }, []);

  async function generateNew() {
    setGenerating(true);
    setThumbMsg(null);
    try {
      const res = await fetch("/api/wa-bot/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newSeed: true }),
      });
      const d = await res.json() as { ok?: boolean; data?: string; error?: string };
      if (!res.ok || d.error) { setThumbMsg(`❌ ${d.error}`); return; }
      setThumbSrc(d.data ?? null);
      setThumbMsg("✅ Thumbnail baru berhasil di-generate!");
    } catch (e) { setThumbMsg(`❌ ${String(e)}`); }
    finally { setGenerating(false); }
  }

  async function applyToPic() {
    setApplying(true);
    setThumbMsg(null);
    try {
      const res = await fetch("/api/wa-bot/apply-profile-pic", { method: "POST" });
      const d = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || d.error) { setThumbMsg(`❌ ${d.error}`); return; }
      setThumbMsg("✅ Foto profil WhatsApp berhasil diperbarui!");
    } catch (e) { setThumbMsg(`❌ ${String(e)}`); }
    finally { setApplying(false); }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-purple-400" />
        <h2 className="text-sm font-semibold text-white">Thumbnail Profil Bot</h2>
        <span className="ml-auto text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
          AI Generated
        </span>
      </div>

      <div className="flex gap-4 items-start">
        {/* Preview */}
        <div className="flex-shrink-0">
          <div className="w-20 h-20 rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-800 flex items-center justify-center">
            {thumbSrc ? (
              <img src={thumbSrc} alt="Bot thumbnail" className="w-full h-full object-cover" />
            ) : (
              <Bot className="w-8 h-8 text-slate-600" />
            )}
          </div>
          {thumbSrc && (
            <p className="text-[10px] text-center text-slate-500 mt-1">Preview</p>
          )}
        </div>

        {/* Info + actions */}
        <div className="flex-1 space-y-3 min-w-0">
          <div className="text-xs text-slate-400 space-y-1">
            <p className="text-slate-300 font-medium">
              {thumbSrc ? "Thumbnail sudah ada ✅" : "Belum ada thumbnail"}
            </p>
            <p>Di-generate oleh AI (FLUX) dengan desain elegan profesional bertuliskan <span className="text-green-400">"DLavie OS"</span>.</p>
            <p className="text-slate-500">Setiap klik Generate menghasilkan desain unik yang berbeda.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateNew}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {generating ? "Generating…" : thumbSrc ? "Generate Ulang" : "Generate"}
            </button>
            {thumbSrc && connected && (
              <button
                onClick={applyToPic}
                disabled={applying}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700/80 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {applying ? "Applying…" : "Set ke WA"}
              </button>
            )}
          </div>
        </div>
      </div>

      {thumbMsg && (
        <p className={cn(
          "text-xs rounded-lg px-3 py-2",
          thumbMsg.startsWith("✅")
            ? "bg-green-500/10 border border-green-500/20 text-green-400"
            : "bg-red-500/10 border border-red-500/20 text-red-400"
        )}>
          {thumbMsg}
        </p>
      )}

      {/* Copyright notice */}
      <div className="flex items-start gap-2 bg-slate-800/40 rounded-lg p-3">
        <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Thumbnail selalu menyertakan teks <strong className="text-slate-300">"DLavie OS"</strong> untuk menghindari
          pelanggaran hak cipta. Nama bot boleh dikustomisasi bebas. Footer{" "}
          <em className="text-slate-300">Powered by DLavie OS</em> juga muncul di setiap balasan pesan.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAIRING_TTL_SEC = 60; // pairing codes expire ~60s

function PairingCountdown({ startedAt, onExpire }: { startedAt: number; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, PAIRING_TTL_SEC - Math.floor((Date.now() - startedAt) / 1000))
  );
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    const t = setInterval(() => {
      const r = Math.max(0, PAIRING_TTL_SEC - Math.floor((Date.now() - startedAt) / 1000));
      setRemaining(r);
      if (r === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    }, 500);
    return () => clearInterval(t);
  }, [startedAt, onExpire]);

  const pct = (remaining / PAIRING_TTL_SEC) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-slate-400"><Clock className="w-3 h-3" /> Kode berlaku</span>
        <span className={cn("font-mono font-bold", remaining < 15 ? "text-red-400" : remaining < 30 ? "text-yellow-400" : "text-green-400")}>
          {remaining}s
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500",
            remaining < 15 ? "bg-red-500" : remaining < 30 ? "bg-yellow-500" : "bg-green-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {remaining === 0 && (
        <p className="text-xs text-red-400 text-center font-medium">⚠ Kode kedaluwarsa — masukkan nomor & klik Connect lagi</p>
      )}
    </div>
  );
}

export default function WaBotPage() {
  const [status, setStatus]         = useState<BotStatus | null>(null);
  const [config, setConfig]         = useState<BotConfig>(DEFAULT_CONFIG);
  const [logs, setLogs]             = useState<BotLog[]>([]);
  const [tab, setTab]               = useState<"connect" | "config" | "logs">("connect");
  const [phoneInput, setPhoneInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [pairingStartedAt, setPairingStartedAt] = useState<number | null>(null);
  const [codeExpired, setCodeExpired]           = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    loadConfig();
    // SSE — replaces 3s polling
    const es = new EventSource("/api/wa-bot/events");
    esRef.current = es;
    es.addEventListener("wa_status", (e) => {
      const s = JSON.parse(e.data) as BotStatus;
      setStatus(s);
      if (s.pairingStep === "waiting_scan" && s.pairingCode) {
        // Fresh pairing code arrived — reset timer and expired flag
        setPairingStartedAt(Date.now());
        setCodeExpired(false);
      } else if (s.pairingStep !== "waiting_scan") {
        setPairingStartedAt(null);
        setCodeExpired(false);
      }
    });
    es.addEventListener("wa_message", (e) => {
      setLogs((prev) => [JSON.parse(e.data) as BotLog, ...prev].slice(0, 100));
    });
    // Initial status fetch (in case SSE event hasn't fired yet)
    loadStatus();
    return () => es.close();
  }, []);

  useEffect(() => {
    if (tab === "logs") loadLogs();
  }, [tab]);

  async function loadStatus() {
    try {
      const res = await fetch("/api/wa-bot/status");
      setStatus(await res.json() as BotStatus);
    } catch { /* ignore */ }
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/wa-bot/config");
      const data = await res.json() as BotConfig;
      setConfig(data);
      if (data.phoneNumber) setPhoneInput(data.phoneNumber);
    } catch { /* ignore */ }
  }

  async function loadLogs() {
    try {
      const res = await fetch("/api/wa-bot/logs");
      const data = await res.json() as { logs: BotLog[] };
      setLogs(data.logs);
    } catch { /* ignore */ }
  }

  async function handleConnect() {
    if (!phoneInput.trim()) { setError("Masukkan nomor WhatsApp bot (format: 6281234567890)"); return; }
    setError(null);
    setConnecting(true);
    try {
      const res = await fetch("/api/wa-bot/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneInput.trim() }),
      });
      const data = await res.json() as { pairingCode?: string; error?: string };
      if (!res.ok || data.error) { setError(data.error || "Gagal connect"); return; }
    } catch (e) { setError(String(e)); }
    finally { setConnecting(false); }
  }

  async function handleDisconnect() {
    if (!confirm("Putuskan koneksi WhatsApp bot? Session akan dihapus.")) return;
    await fetch("/api/wa-bot/disconnect", { method: "POST" });
    await loadStatus();
  }

  // Show confirmation modal on first "save" click
  function requestSave() {
    setShowSaveModal(true);
  }

  async function confirmSave() {
    setShowSaveModal(false);
    setSaving(true);
    try {
      await fetch("/api/wa-bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setConfigDirty(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  function updateConfig<K extends keyof BotConfig>(key: K, value: BotConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
    setConfigDirty(true);
  }

  const pairingCode = status?.pairingCode;
  const pairingStep = status?.pairingStep ?? "idle";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Save confirmation modal */}
      <AnimatePresence>
        {showSaveModal && (
          <SaveModal onConfirm={confirmSave} onCancel={() => setShowSaveModal(false)} />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex-none border-b border-slate-800/60 bg-slate-900/40 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">WhatsApp Bot</h1>
              <p className="text-xs text-slate-400">AI assistant via Baileys — pairing code</p>
            </div>
          </div>
          {status?.connected ? (
            <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Online · {status.messageCount} pesan
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-800 px-2.5 py-1 rounded-full border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              Offline
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {(["connect", "config", "logs"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                tab === t
                  ? "bg-green-500/15 text-green-400 border border-green-500/25"
                  : "text-slate-400 hover:text-slate-300 hover:bg-slate-800"
              )}>
              {t === "connect" ? "Koneksi" : t === "config" ? "Konfigurasi" : "Log Pesan"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-xs hover:text-red-300">✕</button>
          </div>
        )}

        <AnimatePresence mode="wait">

          {/* ── CONNECT TAB ── */}
          {tab === "connect" && (
            <motion.div key="connect" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {status?.connected && (
                <div className="rounded-xl border border-green-500/25 bg-green-500/5 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{status.botName || config.botName}</p>
                        <p className="text-xs text-slate-400">+{status.phoneNumber}</p>
                      </div>
                    </div>
                    <button onClick={handleDisconnect}
                      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg transition-colors">
                      <LogOut className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-white">{status.messageCount}</p>
                      <p className="text-xs text-slate-400">Pesan dibalas</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-white">{status.uptime ? formatUptime(status.uptime) : "—"}</p>
                      <p className="text-xs text-slate-400">Uptime</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-green-400">ON</p>
                      <p className="text-xs text-slate-400">Auto Reply</p>
                    </div>
                  </div>
                </div>
              )}

              {!status?.connected && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
                  <div className="flex items-center gap-2">
                    <PlugZap className="w-4 h-4 text-green-400" />
                    <h2 className="text-sm font-semibold text-white">Hubungkan WhatsApp</h2>
                  </div>

                  {/* Step indicator */}
                  <div className="flex items-center gap-2 text-xs">
                    {["Masukkan nomor", "Dapat kode", "Verifikasi di WA", "Connected"].map((s, i) => {
                      const stepDone =
                        (i === 0 && ["waiting_code","waiting_scan","connected"].includes(pairingStep)) ||
                        (i === 1 && ["waiting_scan","connected"].includes(pairingStep)) ||
                        (i === 2 && pairingStep === "connected") ||
                        (i === 3 && pairingStep === "connected");
                      const active =
                        (i === 0 && pairingStep === "idle") ||
                        (i === 1 && pairingStep === "waiting_code") ||
                        (i === 2 && pairingStep === "waiting_scan") ||
                        (i === 3 && pairingStep === "connected");
                      return (
                        <span key={i} className="flex items-center gap-1">
                          <span className={cn(
                            "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border",
                            stepDone ? "bg-green-500/20 border-green-500/40 text-green-400" :
                            active   ? "bg-blue-500/20 border-blue-500/40 text-blue-400" :
                                       "bg-slate-800 border-slate-700 text-slate-500"
                          )}>
                            {stepDone ? "✓" : i + 1}
                          </span>
                          <span className={cn("hidden sm:inline", active ? "text-blue-400" : stepDone ? "text-green-400" : "text-slate-500")}>{s}</span>
                          {i < 3 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                        </span>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Phone className="w-3 h-3" /> Nomor WhatsApp Bot (format internasional tanpa +)
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="6281234567890"
                        disabled={pairingStep === "waiting_code" || (pairingStep === "waiting_scan" && !codeExpired)}
                        className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-green-500 transition-colors disabled:opacity-50"
                        onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                      />
                      <button
                        onClick={handleConnect}
                        disabled={
                          connecting ||
                          !phoneInput.trim() ||
                          pairingStep === "waiting_code" ||
                          (pairingStep === "waiting_scan" && !codeExpired)
                        }
                        title={
                          pairingStep === "waiting_scan" && !codeExpired
                            ? "Tunggu countdown selesai sebelum request kode baru"
                            : undefined
                        }
                        className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
                        {connecting
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : codeExpired ? <RefreshCw className="w-4 h-4" /> : <Plug className="w-4 h-4" />
                        }
                        {pairingStep === "waiting_code"
                          ? "Meminta..."
                          : pairingStep === "waiting_scan" && !codeExpired
                            ? "Menunggu..."
                            : codeExpired
                              ? "Coba Lagi"
                              : "Connect"
                        }
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">Contoh: 6281234567890 (kode negara + nomor tanpa 0 di depan)</p>
                  </div>

                  {pairingCode && pairingStep === "waiting_scan" && (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      className="bg-slate-800/80 border border-green-500/30 rounded-xl p-5 space-y-3 text-center">
                      <p className="text-xs text-slate-400 font-medium">KODE PAIRING ANDA</p>
                      <div className="inline-block bg-slate-900 border-2 border-green-500/40 rounded-xl px-8 py-4">
                        <span className="text-4xl font-mono font-bold text-green-400 tracking-[0.25em]">{pairingCode}</span>
                      </div>
                      {/* Countdown timer */}
                      {pairingStartedAt && (
                        <div className="mx-auto max-w-xs">
                          <PairingCountdown
                            startedAt={pairingStartedAt}
                            onExpire={() => setCodeExpired(true)}
                          />
                        </div>
                      )}
                      <div className="space-y-1.5 text-xs text-slate-400 text-left bg-slate-900/50 rounded-lg p-3">
                        <p className="font-semibold text-slate-300">Cara verifikasi di WhatsApp:</p>
                        <p>1. Buka WhatsApp di HP nomor <span className="text-green-400 font-mono">{phoneInput}</span></p>
                        <p>2. Tap <span className="text-white font-medium">⋮ Menu → Perangkat Tertaut</span></p>
                        <p>3. Tap <span className="text-white font-medium">Tautkan dengan Nomor Telepon</span></p>
                        <p>4. Masukkan kode di atas → Selesai!</p>
                      </div>
                      <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Menunggu verifikasi...
                      </div>
                    </motion.div>
                  )}

                  {pairingStep === "waiting_code" && (
                    <div className="flex items-center gap-2 text-sm text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Meminta kode pairing dari WhatsApp...
                    </div>
                  )}

                  {pairingStep === "error" && status?.error && (
                    <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4" />
                      {status.error}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" /> Cara kerja DLavie WhatsApp Bot
                </p>
                <ul className="space-y-1 text-xs text-slate-400 list-disc list-inside">
                  <li>Gunakan nomor WA khusus bot (bukan nomor utama)</li>
                  <li>Setiap pesan yang masuk otomatis dibalas AI</li>
                  <li>Footer <em>"Powered by DLavie OS"</em> muncul di setiap balasan</li>
                  <li>Foto profil bot otomatis di-set thumbnail AI DLavie OS</li>
                  <li>Session tersimpan — tidak perlu pairing ulang setelah restart</li>
                </ul>
              </div>
            </motion.div>
          )}

          {/* ── CONFIG TAB ── */}
          {tab === "config" && (
            <motion.div key="config" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* Thumbnail panel — always shown at top of config */}
              <ThumbnailPanel connected={status?.connected ?? false} />

              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-purple-400" />
                    <h2 className="text-sm font-semibold text-white">Konfigurasi Bot</h2>
                  </div>
                  {configDirty && (
                    <button onClick={requestSave} disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Simpan
                    </button>
                  )}
                </div>

                {/* Branding notice */}
                <div className="flex items-start gap-2.5 bg-green-500/5 border border-green-500/15 rounded-lg p-3">
                  <Shield className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Nama bot bebas dikustomisasi. Setiap balasan otomatis menyertakan footer
                    {" "}<span className="text-green-400 italic">Powered by DLavie OS</span>{" "}
                    dan foto profil AI DLavie OS untuk kepatuhan hak cipta.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 flex items-center gap-1"><Bot className="w-3 h-3" /> Nama Bot</label>
                    <input value={config.botName} onChange={(e) => updateConfig("botName", e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 flex items-center gap-1"><User className="w-3 h-3" /> Nama Owner</label>
                    <input value={config.ownerName} onChange={(e) => updateConfig("ownerName", e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3" /> Nomor Owner</label>
                    <input value={config.ownerNumber} onChange={(e) => updateConfig("ownerNumber", e.target.value)}
                      placeholder="6281234567890"
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-green-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Prefix Command</label>
                    <input value={config.prefix} onChange={(e) => updateConfig("prefix", e.target.value)}
                      placeholder="."
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-green-500 transition-colors" />
                  </div>
                </div>

                {/* Style */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Style / Kepribadian Bot</label>
                  <div className="flex gap-2">
                    {(["formal","santai","custom"] as const).map((s) => (
                      <button key={s} onClick={() => updateConfig("style", s)}
                        className={cn("flex-1 py-2 text-xs rounded-lg border capitalize transition-colors",
                          config.style === s
                            ? "bg-green-500/15 border-green-500/40 text-green-400"
                            : "border-slate-700 text-slate-400 hover:border-slate-600"
                        )}>
                        {s === "formal" ? "🎩 Formal" : s === "santai" ? "😎 Santai" : "✏️ Custom"}
                      </button>
                    ))}
                  </div>
                  {config.style === "custom" && (
                    <textarea value={config.customPrompt} onChange={(e) => updateConfig("customPrompt", e.target.value)}
                      rows={3} placeholder="Tulis system prompt kustom untuk bot Anda..."
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors resize-none" />
                  )}
                </div>

                {/* Device type */}
                <div className="space-y-2">
                  <label className="text-xs text-slate-400 flex items-center gap-1">
                    <span>📲</span> Jenis Perangkat / Akun WhatsApp
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {DEVICE_OPTIONS.map((d) => (
                      <button key={d.value} onClick={() => updateConfig("deviceType", d.value)}
                        className={cn(
                          "flex items-start gap-2 p-3 rounded-lg border text-left transition-colors",
                          config.deviceType === d.value
                            ? "bg-green-500/10 border-green-500/50 text-green-300"
                            : "bg-slate-800/40 border-slate-700 text-slate-400 hover:border-slate-600"
                        )}>
                        <span className="text-lg leading-none">{d.icon}</span>
                        <div>
                          <p className="text-xs font-semibold leading-tight">{d.label}</p>
                          <p className="text-[10px] mt-0.5 opacity-70">{d.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    ⚠️ Gunakan nomor WA <strong className="text-slate-400">khusus bot</strong> — bukan nomor utama Anda.
                  </p>
                </div>

                {/* Welcome message */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Pesan Sambutan</label>
                  <textarea value={config.welcomeMessage} onChange={(e) => updateConfig("welcomeMessage", e.target.value)}
                    rows={2}
                    className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors resize-none" />
                </div>

                {/* Toggles */}
                <div className="border-t border-slate-800 pt-3 space-y-0">
                  <div className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm text-white">Auto Reply</p>
                      <p className="text-xs text-slate-400">Balas semua pesan masuk secara otomatis</p>
                    </div>
                    <button onClick={() => updateConfig("autoReply", !config.autoReply)}
                      className={cn("relative w-11 h-6 rounded-full transition-colors",
                        config.autoReply ? "bg-green-500" : "bg-slate-700")}>
                      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                        style={{ left: config.autoReply ? "calc(100% - 22px)" : "2px" }} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-t border-slate-800/60">
                    <div>
                      <p className="text-sm text-white">Balas di Grup</p>
                      <p className="text-xs text-slate-400">Aktifkan agar bot merespons pesan di grup WA</p>
                    </div>
                    <button onClick={() => updateConfig("replyInGroup", !config.replyInGroup)}
                      className={cn("relative w-11 h-6 rounded-full transition-colors",
                        config.replyInGroup ? "bg-green-500" : "bg-slate-700")}>
                      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                        style={{ left: config.replyInGroup ? "calc(100% - 22px)" : "2px" }} />
                    </button>
                  </div>
                </div>

                {configDirty && (
                  <button onClick={requestSave} disabled={saving}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Simpan Konfigurasi
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* ── LOGS TAB ── */}
          {tab === "logs" && (
            <motion.div key="logs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{logs.length} pesan tercatat</p>
                <button onClick={loadLogs} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {logs.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Belum ada pesan masuk</p>
                  <p className="text-xs mt-1">Kirim pesan ke bot untuk mulai</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log, i) => (
                    <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center",
                            log.isGroup ? "bg-purple-500/20" : "bg-blue-500/20"
                          )}>
                            {log.isGroup
                              ? <MessageCircle className="w-3 h-3 text-purple-400" />
                              : <User className="w-3 h-3 text-blue-400" />}
                          </div>
                          <span className="text-xs font-medium text-slate-300">{log.name}</span>
                          {log.isGroup && <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 rounded">grup</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />
                          {timeAgo(log.ts)}
                          <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{log.model.split("/")[0]}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5 pl-8">
                        <div className="bg-slate-800/50 rounded-lg px-3 py-2 text-xs text-slate-300">
                          <span className="text-slate-500 mr-1">→</span>{log.message}
                        </div>
                        <div className="bg-green-500/5 border border-green-500/15 rounded-lg px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap">
                          <span className="text-green-500 mr-1">←</span>{log.reply}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
