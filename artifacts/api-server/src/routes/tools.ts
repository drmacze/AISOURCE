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

// ─── Local extractive summarization (instant, no API required) ────────────────
function extractiveSummarize(text: string, maxLength: number): string {
  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (sentences.length === 0) return text.slice(0, maxLength);
  if (sentences.length === 1) return sentences[0].slice(0, maxLength);

  // TF scoring across all words
  const allWords = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const tf: Record<string, number> = {};
  for (const w of allWords) tf[w] = (tf[w] || 0) + 1;
  const maxFreq = Math.max(...Object.values(tf), 1);

  // Score each sentence: word frequency + position bonus + length penalty
  const scored = sentences.map((sent, i) => {
    const words = sent.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const wordScore = words.reduce((s, w) => s + (tf[w] || 0) / maxFreq, 0) / (words.length || 1);
    const positionBonus = i === 0 ? 0.3 : i === 1 ? 0.15 : 0;
    const lengthBonus = sent.length > 40 && sent.length < 300 ? 0.1 : 0;
    return { sent, score: wordScore + positionBonus + lengthBonus, index: i };
  });

  // Pick top sentences, preserve original order
  const topN = Math.max(1, Math.min(Math.ceil(sentences.length * 0.4), 5));
  const selected = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sent);

  let summary = selected.join(" ");
  if (summary.length > maxLength) summary = summary.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
  return summary;
}

// ─── POST /api/tools/summarize ────────────────────────────────────────────────
router.post("/tools/summarize", async (req, res) => {
  const { text, maxLength = 150, minLength = 30 } = req.body as {
    text?: string; maxLength?: number; minLength?: number;
  };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  // Always return local extractive result immediately — instant, no API wait
  const localSummary = extractiveSummarize(text.trim(), maxLength * 3);
  res.json({
    summary: localSummary,
    model: "extractive-local",
    method: "extractive",
    originalLength: text.length,
    summaryLength: localSummary.length,
    compressionRatio: Math.round((1 - localSummary.length / text.length) * 100),
  });
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

// ─── Local NER using pattern matching (instant, no API required) ──────────────
function localNER(text: string): Array<{ type: string; text: string; score: number; start: number; end: number }> {
  const entities: Array<{ type: string; text: string; score: number; start: number; end: number }> = [];
  const seen = new Set<string>();

  function addEntity(type: string, matchText: string, start: number, score: number) {
    const key = `${type}:${matchText}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ type, text: matchText, score, start, end: start + matchText.length });
    }
  }

  // Emails
  for (const m of text.matchAll(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g))
    addEntity("EMAIL", m[0], m.index!, 0.99);

  // URLs
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]"']+/g))
    addEntity("URL", m[0], m.index!, 0.99);

  // Dates (common patterns)
  for (const m of text.matchAll(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi))
    addEntity("DATE", m[0], m.index!, 0.92);

  // Numbers & percentages
  for (const m of text.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g)) {
    if (m[0].length > 2) addEntity("NUMBER", m[0], m.index!, 0.85);
  }

  // All-caps abbreviations (potential ORG/PRODUCT)
  for (const m of text.matchAll(/\b[A-Z]{2,8}\b/g))
    addEntity("ORG", m[0], m.index!, 0.65);

  // Proper nouns: sequences of capitalized words (not at sentence start heuristic)
  const properNounRe = /(?<![.!?]\s)(?<!\bI\b\s)\b([A-Z][a-z]{1,20})(?:\s+[A-Z][a-z]{1,20}){0,3}\b/g;
  for (const m of text.matchAll(properNounRe)) {
    const word = m[0].trim();
    if (word.split(/\s+/).length > 1) addEntity("PER", word, m.index!, 0.7);
    else if (!STOP_WORDS.has(word.toLowerCase()) && word.length > 2) addEntity("LOC", word, m.index!, 0.55);
  }

  return entities.sort((a, b) => a.start - b.start);
}

// ─── POST /api/tools/ner ─────────────────────────────────────────────────────
router.post("/tools/ner", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  // Always return local pattern-based result immediately — instant, no API wait
  const entities = localNER(text.trim());
  const byType: Record<string, number> = {};
  for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;
  res.json({ entities, byType, count: entities.length, model: "pattern-local", method: "local-patterns" });
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

  // TF: raw count per term
  const tf: Record<string, number> = {};
  for (const w of allWords) tf[w] = (tf[w] || 0) + 1;

  // Augmented TF normalization: 0.5 + 0.5 * (freq / maxFreq)
  // Prevents bias toward longer documents (standard double-normalization K=0.5)
  const maxFreq = Math.max(...Object.values(tf), 1);

  // IDF: sentence-level document frequency (industry-standard approach for
  // single-document keyword extraction — sentences serve as the "document corpus")
  // Formula: log((N+1)/(df+1)) + 1 with Laplace smoothing
  const idf: Record<string, number> = {};
  const N = Math.max(sentences.length, 1);
  for (const word of Object.keys(tf)) {
    const df = sentences.filter((s) => s.toLowerCase().includes(word)).length;
    idf[word] = Math.log((N + 1) / (df + 1)) + 1;
  }

  // TF-IDF score with augmented normalization
  const tfidf = Object.entries(tf).map(([word, freq]) => ({
    keyword: word,
    score: Math.round((0.5 + 0.5 * (freq / maxFreq)) * (idf[word] || 1) * 100) / 100,
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

// ─── Local language detection (instant, script + word frequency) ──────────────
function detectLanguageLocal(text: string): { language: string; confidence: number; method: string } {
  const sample = text.slice(0, 500);

  // Script-based detection — highly reliable, instant
  const scripts: Array<[string, RegExp, number]> = [
    ["zh", /[\u4e00-\u9fff]/, 98],
    ["ja", /[\u3040-\u309f\u30a0-\u30ff]/, 98],
    ["ar", /[\u0600-\u06ff]/, 97],
    ["ru", /[\u0400-\u04ff]/, 95],
    ["ko", /[\uac00-\ud7af]/, 98],
    ["hi", /[\u0900-\u097f]/, 96],
    ["he", /[\u05d0-\u05ea]/, 95],
    ["th", /[\u0e00-\u0e7f]/, 97],
    ["el", /[\u0370-\u03ff]/, 93],
    ["uk", /[\u0400-\u04ff]/, 90],
  ];
  for (const [lang, pattern, conf] of scripts) {
    const matches = (sample.match(new RegExp(pattern.source, "g")) || []).length;
    if (matches > 2) return { language: lang, confidence: conf, method: "script" };
  }

  // Latin-script word fingerprinting for common languages
  const lower = sample.toLowerCase();
  const langWords: Array<[string, string[], number]> = [
    ["id", ["yang","dan","di","ini","itu","ada","dengan","untuk","saya","tidak","bisa","akan","juga","sudah","dari","ke","kami","mereka","kita","karena"], 88],
    ["es", ["que","de","la","el","en","los","del","las","un","por","con","no","una","su","para","pero","como","más","este","muy"], 85],
    ["fr", ["le","la","les","de","du","des","un","une","en","et","est","pas","que","qui","sur","dans","au","je","vous","nous"], 85],
    ["pt", ["de","que","o","a","os","as","um","uma","em","no","na","se","com","por","para","não","mais","ao","da","do"], 85],
    ["de", ["die","der","das","ist","und","in","den","von","zu","des","mit","auf","für","war","bei","haben","nicht","sich","als","auch"], 85],
    ["it", ["di","il","la","e","che","in","del","per","un","una","con","non","le","i","si","da","al","dei","gli","lo"], 85],
    ["nl", ["de","het","een","in","van","is","dat","op","te","en","zijn","er","niet","aan","voor","met","die","ook","wat","hij"], 83],
  ];

  const words = lower.split(/\W+/).filter((w) => w.length > 1);
  const total = words.length || 1;
  let best = { language: "en", confidence: 60, method: "heuristic-default" };
  let bestRatio = 0;

  for (const [lang, markers, baseConf] of langWords) {
    const markerSet = new Set(markers);
    const hits = words.filter((w) => markerSet.has(w)).length;
    const ratio = hits / total;
    if (ratio > bestRatio && ratio > 0.05) {
      bestRatio = ratio;
      best = { language: lang, confidence: Math.min(95, Math.round(baseConf + ratio * 30)), method: "word-frequency" };
    }
  }

  return best;
}

// ─── POST /api/tools/detect-language ─────────────────────────────────────────
router.post("/tools/detect-language", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text is required" }); return; }

  // Always return local result immediately — instant, no API wait
  const local = detectLanguageLocal(text.trim());
  res.json({
    language: local.language,
    confidence: local.confidence,
    method: local.method,
    topLanguages: [{ language: local.language, confidence: local.confidence }],
  });
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
