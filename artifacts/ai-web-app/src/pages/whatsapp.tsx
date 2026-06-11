import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle, Settings2, Zap, CheckCircle2, XCircle,
  Copy, Check, RefreshCw, Trash2, Send, Info, Eye, EyeOff,
  Bot, PhoneCall, Key, Wifi, WifiOff, AlertTriangle, Clock,
  ArrowDownCircle, ArrowUpCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  const data = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((data as { error?: string; message?: string }).error || (data as { message?: string }).message || `HTTP ${res.status}`);
  return data;
}

const AI_PROVIDERS = [
  { value: "auto", label: "Auto (Groq → OpenRouter → HF → Ollama)", icon: "⚡" },
  { value: "groq", label: "Groq (LPU — paling cepat)", icon: "🚀" },
  { value: "openrouter", label: "OpenRouter (200+ model)", icon: "🌐" },
  { value: "hf", label: "HuggingFace (Qwen2.5-32B)", icon: "🤗" },
  { value: "ollama", label: "Ollama (lokal)", icon: "🦙" },
];

interface WhatsappConfig {
  id: number;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  businessAccountId: string;
  aiProvider: string;
  aiModel: string;
  aiApiKey: string;
  systemPrompt: string;
  enabled: boolean;
  botName: string;
}

interface WhatsappStatus {
  configured: boolean;
  enabled: boolean;
  phoneNumberId: string | null;
  botName: string | null;
  aiProvider: string | null;
  totalMessages: number;
  inboundMessages: number;
}

interface WaMessage {
  id: number;
  from: string;
  to: string | null;
  direction: "inbound" | "outbound";
  body: string;
  aiProvider: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-2 p-1 rounded hover:bg-slate-700 transition-colors"
      title="Salin"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
    </button>
  );
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"config" | "logs" | "test">("config");
  const [showToken, setShowToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("Halo! Ini pesan tes dari NEXUS Bot 🤖");

  const [form, setForm] = useState({
    phoneNumberId: "",
    accessToken: "",
    verifyToken: "",
    businessAccountId: "",
    aiProvider: "auto",
    aiModel: "",
    aiApiKey: "",
    systemPrompt: "Kamu adalah asisten AI yang membantu. Jawab dengan singkat dan jelas.",
    enabled: false,
    botName: "NEXUS Bot",
  });

  const { data: statusData, isLoading: statusLoading } = useQuery<WhatsappStatus>({
    queryKey: ["wa-status"],
    queryFn: () => apiFetch("/api/whatsapp/status") as Promise<WhatsappStatus>,
    refetchInterval: 10000,
  });

  const { data: configData } = useQuery<{ config: WhatsappConfig | null }>({
    queryKey: ["wa-config"],
    queryFn: () => apiFetch("/api/whatsapp/config") as Promise<{ config: WhatsappConfig | null }>,
  });

  useEffect(() => {
    const cfg = configData?.config;
    if (cfg) {
      setForm({
        phoneNumberId: cfg.phoneNumberId || "",
        accessToken: cfg.accessToken || "",
        verifyToken: cfg.verifyToken || "",
        businessAccountId: cfg.businessAccountId || "",
        aiProvider: cfg.aiProvider || "auto",
        aiModel: cfg.aiModel || "",
        aiApiKey: cfg.aiApiKey || "",
        systemPrompt: cfg.systemPrompt || "Kamu adalah asisten AI yang membantu. Jawab dengan singkat dan jelas.",
        enabled: cfg.enabled || false,
        botName: cfg.botName || "NEXUS Bot",
      });
    }
  }, [configData]);

  const { data: logsData, isLoading: logsLoading } = useQuery<{ logs: WaMessage[]; total: number }>({
    queryKey: ["wa-logs"],
    queryFn: () => apiFetch("/api/whatsapp/logs?limit=100") as Promise<{ logs: WaMessage[]; total: number }>,
    refetchInterval: tab === "logs" ? 5000 : false,
    enabled: tab === "logs",
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiFetch("/api/whatsapp/config", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "✅ Konfigurasi disimpan", description: "Bot WhatsApp berhasil dikonfigurasi." });
      qc.invalidateQueries({ queryKey: ["wa-config"] });
      qc.invalidateQueries({ queryKey: ["wa-status"] });
    },
    onError: (e: Error) => toast({ title: "❌ Gagal", description: e.message, variant: "destructive" }),
  });

  const clearLogsMutation = useMutation({
    mutationFn: () => apiFetch("/api/whatsapp/logs", { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "🗑️ Log dihapus" });
      qc.invalidateQueries({ queryKey: ["wa-logs"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/whatsapp/test", {
        method: "POST",
        body: JSON.stringify({ to: testTo, message: testMsg }),
      }),
    onSuccess: () => toast({ title: "📤 Pesan tes terkirim!", description: `Dikirim ke ${testTo}` }),
    onError: (e: Error) => toast({ title: "❌ Gagal kirim", description: e.message, variant: "destructive" }),
  });

  // Auto-generate verify token
  const generateVerifyToken = () => {
    const token = "nxs_" + Math.random().toString(36).slice(2, 18);
    setForm((f) => ({ ...f, verifyToken: token }));
  };

  // Use the Replit public domain if available, otherwise fall back to window.location.origin
  const replitDomain = (import.meta.env as Record<string, string>).VITE_REPLIT_DEV_DOMAIN;
  const publicOrigin = replitDomain
    ? `https://${replitDomain}`
    : window.location.origin;
  const webhookUrl = `${publicOrigin}/api/webhook/whatsapp`;
  const status = statusData;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "Syne, sans-serif" }}>
              WhatsApp Bot
            </h1>
            <p className="text-slate-400 text-sm">Hubungkan bot AI ke WhatsApp via Meta Cloud API</p>
          </div>
        </div>

        {/* Status bar */}
        {!statusLoading && status && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border text-sm",
              status.enabled && status.configured
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-slate-800/60 border-slate-700"
            )}
          >
            {status.enabled && status.configured ? (
              <><Wifi className="w-4 h-4 text-emerald-400 shrink-0" /><span className="text-emerald-300 font-medium">Bot Aktif</span></>
            ) : (
              <><WifiOff className="w-4 h-4 text-slate-500 shrink-0" /><span className="text-slate-400">{status.configured ? "Bot Nonaktif" : "Belum dikonfigurasi"}</span></>
            )}
            {status.botName && <span className="text-slate-400">— {status.botName}</span>}
            {status.phoneNumberId && (
              <span className="text-slate-500 font-mono text-xs">ID: {status.phoneNumberId}</span>
            )}
            <div className="ml-auto flex items-center gap-4 text-slate-400 text-xs">
              <span>📨 {status.totalMessages} pesan</span>
              <span>📥 {status.inboundMessages} masuk</span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-900/60 p-1 rounded-xl border border-slate-800 w-fit">
        {[
          { key: "config", label: "Konfigurasi", icon: Settings2 },
          { key: "logs", label: "Log Pesan", icon: Clock },
          { key: "test", label: "Tes Kirim", icon: Send },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === key
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── CONFIG TAB ─────────────────────────────────────────────── */}
        {tab === "config" && (
          <motion.div key="config" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

              {/* Left: Webhook Info */}
              <div className="space-y-4">
                {/* Webhook URL card */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
                  <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4" /> URL Webhook Meta
                  </h2>
                  <p className="text-xs text-slate-400 mb-3">
                    Masukkan URL ini di Meta Developer Console → WhatsApp → Konfigurasi Webhook
                  </p>
                  <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg p-3">
                    <code className="text-emerald-300 text-xs font-mono break-all flex-1">{webhookUrl}</code>
                    <CopyButton text={webhookUrl} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                    <p>1. Buka <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">developers.facebook.com</a></p>
                    <p>2. App → WhatsApp → Configuration → Webhook</p>
                    <p>3. Isi <strong className="text-slate-300">Callback URL</strong> dan <strong className="text-slate-300">Verify Token</strong> di bawah</p>
                    <p>4. Subscribe ke event: <code className="text-slate-300">messages</code></p>
                  </div>
                </div>

                {/* Bot toggle */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-white">Status Bot</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {form.enabled ? "Bot aktif dan menerima pesan" : "Bot nonaktif"}
                      </p>
                    </div>
                    <button
                      onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                      className={cn(
                        "relative w-12 h-6 rounded-full transition-all duration-300",
                        form.enabled ? "bg-emerald-500" : "bg-slate-700"
                      )}
                    >
                      <span className={cn(
                        "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-300",
                        form.enabled ? "left-6" : "left-0.5"
                      )} />
                    </button>
                  </div>
                </div>

                {/* AI Provider selector */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
                  <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4" /> Provider AI
                  </h2>
                  <div className="space-y-2">
                    {AI_PROVIDERS.map((p) => (
                      <button
                        key={p.value}
                        onClick={() => setForm((f) => ({ ...f, aiProvider: p.value }))}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-all",
                          form.aiProvider === p.value
                            ? "bg-yellow-500/10 border-yellow-500/40 text-yellow-200"
                            : "bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white"
                        )}
                      >
                        <span className="text-lg">{p.icon}</span>
                        <span className="flex-1">{p.label}</span>
                        {form.aiProvider === p.value && (
                          <CheckCircle2 className="w-4 h-4 text-yellow-400" />
                        )}
                      </button>
                    ))}
                  </div>
                  {form.aiProvider !== "auto" && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">API Key khusus (opsional — kosongkan untuk pakai sistem)</label>
                        <div className="relative">
                          <Input
                            type={showApiKey ? "text" : "password"}
                            value={form.aiApiKey}
                            onChange={(e) => setForm((f) => ({ ...f, aiApiKey: e.target.value }))}
                            placeholder="sk-... atau hf_..."
                            className="bg-slate-950 border-slate-700 text-white pr-10 font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                          >
                            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Model AI (opsional)</label>
                        <Input
                          value={form.aiModel}
                          onChange={(e) => setForm((f) => ({ ...f, aiModel: e.target.value }))}
                          placeholder="llama-3.3-70b-versatile"
                          className="bg-slate-950 border-slate-700 text-white font-mono text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Credentials */}
              <div className="space-y-4">
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                    <Key className="w-4 h-4" /> Kredensial Meta / WhatsApp
                  </h2>

                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Nama Bot</label>
                    <Input
                      value={form.botName}
                      onChange={(e) => setForm((f) => ({ ...f, botName: e.target.value }))}
                      placeholder="NEXUS Bot"
                      className="bg-slate-950 border-slate-700 text-white"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block flex items-center gap-1">
                      Phone Number ID
                      <span className="text-red-400">*</span>
                    </label>
                    <Input
                      value={form.phoneNumberId}
                      onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
                      placeholder="123456789012345"
                      className="bg-slate-950 border-slate-700 text-white font-mono"
                    />
                    <p className="text-xs text-slate-500 mt-1">Meta Developer → WhatsApp → Getting Started → Phone number ID</p>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block flex items-center gap-1">
                      Business Account ID (opsional)
                    </label>
                    <Input
                      value={form.businessAccountId}
                      onChange={(e) => setForm((f) => ({ ...f, businessAccountId: e.target.value }))}
                      placeholder="987654321098765"
                      className="bg-slate-950 border-slate-700 text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block flex items-center gap-1">
                      Access Token (Permanent Token)
                      <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Input
                        type={showToken ? "text" : "password"}
                        value={form.accessToken}
                        onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
                        placeholder="EAAxxxxx..."
                        className="bg-slate-950 border-slate-700 text-white pr-10 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Meta Developer → System User → Generate Token (pilih WhatsApp scope)</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-slate-400 flex items-center gap-1">
                        Verify Token
                        <span className="text-red-400">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={generateVerifyToken}
                        className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Generate
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={form.verifyToken}
                        onChange={(e) => setForm((f) => ({ ...f, verifyToken: e.target.value }))}
                        placeholder="token-verifikasi-rahasia"
                        className="bg-slate-950 border-slate-700 text-white font-mono text-sm"
                      />
                      <CopyButton text={form.verifyToken} />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Masukkan token ini juga di Meta Webhook Configuration</p>
                  </div>
                </div>

                {/* System prompt */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
                  <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Bot className="w-4 h-4" /> System Prompt Bot
                  </h2>
                  <Textarea
                    value={form.systemPrompt}
                    onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                    rows={4}
                    placeholder="Kamu adalah asisten AI yang membantu..."
                    className="bg-slate-950 border-slate-700 text-white text-sm resize-none"
                  />
                  <p className="text-xs text-slate-500 mt-2">Instruksi kepribadian dan perilaku bot</p>
                </div>

                {/* Save button */}
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl"
                  onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending || !form.phoneNumberId || !form.accessToken || !form.verifyToken}
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Menyimpan...</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4 mr-2" /> Simpan Konfigurasi</>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── LOGS TAB ────────────────────────────────────────────────── */}
        {tab === "logs" && (
          <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-white">Log Pesan</span>
                  {logsData && (
                    <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                      {logsData.total} pesan
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                  onClick={() => clearLogsMutation.mutate()}
                  disabled={clearLogsMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Hapus Log
                </Button>
              </div>

              {logsLoading ? (
                <div className="flex items-center justify-center h-48 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Memuat log...
                </div>
              ) : !logsData?.logs.length ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                  <MessageCircle className="w-8 h-8 mb-2 opacity-30" />
                  <p>Belum ada pesan</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800 max-h-[600px] overflow-y-auto">
                  {logsData.logs.map((msg) => (
                    <div key={msg.id} className="px-5 py-4 hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "mt-0.5 p-1.5 rounded-lg shrink-0",
                          msg.direction === "inbound"
                            ? "bg-blue-500/15 text-blue-400"
                            : "bg-emerald-500/15 text-emerald-400"
                        )}>
                          {msg.direction === "inbound"
                            ? <ArrowDownCircle className="w-4 h-4" />
                            : <ArrowUpCircle className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-mono text-xs text-slate-400">
                              {msg.direction === "inbound" ? `📱 ${msg.from}` : `📤 → ${msg.to || "?"}`}
                            </span>
                            {msg.aiProvider && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                {msg.aiProvider}
                              </span>
                            )}
                            <span className={cn(
                              "text-xs px-2 py-0.5 rounded-full",
                              msg.status === "sent" ? "bg-emerald-500/10 text-emerald-400" :
                              msg.status === "failed" ? "bg-red-500/10 text-red-400" :
                              msg.status === "processing" ? "bg-yellow-500/10 text-yellow-400" :
                              "bg-slate-700 text-slate-400"
                            )}>
                              {msg.status}
                            </span>
                          </div>
                          <p className="text-sm text-white leading-relaxed">{msg.body}</p>
                          {msg.errorMessage && (
                            <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {msg.errorMessage}
                            </p>
                          )}
                          <p className="text-xs text-slate-600 mt-1.5">
                            {new Date(msg.createdAt).toLocaleString("id-ID")}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── TEST TAB ────────────────────────────────────────────────── */}
        {tab === "test" && (
          <motion.div key="test" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="max-w-lg">
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2 mb-2">
                  <PhoneCall className="w-5 h-5 text-emerald-400" />
                  <h2 className="font-semibold text-white">Kirim Pesan Tes</h2>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-300 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Catatan:</strong> Nomor tujuan harus sudah menambahkan nomor bot sebagai kontak WhatsApp, 
                    dan akun Meta Anda harus dalam mode <strong>Production</strong> (bukan Sandbox) untuk mengirim ke nomor sembarang.
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Nomor Tujuan</label>
                  <Input
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="628123456789 (tanpa +)"
                    className="bg-slate-950 border-slate-700 text-white font-mono"
                  />
                  <p className="text-xs text-slate-500 mt-1">Format internasional tanpa +, contoh: 6281234567890</p>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Pesan</label>
                  <Textarea
                    value={testMsg}
                    onChange={(e) => setTestMsg(e.target.value)}
                    rows={4}
                    className="bg-slate-950 border-slate-700 text-white resize-none"
                  />
                </div>

                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !testTo || !testMsg}
                >
                  {testMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Mengirim...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Kirim Pesan Tes</>
                  )}
                </Button>

                {testMutation.isSuccess && (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> Pesan berhasil dikirim!
                  </div>
                )}
                {testMutation.isError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <XCircle className="w-4 h-4" /> {(testMutation.error as Error).message}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
