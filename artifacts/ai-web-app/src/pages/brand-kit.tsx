/**
 * DLavie OS — Brand Kit
 * Generate & download professional visual assets powered by FLUX AI.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles, Download, Trash2, RefreshCw, Loader2, ImageIcon,
  Layout, Monitor, Smartphone, Square, Layers, Palette,
  ChevronDown, Wand2, Copy, Check, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

type AssetType = "logo" | "banner" | "thumbnail" | "social" | "story" | "icon" | "wallpaper";

interface SizePreset { label: string; w: number; h: number; desc: string }
interface Asset {
  id: string; type: AssetType; preset: string; prompt: string;
  seed: number; w: number; h: number; createdAt: string; bytes: number;
  data: string | null;
}

// ─── Asset type definitions ───────────────────────────────────────────────────

const ASSET_TYPES: { id: AssetType; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
  { id: "logo",      label: "Logo",       icon: <Layers className="w-4 h-4" />,    desc: "Brand symbol",     color: "green" },
  { id: "banner",    label: "Banner",     icon: <Layout className="w-4 h-4" />,    desc: "Website / header", color: "blue" },
  { id: "thumbnail", label: "Thumbnail",  icon: <Monitor className="w-4 h-4" />,   desc: "Video / blog",     color: "purple" },
  { id: "social",    label: "Social",     icon: <Square className="w-4 h-4" />,    desc: "Instagram / FB",   color: "pink" },
  { id: "story",     label: "Story",      icon: <Smartphone className="w-4 h-4" />,desc: "IG / WA story",    color: "orange" },
  { id: "icon",      label: "App Icon",   icon: <ImageIcon className="w-4 h-4" />, desc: "App / favicon",    color: "teal" },
  { id: "wallpaper", label: "Wallpaper",  icon: <Monitor className="w-4 h-4" />,   desc: "Desktop / mobile", color: "violet" },
];

const COLOR_MAP: Record<string, string> = {
  green:  "border-green-500/40 bg-green-500/8 text-green-300",
  blue:   "border-blue-500/40 bg-blue-500/8 text-blue-300",
  purple: "border-purple-500/40 bg-purple-500/8 text-purple-300",
  pink:   "border-pink-500/40 bg-pink-500/8 text-pink-300",
  orange: "border-orange-500/40 bg-orange-500/8 text-orange-300",
  teal:   "border-teal-500/40 bg-teal-500/8 text-teal-300",
  violet: "border-violet-500/40 bg-violet-500/8 text-violet-300",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Asset Card ───────────────────────────────────────────────────────────────

function AssetCard({ asset, onDelete, onSelect }: {
  asset: Asset;
  onDelete: (id: string) => void;
  onSelect: (a: Asset) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Hapus aset ini?")) return;
    setDeleting(true);
    await fetch(`/api/brand-kit/assets/${asset.id}`, { method: "DELETE" });
    onDelete(asset.id);
  }

  const typeInfo = ASSET_TYPES.find((t) => t.id === asset.type);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={() => onSelect(asset)}
      className="group relative rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden cursor-pointer hover:border-slate-600 transition-all hover:shadow-lg hover:shadow-black/20"
    >
      {/* Image preview */}
      <div className="relative bg-slate-950 overflow-hidden" style={{ aspectRatio: `${asset.w}/${asset.h}`, maxHeight: "160px" }}>
        {asset.data ? (
          <img src={asset.data} alt={`${asset.type} ${asset.id}`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-slate-700" />
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <a
            href={`/api/brand-kit/assets/${asset.id}/download`}
            download
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-2 rounded-lg bg-red-600/80 hover:bg-red-500 text-white transition-colors"
            title="Hapus"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide",
            typeInfo ? COLOR_MAP[typeInfo.color] : "border-slate-700 text-slate-400"
          )}>
            {typeInfo?.icon}
            {asset.type}
          </span>
          <span className="text-[10px] text-slate-500">{asset.preset}</span>
        </div>
        <p className="text-[10px] text-slate-500">{asset.w}×{asset.h}px · {formatBytes(asset.bytes)}</p>
        <p className="text-[10px] text-slate-600">{timeAgo(asset.createdAt)}</p>
      </div>
    </motion.div>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copySeed() {
    navigator.clipboard.writeText(String(asset.seed));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl max-w-3xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image */}
        <div className="bg-slate-950 flex items-center justify-center p-4" style={{ maxHeight: "60vh" }}>
          {asset.data && (
            <img src={asset.data} alt={asset.type} className="max-w-full max-h-full object-contain rounded-lg" />
          )}
        </div>

        {/* Info */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Tipe",    value: asset.type },
              { label: "Preset",  value: asset.preset },
              { label: "Ukuran", value: `${asset.w}×${asset.h}px` },
              { label: "File",    value: formatBytes(asset.bytes) },
            ].map((item) => (
              <div key={item.label} className="bg-slate-800/50 rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500 mb-0.5">{item.label}</p>
                <p className="text-xs text-slate-200 font-medium">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
            <span className="text-slate-500">Seed:</span>
            <span className="font-mono text-slate-300">{asset.seed}</span>
            <button onClick={copySeed} className="ml-1 p-1 rounded hover:bg-slate-700 transition-colors">
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
            </button>
            <span className="ml-auto text-slate-500 text-[10px]">Prompt: {asset.prompt}</span>
          </div>

          <div className="flex gap-3">
            <a
              href={`/api/brand-kit/assets/${asset.id}/download`}
              download
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              <Download className="w-4 h-4" /> Download
            </a>
            <button onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm transition-colors">
              Tutup
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BrandKitPage() {
  const [assets, setAssets]             = useState<Asset[]>([]);
  const [presets, setPresets]           = useState<Record<AssetType, SizePreset[]>>({} as Record<AssetType, SizePreset[]>);
  const [selectedType, setSelectedType] = useState<AssetType>("logo");
  const [presetIndex, setPresetIndex]   = useState(0);
  const [customPrompt, setCustomPrompt] = useState("");
  const [useCustom, setUseCustom]       = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [genProgress, setGenProgress]   = useState("");
  const [preview, setPreview]           = useState<Asset | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => { loadPresets(); loadAssets(); }, []);

  async function loadPresets() {
    try {
      const r = await fetch("/api/brand-kit/presets");
      const d = await r.json() as { presets: Record<AssetType, SizePreset[]> };
      setPresets(d.presets);
    } catch { /* ignore */ }
  }

  const loadAssets = useCallback(async () => {
    try {
      const r = await fetch("/api/brand-kit/assets");
      const d = await r.json() as { assets: Asset[] };
      setAssets(d.assets);
    } catch { /* ignore */ }
  }, []);

  async function generate() {
    setError(null);
    setGenerating(true);
    setGenProgress("Mengirim permintaan ke FLUX AI…");
    try {
      const r = await fetch("/api/brand-kit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          presetIndex,
          customPrompt: useCustom && customPrompt.trim() ? customPrompt.trim() : undefined,
        }),
      });
      const d = await r.json() as { ok?: boolean; asset?: Asset; error?: string };
      if (!r.ok || d.error) { setError(d.error || "Gagal generate"); return; }
      if (d.asset) {
        setPreview(d.asset);
        setAssets((prev) => [d.asset!, ...prev]);
      }
      setGenProgress("");
    } catch (e) {
      setError(String(e));
      setGenProgress("");
    } finally {
      setGenerating(false);
    }
  }

  function removeAsset(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    if (preview?.id === id) setPreview(null);
  }

  const typeInfo     = ASSET_TYPES.find((t) => t.id === selectedType)!;
  const currPresets  = presets[selectedType] ?? [];
  const currentPreset = currPresets[presetIndex] ?? currPresets[0];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-none border-b border-slate-800/60 bg-slate-900/40 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Palette className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Brand Kit</h1>
              <p className="text-xs text-slate-400">Generate aset visual DLavie OS dengan AI (FLUX)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-1.5">
            <Sparkles className="w-3 h-3 text-purple-400" />
            FLUX.1-schnell · HuggingFace
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6 max-w-6xl mx-auto">

          {/* ── Generator panel ──────────────────────────────────────────────── */}
          <div className="grid lg:grid-cols-[1fr_380px] gap-6">

            {/* Left: controls */}
            <div className="space-y-5">

              {/* Asset type selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Jenis Aset</label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {ASSET_TYPES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setSelectedType(t.id); setPresetIndex(0); }}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all",
                        selectedType === t.id
                          ? cn("border opacity-100", COLOR_MAP[t.color])
                          : "border-slate-700/60 bg-slate-800/30 text-slate-500 hover:border-slate-600 hover:text-slate-400"
                      )}
                    >
                      <span className="flex-shrink-0">{t.icon}</span>
                      <span className="text-[10px] font-medium leading-tight">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Size preset selector */}
              {currPresets.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Ukuran</label>
                  <div className="flex flex-wrap gap-2">
                    {currPresets.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => setPresetIndex(i)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors",
                          presetIndex === i
                            ? "border-green-500/40 bg-green-500/8 text-green-300"
                            : "border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600"
                        )}
                      >
                        <span className="font-medium">{p.label}</span>
                        <span className="text-slate-500">{p.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom prompt toggle */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setUseCustom((v) => !v)}
                    className={cn(
                      "relative w-9 h-5 rounded-full transition-colors flex-shrink-0",
                      useCustom ? "bg-green-500" : "bg-slate-700"
                    )}
                  >
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                      style={{ left: useCustom ? "calc(100% - 18px)" : "2px" }} />
                  </button>
                  <label className="text-xs text-slate-400">Tambah deskripsi kustom</label>
                </div>
                <AnimatePresence>
                  {useCustom && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        rows={2}
                        placeholder="Contoh: dengan warna biru tua, tambahkan teks tagline 'Built for Humans'…"
                        className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500 transition-colors resize-none"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Notice */}
              <div className="flex items-start gap-2 bg-slate-800/40 border border-slate-700/40 rounded-lg p-3">
                <Info className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Semua aset yang di-generate secara otomatis menyertakan branding <strong className="text-slate-400">DLavie OS</strong> untuk kepatuhan hak cipta.
                  Seed tersimpan sehingga desain dapat direproduksi kembali.
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={generate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2.5 py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg shadow-purple-500/20"
              >
                {generating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating… (~30 detik)</>
                  : <><Wand2 className="w-4 h-4" /> Generate {typeInfo.label} {currentPreset ? `· ${currentPreset.desc}` : ""}</>
                }
              </button>
              {generating && (
                <p className="text-center text-xs text-slate-500 animate-pulse">{genProgress}</p>
              )}
            </div>

            {/* Right: Preview */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Preview Terbaru</label>
              <div className={cn(
                "rounded-xl border-2 border-dashed overflow-hidden bg-slate-900/40 flex items-center justify-center transition-colors",
                preview ? "border-slate-700" : "border-slate-800"
              )} style={{ minHeight: "220px" }}>
                {preview?.data ? (
                  <div className="w-full relative group cursor-pointer" onClick={() => setSelectedAsset(preview)}>
                    <img src={preview.data} alt={preview.type} className="w-full object-contain" style={{ maxHeight: "300px" }} />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <a href={`/api/brand-kit/assets/${preview.id}/download`} download onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors">
                        <Download className="w-3.5 h-3.5" /> Download
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 px-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-3">
                      <Wand2 className="w-5 h-5 text-slate-600" />
                    </div>
                    <p className="text-sm text-slate-500">Klik Generate untuk membuat aset</p>
                    <p className="text-xs text-slate-600 mt-1">Hasil muncul di sini</p>
                  </div>
                )}
              </div>
              {preview && (
                <div className="flex gap-2">
                  <a href={`/api/brand-kit/assets/${preview.id}/download`} download
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-700/70 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors">
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                  <button onClick={generate} disabled={generating}
                    className="flex items-center gap-1.5 px-3 py-2 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-white text-xs rounded-lg transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Buat ulang
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Gallery ──────────────────────────────────────────────────────── */}
          {assets.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-slate-400" />
                  Koleksi Aset
                  <span className="text-xs font-normal text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{assets.length}</span>
                </h2>
                <button onClick={loadAssets} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              <motion.div
                layout
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
              >
                <AnimatePresence>
                  {assets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      onDelete={removeAsset}
                      onSelect={setSelectedAsset}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          )}

          {/* Empty state */}
          {assets.length === 0 && !generating && (
            <div className="text-center py-12 space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto">
                <Palette className="w-7 h-7 text-slate-700" />
              </div>
              <p className="text-slate-400 font-medium">Belum ada aset yang di-generate</p>
              <p className="text-sm text-slate-500">Pilih jenis aset di atas lalu klik Generate</p>
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      <AnimatePresence>
        {selectedAsset && (
          <PreviewModal asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
