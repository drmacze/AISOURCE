import React, { useState, useRef } from "react";
import {
  Image, Sparkles, Download, RefreshCw, Loader2, AlertCircle,
  ChevronDown, Wand2, Sliders, X, CheckCircle2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface ImageModel {
  id: string;
  name: string;
  desc: string;
  steps: number;
}

interface GeneratedImage {
  image: string;
  model: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  generatedAt: string;
}

const STYLE_PRESETS = [
  { label: "Photorealistic", suffix: ", photorealistic, 8k, sharp, detailed" },
  { label: "Digital Art", suffix: ", digital art, concept art, trending on artstation" },
  { label: "Anime", suffix: ", anime style, vibrant colors, studio quality" },
  { label: "Oil Painting", suffix: ", oil painting, masterpiece, classical art" },
  { label: "Cinematic", suffix: ", cinematic lighting, movie still, anamorphic" },
  { label: "Sketch", suffix: ", pencil sketch, black and white, detailed drawing" },
];

const EXAMPLE_PROMPTS = [
  "A futuristic AI command center glowing with neon green lights, dark atmosphere",
  "Mountain landscape at golden hour, misty valley, cinematic photography",
  "Abstract neural network visualization, electric blue and purple, digital art",
  "Cyber city at night, rain reflections, neon signs, blade runner aesthetic",
  "Portrait of a robot philosopher, deep thinking, warm studio light",
  "Deep ocean bioluminescent creatures, dark water, scientific illustration",
];

export default function Generate() {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("ugly, blurry, low quality, watermark, bad anatomy");
  const [selectedModel, setSelectedModel] = useState("");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(7.5);
  const [selectedStyle, setSelectedStyle] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [selectedImg, setSelectedImg] = useState<GeneratedImage | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: modelsData } = useQuery<{ models: ImageModel[]; hfConfigured: boolean }>({
    queryKey: ["image-models"],
    queryFn: () => fetch(`${BASE}/api/image/models`).then((r) => r.json()),
  });

  const models = modelsData?.models || [];
  const hfConfigured = modelsData?.hfConfigured ?? false;
  const activeModel = selectedModel || models[0]?.id || "";

  const fullPrompt = prompt + (selectedStyle ? STYLE_PRESETS.find((s) => s.label === selectedStyle)?.suffix || "" : "");

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setError(null);
    setGenerating(true);

    try {
      const res = await fetch(`${BASE}/api/image/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: fullPrompt,
          negativePrompt,
          model: activeModel,
          width,
          height,
          steps,
          guidanceScale: guidance,
        }),
      });

      const data = await res.json() as GeneratedImage & { error?: string; message?: string; retryAfter?: number };

      if (!res.ok) {
        if (res.status === 503 && data.retryAfter) {
          setRetryAfter(data.retryAfter);
          setError(`Model warming up — auto-retrying in ${data.retryAfter}s`);
          retryTimer.current = setTimeout(() => {
            setRetryAfter(0);
            generate();
          }, data.retryAfter * 1000);
        } else {
          setError(data.message || data.error || "Generation failed");
        }
        return;
      }

      setGallery((prev) => [data, ...prev.slice(0, 19)]);
      setSelectedImg(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const downloadImage = (img: GeneratedImage) => {
    const a = document.createElement("a");
    a.href = img.image;
    a.download = `dlavie-ai-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — controls */}
      <aside className="w-80 flex-shrink-0 border-r border-border bg-card/40 flex flex-col overflow-y-auto">
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <Wand2 className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-base">Image Generation</h2>
          </div>
          <p className="text-xs text-muted-foreground font-mono">HuggingFace · FLUX · SDXL</p>
        </div>

        <div className="flex-1 p-4 space-y-4">
          {/* HF status */}
          {!hfConfigured && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>HF_TOKEN not set. Add it in Secrets to enable image generation.</span>
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">PROMPT</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) generate(); }}
              placeholder="Describe the image you want to generate..."
              className="w-full min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground font-mono">Ctrl+Enter to generate</p>
          </div>

          {/* Style presets */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">STYLE PRESET</label>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLE_PRESETS.map((style) => (
                <button
                  key={style.label}
                  onClick={() => setSelectedStyle(selectedStyle === style.label ? "" : style.label)}
                  className={cn(
                    "text-[10px] font-mono px-2 py-1.5 rounded border transition-colors text-left truncate",
                    selectedStyle === style.label
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Example prompts */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">EXAMPLES</label>
            <div className="space-y-1">
              {EXAMPLE_PROMPTS.slice(0, 3).map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="w-full text-left text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded hover:bg-primary/5 border border-transparent hover:border-primary/20 truncate"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">MODEL</label>
            <div className="space-y-1">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={cn(
                    "w-full text-left p-2.5 rounded-lg border text-xs transition-colors",
                    activeModel === m.id
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  )}
                >
                  <div className="font-mono font-medium">{m.name}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
            >
              <Sliders className="w-3.5 h-3.5" />
              Advanced settings
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showAdvanced && "rotate-180")} />
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-muted-foreground">NEGATIVE PROMPT</label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    rows={2}
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-[11px] font-mono resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-muted-foreground">WIDTH</label>
                    <select
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                      className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none"
                    >
                      {[256, 512, 768, 1024].map((v) => <option key={v} value={v}>{v}px</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-muted-foreground">HEIGHT</label>
                    <select
                      value={height}
                      onChange={(e) => setHeight(Number(e.target.value))}
                      className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none"
                    >
                      {[256, 512, 768, 1024].map((v) => <option key={v} value={v}>{v}px</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-muted-foreground">STEPS: {steps}</label>
                  <input
                    type="range" min={1} max={50} value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-muted-foreground">GUIDANCE: {guidance}</label>
                  <input
                    type="range" min={1} max={20} step={0.5} value={guidance}
                    onChange={(e) => setGuidance(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Generate button */}
        <div className="p-4 border-t border-border">
          {error && (
            <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <Button
            className="w-full gap-2 font-mono"
            onClick={generate}
            disabled={!prompt.trim() || generating || !hfConfigured}
          >
            {generating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
            ) : retryAfter > 0 ? (
              <><Clock className="w-4 h-4" /> Retry in {retryAfter}s</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Generate Image</>
            )}
          </Button>
        </div>
      </aside>

      {/* Main area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Current result */}
        <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
          {selectedImg ? (
            <div className="flex flex-col items-center gap-4 max-h-full">
              <div className="relative group">
                <img
                  src={selectedImg.image}
                  alt={selectedImg.prompt}
                  className="max-h-[60vh] max-w-full rounded-xl border border-border shadow-2xl object-contain"
                />
                <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => downloadImage(selectedImg)}
                    className="p-2 rounded-lg bg-background/90 hover:bg-background border border-border text-foreground transition-colors"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setPrompt(selectedImg.prompt); generate(); }}
                    className="p-2 rounded-lg bg-background/90 hover:bg-background border border-border text-foreground transition-colors"
                    title="Regenerate"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="text-center max-w-lg">
                <p className="text-sm font-mono text-muted-foreground line-clamp-2">{selectedImg.prompt}</p>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                  {selectedImg.model.split("/")[1]} · {selectedImg.width}×{selectedImg.height} · {selectedImg.steps} steps
                </p>
              </div>
            </div>
          ) : generating ? (
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-2 border-primary/20 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-primary animate-pulse" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-base font-medium">Generating image...</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">This may take 10–60 seconds</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center text-muted-foreground">
              <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-border flex items-center justify-center">
                <Image className="w-10 h-10 opacity-20" />
              </div>
              <div>
                <p className="text-base font-medium">No image generated yet</p>
                <p className="text-xs font-mono mt-1">Enter a prompt and click Generate</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {EXAMPLE_PROMPTS.slice(3).map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setPrompt(ex)}
                    className="text-[10px] font-mono text-left px-3 py-2 rounded-lg border border-border hover:border-primary/40 hover:text-primary transition-colors line-clamp-2"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Gallery strip */}
        {gallery.length > 0 && (
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono text-muted-foreground">GALLERY ({gallery.length})</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {gallery.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImg(img)}
                  className={cn(
                    "flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors",
                    selectedImg === img ? "border-primary" : "border-border hover:border-primary/50"
                  )}
                >
                  <img src={img.image} alt={img.prompt} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
