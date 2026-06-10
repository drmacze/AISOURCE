/**
 * DLavie OS — AI NLP Tools API
 *
 * All tools use real HuggingFace Inference API pipelines (no simulation).
 * Endpoints:
 *   POST /api/tools/summarize        — Abstractive summarization (BART)
 *   POST /api/tools/translate        — Neural machine translation (Helsinki-NLP)
 *   POST /api/tools/sentiment        — Sentiment analysis (DistilBERT SST-2)
 *   POST /api/tools/classify         — Zero-shot text classification (BART-MNLI)
 *   POST /api/tools/ner              — Named entity recognition (BERT-NER)
 *   POST /api/tools/keywords         — TF-IDF keyword extraction (local, no API)
 *   POST /api/tools/paraphrase       — Paraphrase via Ollama/HF
 *   POST /api/tools/detect-language  — Language detection (local heuristics + HF)
 *   POST /api/tools/grammar          — Grammar correction via Ollama
 *   POST /api/tools/qa               — Question answering (deepset/roberta-base-squad2)
 */

import { Router, type IRouter } from "express";
import { getHFToken } from "../huggingface";
import { generateOllamaResponse, isOllamaOnline } from "../ollama";

const router: IRouter = Router();

const HF_BASE = "https://router.huggingface.co/hf-inference/models";
const TIMEOUT_MS = 25_000;

async function hfPost(model: string, body: object): Promise<Response> {
  const token = getHFToken();
  return fetch(`${HF_BASE}/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-use-cache": "false",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function requireHF(res: Parameters<typeof router.post>[1] extends (...args: infer P) => void ? ReturnType<() => import("express").Response> : never): boolean {
  if (!getHFToken()) {
    (res as import("express").Response).status(503).json({
      error: "HFTokenRequired",
      message: "HF_TOKEN not set. Add your HuggingFace token in Settings to use AI tools.",
    });
    return true;
  }
  return false;
}

// ─── POST /api/tools/summarize ────────────────────────────────────────────────
router.post("/tools/summarize", async (req, res) => {
  const { text, maxLength = 150, minLength = 30 } = req.body as {
    text?: string; maxLength?: number; minLength?: number;
  };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (!getHFToken()) { res.status(503).json({ error: "HFTokenRequired", message: "Set HF_TOKEN in Settings" }); return; }

  try {
    const r = await hfPost("facebook/bart-large-cnn", {
      inputs: text.slice(0, 4000),
      parameters: { max_length: maxLength, min_length: minLength, do_sample: false },
    });
    if (!r.ok) {
      const err = await r.text();
      res.status(502).json({ error: "HFError", message: err.slice(0, 200) });
      return;
    }
    const data = await r.json() as Array<{ summary_text: string }>;
    res.json({
      summary: data[0]?.summary_text || "",
      model: "facebook/bart-large-cnn",
      originalLength: text.length,
      summaryLength: data[0]?.summary_text?.length || 0,
      compressionRatio: Math.round((1 - (data[0]?.summary_text?.length || 0) / text.length) * 100),
    });
  } catch (e) {
    res.status(500).json({ error: "SummarizeError", message: String(e) });
  }
});

// ─── POST /api/tools/translate ────────────────────────────────────────────────
const LANG_MODELS: Record<string, string> = {
  "en-fr": "Helsinki-NLP/opus-mt-en-fr",
  "en-de": "Helsinki-NLP/opus-mt-en-de",
  "en-es": "Helsinki-NLP/opus-mt-en-es",
  "en-it": "Helsinki-NLP/opus-mt-en-it",
  "en-pt": "Helsinki-NLP/opus-mt-tc-big-en-pt",
  "en-zh": "Helsinki-NLP/opus-mt-en-zh",
  "en-ar": "Helsinki-NLP/opus-mt-en-ar",
  "en-ja": "Helsinki-NLP/opus-mt-en-jap",
  "en-ru": "Helsinki-NLP/opus-mt-en-ru",
  "en-id": "Helsinki-NLP/opus-mt-en-id",
  "fr-en": "Helsinki-NLP/opus-mt-fr-en",
  "de-en": "Helsinki-NLP/opus-mt-de-en",
  "es-en": "Helsinki-NLP/opus-mt-es-en",
  "zh-en": "Helsinki-NLP/opus-mt-zh-en",
  "ar-en": "Helsinki-NLP/opus-mt-ar-en",
  "ru-en": "Helsinki-NLP/opus-mt-ru-en",
};

router.post("/tools/translate", async (req, res) => {
  const { text, from = "en", to = "fr" } = req.body as { text?: string; from?: string; to?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (!getHFToken()) { res.status(503).json({ error: "HFTokenRequired", message: "Set HF_TOKEN in Settings" }); return; }

  const pair = `${from}-${to}`;
  const model = LANG_MODELS[pair];
  if (!model) {
    res.status(400).json({
      error: "UnsupportedPair",
      message: `Language pair "${pair}" not supported. Supported: ${Object.keys(LANG_MODELS).join(", ")}`,
    });
    return;
  }

  try {
    const r = await hfPost(model, { inputs: text.slice(0, 2000) });
    if (!r.ok) { const err = await r.text(); res.status(502).json({ error: "HFError", message: err.slice(0, 200) }); return; }
    const data = await r.json() as Array<{ translation_text: string }>;
    res.json({
      translation: data[0]?.translation_text || "",
      from, to, model,
      originalLength: text.length,
    });
  } catch (e) {
    res.status(500).json({ error: "TranslateError", message: String(e) });
  }
});

router.get("/tools/translate/languages", (_req, res) => {
  res.json({
    pairs: Object.keys(LANG_MODELS).map((pair) => ({
      pair,
      from: pair.split("-")[0],
      to: pair.split("-")[1],
      model: LANG_MODELS[pair],
    })),
  });
});

// ─── POST /api/tools/sentiment ────────────────────────────────────────────────
router.post("/tools/sentiment", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (!getHFToken()) { res.status(503).json({ error: "HFTokenRequired", message: "Set HF_TOKEN in Settings" }); return; }

  try {
    const r = await hfPost("distilbert-base-uncased-finetuned-sst-2-english", { inputs: text.slice(0, 512) });
    if (!r.ok) { const err = await r.text(); res.status(502).json({ error: "HFError", message: err.slice(0, 200) }); return; }
    const data = await r.json() as Array<Array<{ label: string; score: number }>>;
    const results = (data[0] || []).sort((a, b) => b.score - a.score);
    res.json({
      label: results[0]?.label || "UNKNOWN",
      score: Math.round((results[0]?.score || 0) * 1000) / 1000,
      confidence: Math.round((results[0]?.score || 0) * 100),
      all: results,
      model: "distilbert-base-uncased-finetuned-sst-2-english",
    });
  } catch (e) {
    res.status(500).json({ error: "SentimentError", message: String(e) });
  }
});

// ─── POST /api/tools/classify ─────────────────────────────────────────────────
router.post("/tools/classify", async (req, res) => {
  const { text, labels } = req.body as { text?: string; labels?: string[] };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (!Array.isArray(labels) || labels.length === 0) { res.status(400).json({ error: "labels array is required" }); return; }
  if (!getHFToken()) { res.status(503).json({ error: "HFTokenRequired", message: "Set HF_TOKEN in Settings" }); return; }

  try {
    const r = await hfPost("facebook/bart-large-mnli", {
      inputs: text.slice(0, 1024),
      parameters: { candidate_labels: labels.slice(0, 10), multi_label: false },
    });
    if (!r.ok) { const err = await r.text(); res.status(502).json({ error: "HFError", message: err.slice(0, 200) }); return; }
    const data = await r.json() as { labels: string[]; scores: number[]; sequence: string };
    const ranked = (data.labels || []).map((label, i) => ({
      label, score: Math.round((data.scores?.[i] || 0) * 1000) / 1000,
      confidence: Math.round((data.scores?.[i] || 0) * 100),
    })).sort((a, b) => b.score - a.score);
    res.json({
      topLabel: ranked[0]?.label || "",
      confidence: ranked[0]?.confidence || 0,
      results: ranked,
      model: "facebook/bart-large-mnli",
    });
  } catch (e) {
    res.status(500).json({ error: "ClassifyError", message: String(e) });
  }
});

// ─── POST /api/tools/ner ─────────────────────────────────────────────────────
router.post("/tools/ner", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (!getHFToken()) { res.status(503).json({ error: "HFTokenRequired", message: "Set HF_TOKEN in Settings" }); return; }

  try {
    const r = await hfPost("dslim/bert-base-NER", { inputs: text.slice(0, 1000) });
    if (!r.ok) { const err = await r.text(); res.status(502).json({ error: "HFError", message: err.slice(0, 200) }); return; }
    const raw = await r.json() as Array<{ entity_group?: string; entity?: string; word: string; score: number; start: number; end: number }>;

    // Group consecutive tokens of same entity
    const entities: Array<{ type: string; text: string; score: number; start: number; end: number }> = [];
    for (const item of raw) {
      const type = (item.entity_group || item.entity || "").replace(/^[BI]-/, "");
      if (entities.length > 0 && entities[entities.length - 1].type === type && item.start <= entities[entities.length - 1].end + 2) {
        const last = entities[entities.length - 1];
        last.text = (last.text + " " + item.word).replace(/\s##/g, "");
        last.end = item.end;
        last.score = Math.round(((last.score + item.score) / 2) * 1000) / 1000;
      } else {
        entities.push({ type, text: item.word.replace(/^##/, ""), score: Math.round(item.score * 1000) / 1000, start: item.start, end: item.end });
      }
    }

    // Count by type
    const byType: Record<string, number> = {};
    for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;

    res.json({ entities, byType, count: entities.length, model: "dslim/bert-base-NER" });
  } catch (e) {
    res.status(500).json({ error: "NERError", message: String(e) });
  }
});

// ─── POST /api/tools/keywords ─────────────────────────────────────────────────
// Pure local TF-IDF — no external API required
const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","could","should","may","might","shall","must","that","this","these",
  "those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","what",
  "which","who","when","where","how","why","not","no","as","if","then","than","so","because","about","from","into","through",
]);

router.post("/tools/keywords", (req, res) => {
  const { text, topK = 10 } = req.body as { text?: string; topK?: number };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const allWords = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // TF calculation
  const tf: Record<string, number> = {};
  for (const w of allWords) tf[w] = (tf[w] || 0) + 1;

  // IDF: simulate with sentence-level presence
  const idf: Record<string, number> = {};
  for (const word of Object.keys(tf)) {
    const inSentences = sentences.filter((s) => s.toLowerCase().includes(word)).length;
    idf[word] = Math.log((sentences.length + 1) / (inSentences + 1)) + 1;
  }

  const tfidf = Object.entries(tf).map(([word, freq]) => ({
    keyword: word,
    score: Math.round(freq * (idf[word] || 1) * 100) / 100,
    frequency: freq,
  })).sort((a, b) => b.score - a.score).slice(0, Math.min(topK, 30));

  res.json({ keywords: tfidf, totalWords: allWords.length, method: "tfidf-local" });
});

// ─── POST /api/tools/qa ───────────────────────────────────────────────────────
router.post("/tools/qa", async (req, res) => {
  const { question, context } = req.body as { question?: string; context?: string };
  if (!question?.trim() || !context?.trim()) { res.status(400).json({ error: "question and context are required" }); return; }
  if (!getHFToken()) { res.status(503).json({ error: "HFTokenRequired", message: "Set HF_TOKEN in Settings" }); return; }

  try {
    const r = await hfPost("deepset/roberta-base-squad2", {
      inputs: { question: question.slice(0, 500), context: context.slice(0, 3000) },
    });
    if (!r.ok) { const err = await r.text(); res.status(502).json({ error: "HFError", message: err.slice(0, 200) }); return; }
    const data = await r.json() as { answer: string; score: number; start: number; end: number };
    res.json({
      answer: data.answer || "",
      confidence: Math.round((data.score || 0) * 100),
      score: Math.round((data.score || 0) * 1000) / 1000,
      start: data.start, end: data.end,
      model: "deepset/roberta-base-squad2",
    });
  } catch (e) {
    res.status(500).json({ error: "QAError", message: String(e) });
  }
});

// ─── POST /api/tools/paraphrase ───────────────────────────────────────────────
router.post("/tools/paraphrase", async (req, res) => {
  const { text, style = "professional" } = req.body as { text?: string; style?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  const styleInstructions: Record<string, string> = {
    professional: "Rewrite the following text in a clear, professional tone:",
    casual:       "Rewrite the following text in a casual, friendly tone:",
    formal:       "Rewrite the following text in a formal, academic tone:",
    simple:       "Rewrite the following text in simpler words that anyone can understand:",
    creative:     "Rewrite the following text in a more creative and engaging way:",
    concise:      "Rewrite the following text more concisely, keeping only the key points:",
  };

  const instruction = styleInstructions[style] || styleInstructions.professional;
  const prompt = `${instruction}\n\n${text}\n\nRewritten:`;

  try {
    const ollamaOk = await isOllamaOnline();
    let paraphrase = "";

    if (ollamaOk) {
      paraphrase = await generateOllamaResponse(prompt, "tinyllama");
    } else if (getHFToken()) {
      const r = await hfPost("mistralai/Mistral-7B-Instruct-v0.2", {
        inputs: `<s>[INST] ${prompt} [/INST]`,
        parameters: { max_new_tokens: 300, temperature: 0.7 },
      });
      if (r.ok) {
        const data = await r.json() as Array<{ generated_text: string }>;
        paraphrase = data[0]?.generated_text?.split("[/INST]").pop()?.trim() || "";
      }
    }

    if (!paraphrase) { res.status(503).json({ error: "NoProviderAvailable", message: "Neither Ollama nor HuggingFace is available" }); return; }
    res.json({ paraphrase: paraphrase.trim(), style, originalLength: text.length });
  } catch (e) {
    res.status(500).json({ error: "ParaphraseError", message: String(e) });
  }
});

// ─── POST /api/tools/grammar ──────────────────────────────────────────────────
router.post("/tools/grammar", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  const prompt = `Correct the grammar and spelling in the following text. Only fix errors, do not change meaning or style. Return ONLY the corrected text with no explanation:\n\n${text}\n\nCorrected:`;

  try {
    let corrected = "";
    const ollamaOk = await isOllamaOnline();
    if (ollamaOk) {
      corrected = await generateOllamaResponse(prompt, "tinyllama");
    } else if (getHFToken()) {
      const r = await hfPost("vennify/t5-base-grammar-correction", { inputs: `grammar: ${text.slice(0, 1000)}` });
      if (r.ok) {
        const data = await r.json() as Array<{ generated_text: string }>;
        corrected = data[0]?.generated_text?.trim() || "";
      }
    }

    if (!corrected) { res.status(503).json({ error: "NoProvider", message: "No AI provider available" }); return; }
    res.json({ corrected: corrected.trim(), original: text });
  } catch (e) {
    res.status(500).json({ error: "GrammarError", message: String(e) });
  }
});

// ─── POST /api/tools/detect-language ─────────────────────────────────────────
router.post("/tools/detect-language", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  // Try HF language identification first
  if (getHFToken()) {
    try {
      const r = await hfPost("papluca/xlm-roberta-base-language-detection", { inputs: text.slice(0, 500) });
      if (r.ok) {
        const data = await r.json() as Array<Array<{ label: string; score: number }>>;
        const ranked = (data[0] || []).sort((a, b) => b.score - a.score).slice(0, 5);
        res.json({
          language: ranked[0]?.label || "unknown",
          confidence: Math.round((ranked[0]?.score || 0) * 100),
          topLanguages: ranked.map((r) => ({ language: r.label, confidence: Math.round(r.score * 100) })),
          model: "papluca/xlm-roberta-base-language-detection",
        });
        return;
      }
    } catch { /* fall through to heuristics */ }
  }

  // Heuristic fallback
  const heuristics: Array<[string, RegExp]> = [
    ["zh", /[\u4e00-\u9fff]/],
    ["ja", /[\u3040-\u309f\u30a0-\u30ff]/],
    ["ar", /[\u0600-\u06ff]/],
    ["ru", /[\u0400-\u04ff]/],
    ["ko", /[\uac00-\ud7af]/],
    ["hi", /[\u0900-\u097f]/],
  ];
  for (const [lang, pattern] of heuristics) {
    if (pattern.test(text)) {
      res.json({ language: lang, confidence: 85, method: "heuristic" });
      return;
    }
  }
  res.json({ language: "en", confidence: 60, method: "heuristic-default" });
});

// ─── POST /api/tools/fill-mask ───────────────────────────────────────────────
// Fill in the [MASK] token in a sentence using BERT
router.post("/tools/fill-mask", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required (include [MASK])" }); return; }
  if (!text.includes("[MASK]")) { res.status(400).json({ error: "text must contain [MASK] token" }); return; }
  if (requireHF(res)) return;
  try {
    const r = await hfPost("bert-base-uncased", { inputs: text });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json() as Array<{ token_str: string; score: number; sequence: string }>;
    res.json({
      input: text,
      predictions: data.slice(0, 5).map((d) => ({
        token: d.token_str,
        score: Math.round(d.score * 1000) / 1000,
        sequence: d.sequence,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── POST /api/tools/code-gen ────────────────────────────────────────────────
// Generate code via Ollama (local LLM)
router.post("/tools/code-gen", async (req, res) => {
  const { prompt, language = "python" } = req.body as { prompt?: string; language?: string };
  if (!prompt?.trim()) { res.status(400).json({ error: "prompt is required" }); return; }
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  if (!ollamaOnline) { res.status(503).json({ error: "Ollama offline", message: "Local LLM is required for code generation." }); return; }
  try {
    const sysPrompt = `You are an expert ${language} programmer. Generate clean, well-commented code only. Return only code without explanation unless asked.`;
    const userMsg = `Write ${language} code for: ${prompt.trim()}`;
    const result = await generateOllamaResponse(userMsg, sysPrompt);
    res.json({ language, prompt, code: result, model: "local-ollama" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── POST /api/tools/question-gen ────────────────────────────────────────────
// Generate questions from a passage via Ollama
router.post("/tools/question-gen", async (req, res) => {
  const { text, count = 5 } = req.body as { text?: string; count?: number };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  if (!ollamaOnline) { res.status(503).json({ error: "Ollama offline" }); return; }
  try {
    const sysPrompt = `You are an expert question generator. Given a passage, generate ${count} insightful questions that test comprehension. Return ONLY a numbered list of questions, nothing else.`;
    const result = await generateOllamaResponse(text.trim(), sysPrompt);
    const questions = result
      .split("\n")
      .map((l) => l.replace(/^\d+\.\s*/, "").trim())
      .filter((l) => l.endsWith("?") || l.length > 10)
      .slice(0, count);
    res.json({ count: questions.length, questions, model: "local-ollama" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── POST /api/tools/text-compare ────────────────────────────────────────────
// Compare two texts for similarity and differences
router.post("/tools/text-compare", async (req, res) => {
  const { textA, textB } = req.body as { textA?: string; textB?: string };
  if (!textA?.trim() || !textB?.trim()) { res.status(400).json({ error: "textA and textB are required" }); return; }
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  if (!ollamaOnline) { res.status(503).json({ error: "Ollama offline" }); return; }

  // Local similarity (Jaccard on words)
  const tokA = new Set(textA.toLowerCase().split(/\W+/).filter(Boolean));
  const tokB = new Set(textB.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...tokA].filter((t) => tokB.has(t)).length;
  const union = tokA.size + tokB.size - intersection;
  const jaccard = union > 0 ? Math.round((intersection / union) * 100) : 0;

  try {
    const sysPrompt = "You are a text analyst. Given two texts labeled TEXT_A and TEXT_B, provide: 1) Similarity percentage estimate, 2) Key similarities (bullet), 3) Key differences (bullet), 4) Which is more formal/detailed. Be concise.";
    const userMsg = `TEXT_A:\n${textA.slice(0, 1000)}\n\nTEXT_B:\n${textB.slice(0, 1000)}`;
    const analysis = await generateOllamaResponse(userMsg, sysPrompt);
    res.json({ jaccardSimilarity: jaccard, analysis, model: "local-ollama" });
  } catch (e) {
    res.json({ jaccardSimilarity: jaccard, analysis: null, error: String(e) });
  }
});

// ─── POST /api/tools/expand ──────────────────────────────────────────────────
// Expand a short text/outline into detailed content
router.post("/tools/expand", async (req, res) => {
  const { text, targetWords = 200, style = "informative" } = req.body as { text?: string; targetWords?: number; style?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  if (!ollamaOnline) { res.status(503).json({ error: "Ollama offline" }); return; }
  try {
    const sysPrompt = `You are a skilled writer. Expand the given text/outline into a detailed, ${style} piece of approximately ${targetWords} words. Preserve the key ideas but add depth, examples, and explanation.`;
    const result = await generateOllamaResponse(text.trim(), sysPrompt);
    const wordCount = result.split(/\s+/).length;
    res.json({ expanded: result, wordCount, originalLength: text.length, model: "local-ollama" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── POST /api/tools/bullets ─────────────────────────────────────────────────
// Convert text to bullet points / structured outline
router.post("/tools/bullets", async (req, res) => {
  const { text, style = "bullets" } = req.body as { text?: string; style?: "bullets" | "numbered" | "outline" };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  if (!ollamaOnline) { res.status(503).json({ error: "Ollama offline" }); return; }
  try {
    const sysPrompt = `You are a content structuring expert. Convert the given text into a clean ${style === "outline" ? "hierarchical outline with sub-points" : style === "numbered" ? "numbered list of key points" : "bullet-point summary"}. Extract the most important information. Return ONLY the structured list.`;
    const result = await generateOllamaResponse(text.trim(), sysPrompt);
    const lines = result.split("\n").filter((l) => l.trim().length > 0);
    res.json({ output: result, lines, style, model: "local-ollama" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── POST /api/tools/tone-adjust ─────────────────────────────────────────────
// Rewrite text in a different tone (formal, casual, professional, etc.)
router.post("/tools/tone-adjust", async (req, res) => {
  const { text, targetTone = "professional" } = req.body as { text?: string; targetTone?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  if (!ollamaOnline) { res.status(503).json({ error: "Ollama offline" }); return; }
  try {
    const sysPrompt = `You are a writing tone specialist. Rewrite the given text in a ${targetTone} tone. Preserve the meaning but adjust the vocabulary, formality level, and style to match ${targetTone} communication. Return only the rewritten text.`;
    const result = await generateOllamaResponse(text.trim(), sysPrompt);
    res.json({ original: text.trim(), rewritten: result, targetTone, model: "local-ollama" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── GET /api/tools/status ────────────────────────────────────────────────────
router.get("/tools/status", async (_req, res) => {
  const hfConnected = !!getHFToken();
  const ollamaOnline = await isOllamaOnline().catch(() => false);
  res.json({
    hfConnected,
    ollamaOnline,
    tools: {
      summarize:       { available: hfConnected, provider: "huggingface", model: "facebook/bart-large-cnn" },
      translate:       { available: hfConnected, provider: "huggingface", model: "Helsinki-NLP/opus-mt-*" },
      sentiment:       { available: hfConnected, provider: "huggingface", model: "distilbert-sst-2" },
      classify:        { available: hfConnected, provider: "huggingface", model: "facebook/bart-large-mnli" },
      ner:             { available: hfConnected, provider: "huggingface", model: "dslim/bert-base-NER" },
      keywords:        { available: true,        provider: "local-tfidf",  model: "tfidf" },
      paraphrase:      { available: hfConnected || ollamaOnline, provider: ollamaOnline ? "ollama" : "huggingface" },
      grammar:         { available: hfConnected || ollamaOnline, provider: ollamaOnline ? "ollama" : "huggingface" },
      qa:              { available: hfConnected, provider: "huggingface", model: "deepset/roberta-base-squad2" },
      detectLanguage:  { available: true, provider: hfConnected ? "huggingface" : "heuristic" },
      fillMask:        { available: hfConnected, provider: "huggingface", model: "bert-base-uncased" },
      codeGen:         { available: ollamaOnline, provider: "ollama" },
      questionGen:     { available: ollamaOnline, provider: "ollama" },
      textCompare:     { available: ollamaOnline, provider: "ollama" },
      expand:          { available: ollamaOnline, provider: "ollama" },
      bullets:         { available: ollamaOnline, provider: "ollama" },
      toneAdjust:      { available: ollamaOnline, provider: "ollama" },
    },
  });
});

export default router;
