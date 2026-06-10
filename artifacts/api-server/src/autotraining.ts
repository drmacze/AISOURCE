/**
 * DLavie OS — Auto-Training Engine v2 (24/7 Live Learning)
 *
 * Continuously fetches fresh data from 12+ REAL external sources:
 *  1.  Wikipedia (EN, ID, AR, FR, ES)  — encyclopedic knowledge, multilingual
 *  2.  HackerNews API                  — real-time tech news (no auth)
 *  3.  Reddit JSON API                 — r/MachineLearning, r/LocalLLaMA, etc.
 *  4.  arXiv API                       — latest research papers
 *  5.  RSS Feeds                       — tech blogs + international news
 *  6.  HuggingFace Datasets            — curated instruction datasets (HF_TOKEN)
 *  7.  Curated AI Knowledge            — high-quality expert Q&A
 *  8.  GitHub Trending                 — top repos + READMEs (GITHUB_TOKEN)
 *  9.  GitHub Datasets                 — real JSONL/CSV training files from repos
 * 10.  GitHub Issues                   — Q&A pairs from popular AI repos
 * 11.  DEV.to API                      — developer tutorials + articles
 * 12.  OpenAssistant / ShareGPT        — real conversation datasets via HF
 *
 * Quality Pipeline:
 *  - MD5 deduplication (no duplicate inputs)
 *  - Length filtering (min 30 input, min 20 output)
 *  - Score-based ranking per source
 *  - Language-tagged metadata
 *
 * Schedule:
 *  - Full cycle: every 3 hours (configurable via AUTO_TRAIN_INTERVAL_MS)
 *  - Micro cycle: 1 Wikipedia sample per minute
 *  - GitHub datasets: dedicated cycle every 6 hours
 */

import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  trainingDatasetsTable,
  trainingSamplesTable,
  trainingJobsTable,
  aiModelsTable,
} from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { fetchWikipediaArticle, fetchHFDataset, isHFConfigured } from "./huggingface";
import {
  fetchTrendingWithREADME,
  fetchDatasetFromRepo,
  fetchGitHubIssueQA,
  fetchGitHubCodeExamples,
  checkGitHubRateLimit,
  searchDatasetRepos,
  getNextDatasetQuery,
  getIssueRepo,
  isGitHubConfigured,
  hashText,
  type TrainingSample,
} from "./github-datasets";

// ─── State ────────────────────────────────────────────────────────────────────
let autoTrainingRunning  = false;
let autoTrainingTimer: ReturnType<typeof setInterval> | null = null;
let githubDatasetTimer: ReturnType<typeof setInterval> | null = null;
let totalCyclesCompleted = 0;
let totalSamplesAdded    = 0;
let lastCycleAt: Date | null    = null;
let nextCycleAt: Date | null    = null;
let currentCycleLog: string[]   = [];
const seenHashes = new Set<string>(); // in-memory dedup cache

// ─── SSE event bus ────────────────────────────────────────────────────────────
export type TrainingEvent =
  | { type: "cycle_complete"; cycleNumber: number; samplesAdded: number; totalSamples: number; breakdown: Record<string, number>; at: string }
  | { type: "cycle_start"; cycleNumber: number; at: string }
  | { type: "cycle_error"; cycleNumber: number; error: string; at: string }
  | { type: "heartbeat"; at: string };

type SSEClient = { id: number; send: (event: TrainingEvent) => void; close: () => void };
let nextClientId = 1;
const sseClients = new Map<number, SSEClient>();

export function registerSSEClient(client: SSEClient): number {
  sseClients.set(client.id, client);
  return client.id;
}

export function unregisterSSEClient(id: number) {
  sseClients.delete(id);
}

function broadcastEvent(event: TrainingEvent) {
  for (const client of sseClients.values()) {
    try { client.send(event); } catch { sseClients.delete(client.id); }
  }
}

export function allocateClientId() { return nextClientId++; }

const activityLog: Array<{ at: Date; msg: string; type: "info" | "success" | "error" }> = [];
let sourceStats: Record<string, number> = {
  wikipedia: 0, hackernews: 0, reddit: 0, arxiv: 0, rss: 0,
  huggingface: 0, curated: 0, github: 0, "github-datasets": 0,
  "github-issues": 0, devto: 0, openassistant: 0,
};

// ─── Knowledge domains ────────────────────────────────────────────────────────
const WIKIPEDIA_TOPICS_EN = [
  "Artificial intelligence", "Machine learning", "Deep learning", "Neural network",
  "Natural language processing", "Computer vision", "Reinforcement learning",
  "Large language model", "Transformer (machine learning model)", "Attention (machine learning)",
  "Python (programming language)", "TypeScript", "JavaScript", "REST API",
  "Database", "PostgreSQL", "Docker (software)", "Kubernetes",
  "Climate change", "Quantum computing", "Blockchain", "Internet of things",
  "Cybersecurity", "Data science", "Cloud computing", "Robotics",
  "Mathematics", "Physics", "Biology", "Chemistry", "Astronomy",
  "Ollama (software)", "Hugging Face", "OpenAI", "GPT-4", "BERT",
  "Reinforcement learning from human feedback", "Fine-tuning (machine learning)",
  "Vector database", "Embedding (machine learning)", "Diffusion model",
  "Convolutional neural network", "Recurrent neural network", "LSTM",
  "Graph neural network", "Federated learning", "Transfer learning",
  "Zero-shot learning", "Few-shot learning", "Prompt engineering",
];

const WIKIPEDIA_TOPICS_MULTILINGUAL: Array<{ lang: string; code: string; topics: string[] }> = [
  {
    lang: "Indonesian",
    code: "id",
    topics: [
      "Kecerdasan buatan", "Pembelajaran mesin", "Jaringan saraf tiruan",
      "Pemrosesan bahasa alami", "Komputasi awan", "Keamanan siber",
      "Teknologi informasi", "Internet", "Robot", "Data science",
    ],
  },
  {
    lang: "Arabic",
    code: "ar",
    topics: [
      "الذكاء_الاصطناعي", "تعلم_الآلة", "الشبكات_العصبية_الاصطناعية",
      "معالجة_اللغات_الطبيعية", "الحوسبة_السحابية", "علم_البيانات",
    ],
  },
  {
    lang: "French",
    code: "fr",
    topics: [
      "Intelligence artificielle", "Apprentissage automatique", "Réseau de neurones artificiels",
      "Traitement automatique du langage naturel", "Science des données",
    ],
  },
  {
    lang: "Spanish",
    code: "es",
    topics: [
      "Inteligencia artificial", "Aprendizaje automático", "Red neuronal artificial",
      "Procesamiento del lenguaje natural", "Ciencia de datos",
    ],
  },
];

const QA_TEMPLATES = [
  (t: string, x: string) => ({ input: `What is ${t}?`, output: x.slice(0, 400) }),
  (t: string, x: string) => ({ input: `Explain ${t} in simple terms.`, output: x.slice(0, 350) }),
  (t: string, x: string) => ({ input: `Give me a brief overview of ${t}.`, output: x.slice(0, 400) }),
  (t: string, x: string) => ({ input: `What are the key concepts of ${t}?`, output: x.slice(0, 400) }),
  (t: string, x: string) => ({ input: `How does ${t} work?`, output: x.slice(0, 350) }),
  (t: string, x: string) => ({ input: `Why is ${t} important?`, output: x.slice(0, 300) }),
  (t: string, x: string) => ({ input: `Summarize what you know about ${t}.`, output: x.slice(0, 400) }),
];

const QA_TEMPLATES_ID = [
  (t: string, x: string) => ({ input: `Apa itu ${t}?`, output: x.slice(0, 400) }),
  (t: string, x: string) => ({ input: `Jelaskan ${t} secara sederhana.`, output: x.slice(0, 350) }),
  (t: string, x: string) => ({ input: `Bagaimana cara kerja ${t}?`, output: x.slice(0, 350) }),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg: string, type: "info" | "success" | "error" = "info") {
  const entry = { at: new Date(), msg, type };
  activityLog.unshift(entry);
  if (activityLog.length > 500) activityLog.pop();
  currentCycleLog.push(`[${entry.at.toISOString().slice(11, 19)}] ${msg}`);
  console.log(`[AutoTraining] ${msg}`);
}

function isDuplicate(input: string): boolean {
  const h = hashText(input);
  if (seenHashes.has(h)) return true;
  seenHashes.add(h);
  return false;
}

function qualityOk(input: string, output: string): boolean {
  return input.trim().length >= 30 && output.trim().length >= 20;
}

async function getLiveDataset(): Promise<{ id: number; name: string }> {
  const rows = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt));
  const existing = rows.find((r: { name: string }) => r.name === "Live Learning Dataset v2");
  if (existing) return existing;
  const [ds] = await db.insert(trainingDatasetsTable).values({
    name: "Live Learning Dataset v2",
    description: "Auto-updated 24/7: Wikipedia (5 languages), HackerNews, Reddit, arXiv, RSS, HuggingFace, GitHub datasets, GitHub issues, DEV.to, OpenAssistant",
    taskType: "qa",
    sampleCount: 0,
  }).returning();
  log("Created Live Learning Dataset v2", "success");
  return ds;
}

async function upsertSamples(
  dataset: { id: number },
  samples: Array<{ input: string; output: string; metadata?: string }>,
  source: string
): Promise<number> {
  let added = 0;
  for (const s of samples) {
    if (!qualityOk(s.input, s.output)) continue;
    if (isDuplicate(s.input)) continue;
    try {
      await db.insert(trainingSamplesTable).values({
        datasetId: dataset.id,
        input: s.input.trim(),
        output: s.output.trim(),
        metadata: s.metadata || JSON.stringify({ source }),
        source,
      });
      added++;
    } catch { /* ignore duplicate key errors */ }
  }
  return added;
}

async function updateSampleCount(datasetId: number): Promise<number> {
  const [row] = await db.select({ c: count() }).from(trainingSamplesTable)
    .where(eq(trainingSamplesTable.datasetId, datasetId));
  const cnt = row?.c ?? 0;
  await db.update(trainingDatasetsTable)
    .set({ sampleCount: cnt, updatedAt: new Date() })
    .where(eq(trainingDatasetsTable.id, datasetId));
  return cnt;
}

// ─── Source 1: Wikipedia (multilingual) ──────────────────────────────────────
async function fetchWikipediaEN(dataset: { id: number }): Promise<number> {
  const topicBatch = [...WIKIPEDIA_TOPICS_EN].sort(() => Math.random() - 0.5).slice(0, 5);
  let added = 0;
  for (const topic of topicBatch) {
    try {
      const article = await fetchWikipediaArticle(topic);
      if (!article?.extract || article.extract.length < 100) continue;
      const templates = QA_TEMPLATES.sort(() => Math.random() - 0.5).slice(0, 3);
      const samples = templates.map((fn) => fn(topic, article.extract));
      added += await upsertSamples(dataset, samples.map((s) => ({
        input: s.input,
        output: s.output.trim(),
        metadata: JSON.stringify({ source: "wikipedia-en", topic, lang: "en" }),
      })), "wikipedia-en");
      log(`Wikipedia EN: "${topic}" → ${samples.length} samples`, "success");
    } catch (err) {
      log(`Wikipedia EN error for "${topic}": ${String(err)}`, "error");
    }
  }
  sourceStats.wikipedia = (sourceStats.wikipedia || 0) + added;
  return added;
}

async function fetchWikipediaMultilingual(dataset: { id: number }): Promise<number> {
  let added = 0;
  // Pick 1-2 languages per cycle
  const langs = [...WIKIPEDIA_TOPICS_MULTILINGUAL].sort(() => Math.random() - 0.5).slice(0, 2);

  for (const langConfig of langs) {
    const topic = langConfig.topics[Math.floor(Math.random() * langConfig.topics.length)];
    try {
      const encoded = encodeURIComponent(topic.replace(/ /g, "_"));
      const url = `https://${langConfig.code}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "DLavieOS-AutoTraining/2.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as { extract?: string; title?: string };
      if (!data.extract || data.extract.length < 80) continue;

      const extract = data.extract.slice(0, 600);
      const templates = langConfig.code === "id" ? QA_TEMPLATES_ID : QA_TEMPLATES;
      const tmpl = templates[Math.floor(Math.random() * templates.length)];
      const sample = tmpl(topic, extract);

      const n = await upsertSamples(dataset, [{
        input: sample.input,
        output: sample.output.trim(),
        metadata: JSON.stringify({ source: `wikipedia-${langConfig.code}`, topic, lang: langConfig.code }),
      }], `wikipedia-${langConfig.code}`);
      added += n;
      if (n > 0) log(`Wikipedia ${langConfig.lang}: "${topic}" → ${n} sample`, "success");
    } catch (err) {
      log(`Wikipedia ${langConfig.lang} error for "${topic}": ${String(err)}`, "error");
    }
  }
  sourceStats.wikipedia = (sourceStats.wikipedia || 0) + added;
  return added;
}

// ─── Source 2: HackerNews ─────────────────────────────────────────────────────
async function fetchHackerNewsData(dataset: { id: number }): Promise<number> {
  let added = 0;
  try {
    const topStoriesRes = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=30&orderBy=%22$key%22",
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!topStoriesRes.ok) return 0;
    const ids = await topStoriesRes.json() as number[];

    for (const id of ids.slice(0, 10)) {
      try {
        const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { signal: AbortSignal.timeout(8_000) });
        if (!itemRes.ok) continue;
        const item = await itemRes.json() as {
          title?: string; text?: string; url?: string; score?: number; type?: string;
        };
        if (!item.title || item.type !== "story") continue;

        const content = item.text
          ? item.text.replace(/<[^>]+>/g, "").slice(0, 500)
          : `A tech discussion about: ${item.title}`;

        const samples = [
          { input: `What is the HackerNews discussion about: "${item.title}"?`, output: content },
          { input: `Summarize this tech news: "${item.title}"`, output: content.slice(0, 400) },
        ];

        added += await upsertSamples(dataset, samples.map((s) => ({
          ...s,
          metadata: JSON.stringify({ source: "hackernews", hnId: id, score: item.score }),
        })), "hackernews");
      } catch { /* skip */ }
    }
    if (added > 0) log(`HackerNews: ${added} samples from top stories`, "success");
  } catch (err) {
    log(`HackerNews error: ${String(err)}`, "error");
  }
  sourceStats.hackernews = (sourceStats.hackernews || 0) + added;
  return added;
}

// ─── Source 3: Reddit ─────────────────────────────────────────────────────────
const REDDIT_SUBREDDITS = [
  "MachineLearning", "LocalLLaMA", "artificial", "datascience",
  "programming", "technology", "ArtificialIntelligence", "learnprogramming",
  "singularity", "ChatGPT", "AIToolkit",
];

async function fetchRedditData(dataset: { id: number }): Promise<number> {
  let added = 0;
  const sub = REDDIT_SUBREDDITS[Math.floor(Math.random() * REDDIT_SUBREDDITS.length)];
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=10`, {
      headers: { "User-Agent": "DLavieOS-AutoTraining/2.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return 0;
    const data = await res.json() as {
      data?: { children?: Array<{ data: { title: string; selftext: string; score: number; url: string } }> }
    };
    const posts = data?.data?.children || [];

    for (const post of posts.slice(0, 8)) {
      const { title, selftext, score } = post.data;
      if (!title || score < 10) continue;
      const text = selftext && selftext.length > 30
        ? selftext.slice(0, 500).replace(/\n+/g, " ")
        : `Discussion about: ${title}`;

      added += await upsertSamples(dataset, [
        { input: `What is this Reddit post about? r/${sub}: "${title}"`, output: text.slice(0, 450) },
        { input: `Summarize this tech discussion: "${title}"`, output: text.slice(0, 400) },
      ].map((s) => ({ ...s, metadata: JSON.stringify({ source: "reddit", subreddit: sub, score }) })), "reddit");
    }
    if (added > 0) log(`Reddit r/${sub}: ${added} samples`, "success");
  } catch (err) {
    log(`Reddit error (r/${sub}): ${String(err)}`, "error");
  }
  sourceStats.reddit = (sourceStats.reddit || 0) + added;
  return added;
}

// ─── Source 4: arXiv ─────────────────────────────────────────────────────────
const ARXIV_SEARCHES = [
  "large language models", "machine learning transformers",
  "reinforcement learning AI", "computer vision deep learning",
  "natural language processing", "multi-modal AI",
  "diffusion models generative", "retrieval augmented generation",
  "AI safety alignment", "efficient transformers attention",
  "instruction tuning LLM", "chain of thought reasoning",
  "federated learning privacy", "neural architecture search",
];

async function fetchArxivData(dataset: { id: number }): Promise<number> {
  const q = ARXIV_SEARCHES[Math.floor(Math.random() * ARXIV_SEARCHES.length)];
  let added = 0;
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return 0;
    const xml = await r.text();
    const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

    for (const entry of entries.slice(0, 6)) {
      const titleMatch   = entry.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      if (!titleMatch || !summaryMatch) continue;
      const title   = titleMatch[1].replace(/\s+/g, " ").trim();
      const summary = summaryMatch[1].replace(/\s+/g, " ").trim();

      added += await upsertSamples(dataset, [
        { input: `Summarize the research paper: "${title}"`, output: summary.slice(0, 700) },
        { input: `What does the paper "${title}" propose or discover?`, output: summary.slice(0, 600) },
      ].map((s) => ({ ...s, metadata: JSON.stringify({ source: "arxiv", query: q }) })), "arxiv");
    }
    if (added > 0) log(`arXiv: "${q}" → ${added} paper samples`, "success");
  } catch (err) {
    log(`arXiv error: ${String(err)}`, "error");
  }
  sourceStats.arxiv = (sourceStats.arxiv || 0) + added;
  return added;
}

// ─── Source 5: RSS Feeds (expanded, multilingual) ────────────────────────────
const RSS_FEEDS = [
  // English AI/Tech
  { name: "MIT News AI",         url: "https://news.mit.edu/rss/topic/artificial-intelligence2",          lang: "en" },
  { name: "Ars Technica AI",     url: "https://feeds.arstechnica.com/arstechnica/technology-lab",         lang: "en" },
  { name: "VentureBeat AI",      url: "https://venturebeat.com/ai/feed/",                                 lang: "en" },
  { name: "The Verge AI",        url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",lang: "en" },
  { name: "TechCrunch AI",       url: "https://techcrunch.com/category/artificial-intelligence/feed/",    lang: "en" },
  // International News
  { name: "BBC Technology",      url: "https://feeds.bbci.co.uk/news/technology/rss.xml",                 lang: "en" },
  { name: "Reuters Tech",        url: "https://feeds.reuters.com/reuters/technologyNews",                  lang: "en" },
  // Indonesian
  { name: "Kompas Teknologi",    url: "https://rss.kompas.com/rss/techno/read",                           lang: "id" },
  { name: "Detik Inet",          url: "https://rss.detik.com/index.php/inet",                             lang: "id" },
];

function parseRSSItems(xml: string): Array<{ title: string; description: string }> {
  const items: Array<{ title: string; description: string }> = [];
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of itemMatches.slice(0, 6)) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch  = item.match(/<description>([\s\S]*?)<\/description>/);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    const desc  = descMatch
      ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim().slice(0, 500)
      : "";
    if (title && title.length > 10) items.push({ title, description: desc });
  }
  return items;
}

async function fetchRSSData(dataset: { id: number }): Promise<number> {
  let added = 0;
  // Pick 2 random feeds per cycle
  const feeds = [...RSS_FEEDS].sort(() => Math.random() - 0.5).slice(0, 2);

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { "Accept": "application/rss+xml, text/xml, */*", "User-Agent": "DLavieOS-AutoTraining/2.0" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRSSItems(xml);

      const isID = feed.lang === "id";
      const samples = items.flatMap((item) => {
        const content = item.description || `Article about: ${item.title}`;
        if (isID) {
          return [
            { input: `Rangkum berita teknologi ini: "${item.title}"`, output: content },
            { input: `Apa yang dibahas dalam artikel "${item.title}"?`, output: content },
          ];
        }
        return [
          { input: `Summarize this tech news: "${item.title}"`, output: content },
          { input: `What is this article about? "${item.title}"`, output: content },
        ];
      });

      const n = await upsertSamples(dataset, samples.map((s) => ({
        ...s, metadata: JSON.stringify({ source: "rss", feed: feed.name, lang: feed.lang }),
      })), "rss");
      added += n;
      if (n > 0) log(`RSS [${feed.name}]: ${n} samples`, "success");
    } catch (err) {
      log(`RSS error [${feed.name}]: ${String(err)}`, "error");
    }
  }
  sourceStats.rss = (sourceStats.rss || 0) + added;
  return added;
}

// ─── Source 6: HuggingFace Datasets ──────────────────────────────────────────
const HF_DATASETS = [
  { ds: "tatsu-lab/alpaca",                   inputKey: "instruction", outputKey: "output" },
  { ds: "databricks/databricks-dolly-15k",    inputKey: "instruction", outputKey: "response" },
  { ds: "HuggingFaceH4/instruction-dataset",  inputKey: "prompt",      outputKey: "completion" },
  { ds: "OpenAssistant/oasst2",               inputKey: "text",        outputKey: "text" },
  { ds: "vicgalle/alpaca-gpt4",               inputKey: "instruction", outputKey: "output" },
  { ds: "teknium/GPT4-LLM-Cleaned",           inputKey: "instruction", outputKey: "output" },
];

async function fetchHFData(dataset: { id: number }): Promise<number> {
  if (!isHFConfigured()) return 0;
  let added = 0;
  const chosen = HF_DATASETS[Math.floor(Math.random() * HF_DATASETS.length)];

  try {
    log(`Fetching HuggingFace dataset: ${chosen.ds}`);
    const rows = await fetchHFDataset(chosen.ds, "train", 30);

    // Special handling for oasst2 (conversation format)
    if (chosen.ds.includes("oasst")) {
      const userRows = rows.filter((r: Record<string, unknown>) => r["role"] === "prompter" && r["text"]);
      const assistRows = rows.filter((r: Record<string, unknown>) => r["role"] === "assistant" && r["text"]);
      const pairs = userRows.slice(0, 10).map((u: Record<string, unknown>, i: number) => ({
        datasetId: dataset.id,
        input: String(u["text"]).slice(0, 500),
        output: String(assistRows[i]?.["text"] || "").slice(0, 700),
        metadata: JSON.stringify({ source: "huggingface-oasst", dataset: chosen.ds }),
      })).filter((p: { input: string; output: string }) => p.input.length > 20 && p.output.length > 20);

      if (pairs.length > 0) {
        added += await upsertSamples(dataset, pairs, "openassistant");
        sourceStats.openassistant = (sourceStats.openassistant || 0) + added;
        log(`HuggingFace OpenAssistant: ${added} conversation pairs`, "success");
        return added;
      }
    }

    const samples = rows
      .filter((r: Record<string, unknown>) => r[chosen.inputKey] && r[chosen.outputKey])
      .slice(0, 15)
      .map((r: Record<string, unknown>) => ({
        input: String(r[chosen.inputKey]).slice(0, 600),
        output: String(r[chosen.outputKey]).slice(0, 800),
        metadata: JSON.stringify({ source: "huggingface", dataset: chosen.ds }),
      }));

    added += await upsertSamples(dataset, samples, "huggingface");
    if (added > 0) log(`HuggingFace: ${chosen.ds} → ${added} samples`, "success");
  } catch (err) {
    log(`HuggingFace error (${chosen.ds}): ${String(err)}`, "error");
  }
  sourceStats.huggingface = (sourceStats.huggingface || 0) + added;
  return added;
}

// ─── Source 7: Curated AI Knowledge (expanded) ───────────────────────────────
const CURATED_QA = [
  { input: "What is the difference between supervised and unsupervised learning?", output: "Supervised learning uses labeled data (input-output pairs) to train models, while unsupervised learning finds patterns in unlabeled data. Examples: supervised = image classification, spam detection; unsupervised = clustering, anomaly detection, dimensionality reduction." },
  { input: "How do transformers work in NLP?", output: "Transformers use self-attention mechanisms to process sequences in parallel. They consist of encoder-decoder blocks with multi-head attention, allowing the model to focus on different parts of the input simultaneously. This enables models like BERT and GPT to achieve state-of-the-art NLP performance with 1000x fewer training steps than RNNs." },
  { input: "What is gradient descent?", output: "Gradient descent is an optimization algorithm that minimizes a loss function by iteratively moving in the direction of steepest descent (negative gradient). Key variants: SGD (stochastic), Mini-batch GD, Adam (adaptive moment estimation), RMSprop. Learning rate is the hyperparameter controlling step size." },
  { input: "Explain RAG (Retrieval-Augmented Generation) in AI systems.", output: "RAG combines information retrieval with generative AI. The pipeline: 1) Embed documents into vectors, store in vector DB. 2) At query time, retrieve top-K similar documents. 3) Inject retrieved context into LLM prompt. 4) LLM generates grounded response. Benefits: reduces hallucinations, enables real-time knowledge updates without retraining." },
  { input: "What are embeddings in machine learning?", output: "Embeddings are dense vector representations of data (text, images, audio) in continuous vector space. Similar items cluster together. They capture semantic relationships — 'king' - 'man' + 'woman' ≈ 'queen'. Modern embedding models: text-embedding-ada-002, nomic-embed-text, all-MiniLM-L6-v2. Dimensions: typically 384, 768, or 1536." },
  { input: "What is fine-tuning vs pre-training?", output: "Pre-training: training a model from scratch on massive general datasets (GPT-4 trained on trillions of tokens). Fine-tuning: further training a pre-trained model on smaller, task-specific labeled data. Benefits of fine-tuning: 100-1000x less data needed, faster convergence, retains general knowledge. Common techniques: full fine-tuning, LoRA, QLoRA, PEFT." },
  { input: "How does temperature affect LLM outputs?", output: "Temperature is a softmax scaling parameter. Low (0.1-0.3): deterministic, repetitive, factual. Medium (0.5-0.8): balanced creativity and coherence. High (1.0+): diverse, creative, sometimes incoherent. Top-p (nucleus sampling) and top-k also control diversity. For code generation, use low temperature (0.1-0.2). For creative writing, use 0.7-1.0." },
  { input: "What is RLHF?", output: "Reinforcement Learning from Human Feedback (RLHF) aligns LLMs with human preferences. Steps: 1) Supervised fine-tuning on demonstration data. 2) Collect human preference comparisons (which response is better?). 3) Train reward model on preferences. 4) Use PPO (Proximal Policy Optimization) to fine-tune LLM to maximize reward. Used in: ChatGPT, Claude, Gemini, Llama-2-chat." },
  { input: "What is quantization in LLMs?", output: "Quantization reduces model precision from float32 (4 bytes) to lower precision: float16 (2B), int8 (1B), int4 (0.5B). Benefits: ~4x smaller file, faster inference, less RAM. GGUF format (Ollama) uses Q4_K_M (4-bit), reducing 7B params from ~28GB to ~4GB. Quality trade-off is minimal at Q4 (perplexity increase < 5%). Quantization methods: GPTQ, AWQ, GGUF." },
  { input: "Explain vector databases and why they matter for AI.", output: "Vector databases store and efficiently search high-dimensional vectors. When querying, convert query to vector embedding, then find nearest neighbors using HNSW (Hierarchical Navigable Small World) or IVF (Inverted File Index) algorithms. ANN search in <10ms across billions of vectors. Use cases: RAG, semantic search, recommendations, deduplication. Examples: Pinecone, Chroma, Qdrant, Weaviate, pgvector." },
  { input: "What is Mixture of Experts (MoE)?", output: "MoE is a neural network architecture where a router network selects K of N expert sub-networks for each token. Mixtral 8x7B: 8 experts, top-2 routing = 13B active params from 46B total. Benefits: massive model capacity at fraction of compute cost. Kimi K2 uses MoE with 1T total params but only 32B active per token. MoE challenges: load balancing, communication overhead in distributed settings." },
  { input: "What is DPO (Direct Preference Optimization)?", output: "DPO is an alternative to RLHF that directly fine-tunes the LLM without training a separate reward model. It uses a contrastive loss on (preferred, rejected) pairs. Benefits: simpler, more stable than PPO, no reward model needed. Math: maximize log P(preferred) - log P(rejected) relative to reference model. Used in: Llama-3, Mistral-v0.3, and most modern open-source models." },
  { input: "Explain attention mechanism in transformers.", output: "Attention computes weighted sums over value vectors, where weights are softmax(Q·K^T / sqrt(d_k)). Q=query, K=key, V=value matrices. Multi-head attention runs H parallel attention heads on lower-dimensional projections, capturing different relationship types. Self-attention allows every token to attend to every other token. Complexity: O(n²) for sequence length n, which limits context length. Solutions: Flash Attention, Sliding Window, ALiBi." },
  { input: "What is LoRA fine-tuning?", output: "LoRA (Low-Rank Adaptation) freezes pre-trained model weights and injects trainable rank decomposition matrices A and B into attention layers: ΔW = BA where B∈R(d×r), A∈R(r×k), r<<d. Reduces trainable params by 10,000x. Example: 7B model full fine-tune = 14GB; LoRA r=8 = ~1-2MB adapter. QLoRA extends this with 4-bit quantization. Can train 13B model on single consumer GPU." },
  { input: "What is Flash Attention?", output: "Flash Attention is an I/O-aware exact attention algorithm that computes attention in tiles, keeping intermediate results in SRAM (fast) instead of HBM (slow). Benefits: 2-4x faster attention, 5-20x less memory than standard attention, no approximation (exact same output). Enables training on longer sequences (32K+ tokens). Flash Attention 2 and 3 improve further with better GPU utilization." },
  { input: "Apa itu AI generatif dan bagaimana cara kerjanya?", output: "AI generatif adalah sistem AI yang dapat membuat konten baru seperti teks, gambar, musik, dan kode. Cara kerja: model dilatih pada data besar untuk mempelajari pola distribusi data. Saat inferensi, model mengambil sampel dari distribusi untuk menghasilkan output baru. Contoh: GPT-4 untuk teks, DALL-E untuk gambar, Suno untuk musik. Teknologi utama: Transformer, Diffusion Models, GANs." },
  { input: "How to implement RAG with Ollama and Python?", output: "1) Install: pip install ollama chromadb. 2) Embed documents: chromadb_client.add(documents=docs, embeddings=ollama.embeddings(model='nomic-embed-text', prompt=doc)). 3) Query: results = collection.query(query_embeddings=embed(question), n_results=5). 4) Generate: ollama.chat(model='llama3.2', messages=[{'role':'user','content':f'Context: {results}\\nQuestion: {question}'}]). Full pipeline under 50 lines of code." },
  { input: "What are the main differences between Llama, Mistral, and Qwen models?", output: "Llama (Meta): Strong English, multilingual (Llama 3.2), 128K context, open weights. Best for: general tasks, English-heavy applications. Mistral (MistralAI): Efficient architecture, sliding window attention, strong code + reasoning. Best for: European languages, function calling. Qwen (Alibaba): Strongest Chinese + Asian languages support, 32K context, instruction-following. Best for: multilingual apps, Chinese content." },
  { input: "What is the context window size and why does it matter?", output: "Context window is the maximum number of tokens an LLM can process at once. Tokens ≈ 0.75 words. Implications: longer context = can analyze larger documents, maintain longer conversations, better in-context learning. Modern sizes: Llama 3.2 = 128K, Gemma 3 = 128K, Qwen 2.5 = 32K. Challenges: O(n²) attention complexity, KV cache memory. Solutions: Flash Attention, RoPE scaling, sparse attention." },
];

async function generateAISamples(dataset: { id: number }): Promise<number> {
  const sample = [...CURATED_QA].sort(() => Math.random() - 0.5).slice(0, 5);
  const added = await upsertSamples(dataset, sample.map((s) => ({
    input: s.input,
    output: s.output,
    metadata: JSON.stringify({ source: "curated-ai-knowledge", quality: "expert" }),
  })), "curated");
  sourceStats.curated = (sourceStats.curated || 0) + added;
  return added;
}

// ─── Source 8: GitHub Trending (enhanced) ────────────────────────────────────
const GITHUB_TRENDING_QUERIES = [
  "topic:machine-learning stars:>500",
  "topic:llm stars:>200",
  "topic:artificial-intelligence stars:>300",
  "topic:deep-learning stars:>400",
  "topic:nlp stars:>200",
  "topic:rag stars:>100",
  "topic:ollama stars:>50",
  "topic:fine-tuning stars:>100",
  "topic:pytorch stars:>500",
  "topic:transformers stars:>300",
  "topic:langchain stars:>200",
  "topic:vector-database stars:>100",
];

async function fetchGitHubTrending(dataset: { id: number }): Promise<number> {
  let added = 0;
  const query = GITHUB_TRENDING_QUERIES[Math.floor(Math.random() * GITHUB_TRENDING_QUERIES.length)];

  try {
    const samples = await fetchTrendingWithREADME(query, 5);
    added += await upsertSamples(dataset, samples.map((s: TrainingSample) => ({
      input: s.input,
      output: s.output,
      metadata: JSON.stringify({ source: s.source, ...(s.metadata || {}) }),
    })), "github");
    if (added > 0) log(`GitHub trending: "${query}" → ${added} samples`, "success");
  } catch (err) {
    log(`GitHub trending error: ${String(err)}`, "error");
  }
  sourceStats.github = (sourceStats.github || 0) + added;
  return added;
}

// ─── Source 9: GitHub Real Datasets ──────────────────────────────────────────
async function fetchGitHubDatasets(dataset: { id: number }): Promise<number> {
  let added = 0;
  const query = getNextDatasetQuery();

  try {
    log(`GitHub datasets: searching "${query}"`);
    const repos = await searchDatasetRepos(query, 3);

    for (const repo of repos) {
      try {
        const samples = await fetchDatasetFromRepo(repo.owner.login, repo.name);
        if (samples.length === 0) continue;

        added += await upsertSamples(dataset, samples.map((s: TrainingSample) => ({
          input: s.input,
          output: s.output,
          metadata: JSON.stringify({
            source: "github-dataset",
            repo: repo.full_name,
            stars: repo.stargazers_count,
          }),
        })), "github-datasets");

        log(`GitHub dataset "${repo.full_name}": ${Math.min(samples.length, 30)} samples`, "success");
        await new Promise((r) => setTimeout(r, 500));
      } catch { /* skip */ }
    }

    if (added > 0) log(`GitHub datasets total: ${added} real training samples`, "success");
  } catch (err) {
    log(`GitHub datasets error: ${String(err)}`, "error");
  }
  sourceStats["github-datasets"] = (sourceStats["github-datasets"] || 0) + added;
  return added;
}

// ─── Source 10: GitHub Issues Q&A ────────────────────────────────────────────
async function fetchGitHubIssues(dataset: { id: number }): Promise<number> {
  let added = 0;
  const repoName = getIssueRepo();

  try {
    const samples = await fetchGitHubIssueQA(repoName);
    added += await upsertSamples(dataset, samples.map((s: TrainingSample) => ({
      input: s.input,
      output: s.output,
      metadata: JSON.stringify({ source: "github-issues", repo: repoName }),
    })), "github-issues");
    if (added > 0) log(`GitHub issues "${repoName}": ${added} Q&A samples`, "success");
  } catch (err) {
    log(`GitHub issues error: ${String(err)}`, "error");
  }
  sourceStats["github-issues"] = (sourceStats["github-issues"] || 0) + added;
  return added;
}

// ─── Source 11: DEV.to API ───────────────────────────────────────────────────
const DEVTO_TAGS = [
  "ai", "machinelearning", "llm", "python", "javascript",
  "webdev", "tutorial", "programming", "datascience", "opensource",
];

async function fetchDevToData(dataset: { id: number }): Promise<number> {
  let added = 0;
  const tag = DEVTO_TAGS[Math.floor(Math.random() * DEVTO_TAGS.length)];

  try {
    const res = await fetch(
      `https://dev.to/api/articles?tag=${tag}&per_page=8&state=rising`,
      {
        headers: { "User-Agent": "DLavieOS-AutoTraining/2.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) return 0;

    const articles = await res.json() as Array<{
      title: string;
      description: string;
      body_markdown?: string;
      tag_list: string[];
      positive_reactions_count: number;
    }>;

    for (const article of articles.slice(0, 6)) {
      const { title, description, body_markdown, positive_reactions_count } = article;
      if (!title || positive_reactions_count < 5) continue;

      const content = body_markdown
        ? body_markdown.replace(/```[\s\S]*?```/g, "[code]").replace(/#{1,6}\s/g, "").replace(/\[.*?\]\(.*?\)/g, "").slice(0, 800)
        : description?.slice(0, 600) || `Tutorial about: ${title}`;

      added += await upsertSamples(dataset, [
        { input: `What does this dev.to article cover? "${title}"`, output: content.slice(0, 600) },
        { input: `Summarize this developer tutorial: "${title}"`, output: content.slice(0, 500) },
      ].map((s) => ({ ...s, metadata: JSON.stringify({ source: "devto", tag, reactions: positive_reactions_count }) })),
        "devto");
    }

    if (added > 0) log(`DEV.to [${tag}]: ${added} article samples`, "success");
  } catch (err) {
    log(`DEV.to error: ${String(err)}`, "error");
  }
  sourceStats.devto = (sourceStats.devto || 0) + added;
  return added;
}

// ─── URL scraping ─────────────────────────────────────────────────────────────
export async function scrapeUrlForTraining(
  url: string,
  datasetId?: number
): Promise<{ added: number; success: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DLavieOS-AutoTraining/2.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { added: 0, success: false, error: `HTTP ${res.status}` };

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 5000);

    if (text.length < 100) return { added: 0, success: false, error: "Content too short" };

    const domain = new URL(url).hostname;
    const title  = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || domain;

    const dataset = datasetId ? { id: datasetId } : await getLiveDataset();

    const added = await upsertSamples(dataset, [
      { input: `What is the content of the page "${title}"?`, output: text.slice(0, 600) },
      { input: `Summarize the web page: "${title}"`, output: text.slice(0, 500) },
      { input: `What key information does this page contain? (${domain})`, output: text.slice(0, 550) },
    ].map((s) => ({ ...s, metadata: JSON.stringify({ source: "url-scrape", url, domain }) })), "url-scrape");

    await updateSampleCount(dataset.id);
    totalSamplesAdded += added;
    log(`URL scrape: "${title}" (${domain}) → ${added} samples`, "success");
    return { added, success: true };
  } catch (err) {
    return { added: 0, success: false, error: String(err) };
  }
}

// ─── Main cycle ───────────────────────────────────────────────────────────────
export async function runAutoTrainingCycle(): Promise<{
  samplesAdded: number;
  success: boolean;
  breakdown: Record<string, number>;
  cycleNumber: number;
}> {
  if (autoTrainingRunning) {
    log("Cycle already running — skipping", "info");
    return { samplesAdded: 0, success: false, breakdown: {}, cycleNumber: totalCyclesCompleted };
  }

  autoTrainingRunning = true;
  currentCycleLog = [];
  let totalAdded = 0;
  const breakdown: Record<string, number> = {};

  try {
    log(`=== Auto-training cycle #${totalCyclesCompleted + 1} started ===`);
    broadcastEvent({ type: "cycle_start", cycleNumber: totalCyclesCompleted + 1, at: new Date().toISOString() });
    const dataset = await getLiveDataset();

    // Run all sources, some in parallel where safe
    const [wikiEN, wikiML] = await Promise.all([
      fetchWikipediaEN(dataset),
      fetchWikipediaMultilingual(dataset),
    ]);
    breakdown.wikipedia = wikiEN + wikiML;
    totalAdded += breakdown.wikipedia;

    breakdown.hackernews = await fetchHackerNewsData(dataset);
    totalAdded += breakdown.hackernews;

    breakdown.reddit = await fetchRedditData(dataset);
    totalAdded += breakdown.reddit;

    const [arxivN, rssN] = await Promise.all([
      fetchArxivData(dataset),
      fetchRSSData(dataset),
    ]);
    breakdown.arxiv = arxivN;
    breakdown.rss = rssN;
    totalAdded += arxivN + rssN;

    breakdown.huggingface = await fetchHFData(dataset);
    totalAdded += breakdown.huggingface;

    breakdown.curated = await generateAISamples(dataset);
    totalAdded += breakdown.curated;

    const [ghTrend, ghIssues, devtoN] = await Promise.all([
      fetchGitHubTrending(dataset),
      fetchGitHubIssues(dataset),
      fetchDevToData(dataset),
    ]);
    breakdown.github = ghTrend;
    breakdown["github-issues"] = ghIssues;
    breakdown.devto = devtoN;
    totalAdded += ghTrend + ghIssues + devtoN;

    // GitHub datasets (slower, run after main cycle)
    breakdown["github-datasets"] = await fetchGitHubDatasets(dataset);
    totalAdded += breakdown["github-datasets"];

    const totalCount = await updateSampleCount(dataset.id);
    const ghRate = await checkGitHubRateLimit().catch(() => null);

    log(
      `=== Cycle #${totalCyclesCompleted + 1} complete: +${totalAdded} samples` +
      ` (${totalCount} total)` +
      (ghRate ? ` | GitHub: ${ghRate.remaining}/${ghRate.limit} req left` : ""),
      "success"
    );

    totalCyclesCompleted++;
    totalSamplesAdded += totalAdded;
    lastCycleAt = new Date();

    broadcastEvent({
      type: "cycle_complete",
      cycleNumber: totalCyclesCompleted,
      samplesAdded: totalAdded,
      totalSamples: totalCount,
      breakdown,
      at: new Date().toISOString(),
    });

    return { samplesAdded: totalAdded, success: true, breakdown, cycleNumber: totalCyclesCompleted };
  } catch (err) {
    log(`Cycle error: ${String(err)}`, "error");
    broadcastEvent({ type: "cycle_error", cycleNumber: totalCyclesCompleted, error: String(err), at: new Date().toISOString() });
    return { samplesAdded: 0, success: false, breakdown, cycleNumber: totalCyclesCompleted };
  } finally {
    autoTrainingRunning = false;
  }
}

// ─── GitHub-only cycle (every 6h) ────────────────────────────────────────────
async function runGitHubDatasetsCycle(): Promise<void> {
  if (autoTrainingRunning) return;
  try {
    const dataset = await getLiveDataset();
    log("=== GitHub datasets deep cycle ===");
    const n = await fetchGitHubDatasets(dataset);
    const m = await fetchGitHubIssues(dataset);
    await updateSampleCount(dataset.id);
    totalSamplesAdded += n + m;
    log(`GitHub deep cycle: +${n + m} real dataset samples`, "success");
  } catch { /* silent */ }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
export function startAutoTraining(intervalMs: number = 3 * 60 * 60 * 1000): void {
  if (autoTrainingTimer) {
    log("Auto-training restarting…", "info");
    stopAutoTraining();
  }
  log(`Auto-training v2 started — full cycle every ${Math.round(intervalMs / 60000)} min, GitHub datasets every 6h`, "success");

  // First cycle after 30 seconds (give server time to fully start)
  setTimeout(() => {
    runAutoTrainingCycle().catch((e) => log(`Initial cycle error: ${e}`, "error"));
  }, 30_000);

  autoTrainingTimer = setInterval(() => {
    nextCycleAt = new Date(Date.now() + intervalMs);
    runAutoTrainingCycle().catch((e) => log(`Scheduled cycle error: ${e}`, "error"));
  }, intervalMs);
  nextCycleAt = new Date(Date.now() + intervalMs);

  // GitHub datasets cycle every 6 hours
  if (githubDatasetTimer) clearInterval(githubDatasetTimer);
  githubDatasetTimer = setInterval(() => {
    runGitHubDatasetsCycle().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

export function stopAutoTraining(): void {
  if (autoTrainingTimer) {
    clearInterval(autoTrainingTimer);
    autoTrainingTimer = null;
    nextCycleAt = null;
    log("Auto-training stopped", "info");
  }
  if (githubDatasetTimer) {
    clearInterval(githubDatasetTimer);
    githubDatasetTimer = null;
  }
}

// ─── Micro cycle (1 sample/min) ───────────────────────────────────────────────
let microTimer: ReturnType<typeof setInterval> | null = null;
const MICRO_TOPICS = [...WIKIPEDIA_TOPICS_EN, ...WIKIPEDIA_TOPICS_MULTILINGUAL.flatMap((l) => l.topics)];

async function runMicroCycle(): Promise<void> {
  if (autoTrainingRunning) return;
  try {
    const dataset = await getLiveDataset();
    // 70% chance English Wikipedia, 30% chance multilingual
    if (Math.random() < 0.7) {
      const topic = WIKIPEDIA_TOPICS_EN[Math.floor(Math.random() * WIKIPEDIA_TOPICS_EN.length)];
      const article = await fetchWikipediaArticle(topic);
      if (!article?.extract || article.extract.length < 80) return;
      const template = QA_TEMPLATES[Math.floor(Math.random() * QA_TEMPLATES.length)];
      const sample   = template(topic, article.extract);
      if (isDuplicate(sample.input)) return;

      await db.insert(trainingSamplesTable).values({
        datasetId: dataset.id,
        input:    sample.input,
        output:   sample.output.trim(),
        metadata: JSON.stringify({ source: "micro_wiki", topic, ts: Date.now() }),
      });

      await updateSampleCount(dataset.id);
      totalSamplesAdded += 1;
      sourceStats.wikipedia = (sourceStats.wikipedia || 0) + 1;

      activityLog.unshift({ at: new Date(), msg: `⚡ Micro: "${topic}" → 1 sample`, type: "success" });
      if (activityLog.length > 500) activityLog.pop();
    } else {
      // Multilingual micro sample
      const langConfig = WIKIPEDIA_TOPICS_MULTILINGUAL[Math.floor(Math.random() * WIKIPEDIA_TOPICS_MULTILINGUAL.length)];
      const topic = langConfig.topics[Math.floor(Math.random() * langConfig.topics.length)];
      const encoded = encodeURIComponent(topic.replace(/ /g, "_"));
      const res = await fetch(`https://${langConfig.code}.wikipedia.org/api/rest_v1/page/summary/${encoded}`, {
        headers: { "User-Agent": "DLavieOS-AutoTraining/2.0" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return;
      const data = await res.json() as { extract?: string };
      if (!data.extract || data.extract.length < 80) return;

      const templates = langConfig.code === "id" ? QA_TEMPLATES_ID : QA_TEMPLATES;
      const tmpl = templates[Math.floor(Math.random() * templates.length)];
      const sample = tmpl(topic, data.extract);
      if (isDuplicate(sample.input)) return;

      await db.insert(trainingSamplesTable).values({
        datasetId: dataset.id,
        input: sample.input,
        output: sample.output.trim(),
        metadata: JSON.stringify({ source: `micro_wiki_${langConfig.code}`, topic, lang: langConfig.code, ts: Date.now() }),
      });

      totalSamplesAdded += 1;
      sourceStats.wikipedia = (sourceStats.wikipedia || 0) + 1;
      activityLog.unshift({ at: new Date(), msg: `⚡ Micro [${langConfig.code}]: "${topic}" → 1 sample`, type: "success" });
      if (activityLog.length > 500) activityLog.pop();
    }
  } catch {
    // silent — micro cycles are best-effort
  }
}

export function startMicroTraining(intervalMs: number = 60_000): void {
  if (microTimer) clearInterval(microTimer);
  microTimer = setInterval(() => {
    runMicroCycle().catch(() => {});
  }, intervalMs);
  log(`⚡ Micro-training active — 1 sample every ${Math.round(intervalMs / 1000)}s (EN + multilingual)`, "success");
}

// ─── Status ───────────────────────────────────────────────────────────────────
export function getAutoTrainingStatus() {
  return {
    running: !!autoTrainingTimer,
    currentlyCycling: autoTrainingRunning,
    totalCyclesCompleted,
    totalSamplesAdded,
    lastCycleAt: lastCycleAt?.toISOString() || null,
    nextCycleAt: nextCycleAt?.toISOString() || null,
    activityLog: activityLog.slice(0, 80),
    currentCycleLog,
    hfConnected: isHFConfigured(),
    githubConnected: isGitHubConfigured(),
    sourceStats,
    sources: [
      "wikipedia-en", "wikipedia-multilingual", "hackernews", "reddit",
      "arxiv", "rss", "huggingface", "openassistant",
      "curated", "github", "github-datasets", "github-issues", "devto",
    ],
    githubToken: isGitHubConfigured() ? "authenticated (5000 req/hr)" : "public (60 req/hr)",
    deduplicationActive: true,
    totalDedupCacheSize: seenHashes.size,
    languages: ["en", "id", "ar", "fr", "es"],
  };
}
