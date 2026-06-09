/**
 * DLavie OS — Auto-Training Engine (24/7 Live Learning)
 *
 * Continuously fetches fresh data from REAL external sources:
 *  1. Wikipedia API         — encyclopedic knowledge
 *  2. HackerNews API        — real-time tech news & discussions (no auth)
 *  3. Reddit JSON API       — r/MachineLearning, r/LocalLLaMA, etc. (no auth)
 *  4. arXiv API             — latest research papers (no auth)
 *  5. RSS Feeds             — tech blogs, AI news (no auth)
 *  6. HuggingFace Datasets  — curated instruction datasets (HF_TOKEN)
 *  7. Curated AI knowledge  — high-quality Q&A pairs
 *  8. GitHub API            — trending repos, READMEs, AI code (GITHUB_TOKEN)
 *
 * Schedule: configurable (default: every 3 hours)
 * Micro cycle: 1 sample per minute (Wikipedia)
 */

import { db } from "@workspace/db";
import {
  trainingDatasetsTable,
  trainingSamplesTable,
  trainingJobsTable,
  aiModelsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { fetchWikipediaArticle, fetchHFDataset, isHFConfigured } from "./huggingface";

// ─── State ────────────────────────────────────────────────────────────────────
let autoTrainingRunning  = false;
let autoTrainingTimer: ReturnType<typeof setInterval> | null = null;
let totalCyclesCompleted = 0;
let totalSamplesAdded    = 0;
let lastCycleAt: Date | null    = null;
let nextCycleAt: Date | null    = null;
let currentCycleLog: string[]   = [];
const activityLog: Array<{ at: Date; msg: string; type: "info" | "success" | "error" }> = [];
let sourceStats: Record<string, number> = {
  wikipedia: 0, hackernews: 0, reddit: 0, arxiv: 0, rss: 0, huggingface: 0, curated: 0, github: 0,
};

// ─── Knowledge domains ────────────────────────────────────────────────────────
const WIKIPEDIA_TOPICS = [
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
];

const QA_TEMPLATES = [
  (t: string, x: string) => ({ input: `What is ${t}?`, output: x.slice(0, 400) }),
  (t: string, x: string) => ({ input: `Explain ${t} in simple terms.`, output: x.slice(0, 300) }),
  (t: string, x: string) => ({ input: `Give me a brief overview of ${t}.`, output: x.slice(0, 350) }),
  (t: string, x: string) => ({ input: `What are the key concepts of ${t}?`, output: x.slice(0, 400) }),
  (t: string, x: string) => ({ input: `How does ${t} work?`, output: x.slice(0, 350) }),
  (t: string, x: string) => ({ input: `Why is ${t} important?`, output: x.slice(0, 300) }),
];

function log(msg: string, type: "info" | "success" | "error" = "info") {
  const entry = { at: new Date(), msg, type };
  activityLog.unshift(entry);
  if (activityLog.length > 300) activityLog.pop();
  currentCycleLog.push(`[${entry.at.toISOString().slice(11, 19)}] ${msg}`);
  console.log(`[AutoTraining] ${msg}`);
}

async function getLiveDataset(): Promise<{ id: number; name: string }> {
  const rows = await db.select().from(trainingDatasetsTable).orderBy(desc(trainingDatasetsTable.createdAt));
  const existing = rows.find((r: { name: string }) => r.name === "Live Learning Dataset");
  if (existing) return existing;
  const [ds] = await db.insert(trainingDatasetsTable).values({
    name: "Live Learning Dataset",
    description: "Automatically updated 24/7 from Wikipedia, HackerNews, Reddit, arXiv, RSS, HuggingFace, GitHub trending repos, and curated sources",
    taskType: "qa",
    sampleCount: 0,
  }).returning();
  log("Created Live Learning Dataset", "success");
  return ds;
}

async function updateSampleCount(datasetId: number): Promise<number> {
  const rows = await db.select().from(trainingSamplesTable).where(eq(trainingSamplesTable.datasetId, datasetId));
  await db.update(trainingDatasetsTable)
    .set({ sampleCount: rows.length, updatedAt: new Date() })
    .where(eq(trainingDatasetsTable.id, datasetId));
  return rows.length;
}

// ─── Source 1: Wikipedia ──────────────────────────────────────────────────────
async function fetchWikipediaData(dataset: { id: number }): Promise<number> {
  const topicBatch = [...WIKIPEDIA_TOPICS].sort(() => Math.random() - 0.5).slice(0, 5);
  let added = 0;
  for (const topic of topicBatch) {
    try {
      const article = await fetchWikipediaArticle(topic);
      if (!article?.extract || article.extract.length < 100) continue;
      const samples = QA_TEMPLATES.slice(0, 3).map((fn) => fn(topic, article.extract));
      await db.insert(trainingSamplesTable).values(
        samples.map((s) => ({
          datasetId: dataset.id,
          input: s.input,
          output: s.output.trim(),
          metadata: JSON.stringify({ source: "wikipedia", topic }),
        }))
      );
      added += samples.length;
      log(`Wikipedia: "${topic}" → ${samples.length} samples`, "success");
    } catch (err) {
      log(`Wikipedia error for "${topic}": ${String(err)}`, "error");
    }
  }
  sourceStats.wikipedia = (sourceStats.wikipedia || 0) + added;
  return added;
}

// ─── Source 2: HackerNews (no auth) ──────────────────────────────────────────
async function fetchHackerNewsData(dataset: { id: number }): Promise<number> {
  let added = 0;
  try {
    // Fetch top stories
    const topStoriesRes = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=30&orderBy=%22$key%22",
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!topStoriesRes.ok) return 0;
    const ids = await topStoriesRes.json() as number[];
    const topIds = ids.slice(0, 8);

    for (const id of topIds) {
      try {
        const itemRes = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { signal: AbortSignal.timeout(8_000) }
        );
        if (!itemRes.ok) continue;
        const item = await itemRes.json() as {
          title?: string; text?: string; url?: string; score?: number; type?: string;
        };
        if (!item.title || item.type !== "story") continue;

        // Generate Q&A from story title + text
        const content = item.text
          ? item.text.replace(/<[^>]+>/g, "").slice(0, 400)
          : `A discussion about: ${item.title}`;

        const samples = [
          { input: `What is the HackerNews discussion about "${item.title}"?`, output: content },
          { input: `Summarize this tech news: "${item.title}"`, output: content },
        ];

        await db.insert(trainingSamplesTable).values(
          samples.map((s) => ({
            datasetId: dataset.id,
            input: s.input,
            output: s.output,
            metadata: JSON.stringify({ source: "hackernews", hnId: id, score: item.score }),
          }))
        );
        added += samples.length;
      } catch { /* skip individual item errors */ }
    }

    if (added > 0) log(`HackerNews: ${added} samples from top stories`, "success");
  } catch (err) {
    log(`HackerNews error: ${String(err)}`, "error");
  }
  sourceStats.hackernews = (sourceStats.hackernews || 0) + added;
  return added;
}

// ─── Source 3: Reddit (no auth, JSON API) ─────────────────────────────────────
const REDDIT_SUBREDDITS = [
  "MachineLearning", "LocalLLaMA", "artificial", "datascience",
  "programming", "technology", "ArtificialIntelligence",
];

async function fetchRedditData(dataset: { id: number }): Promise<number> {
  let added = 0;
  const sub = REDDIT_SUBREDDITS[Math.floor(Math.random() * REDDIT_SUBREDDITS.length)];

  try {
    const res = await fetch(
      `https://www.reddit.com/r/${sub}/hot.json?limit=10`,
      {
        headers: { "User-Agent": "DLavieOS-AutoTraining/1.0" },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) return 0;

    const data = await res.json() as {
      data?: { children?: Array<{ data: { title: string; selftext: string; score: number; url: string } }> }
    };
    const posts = data?.data?.children || [];

    for (const post of posts.slice(0, 8)) {
      const { title, selftext, score, url } = post.data as { title: string; selftext: string; score: number; url: string };
      if (!title) continue;

      const text = selftext && selftext.length > 30
        ? selftext.slice(0, 500).replace(/\n+/g, " ")
        : `Discussion about: ${title}. Link: ${url || ""}`;

      const samples = [
        { input: `What is this Reddit discussion about? "${title}"`, output: text.slice(0, 400) },
        { input: `Summarize this tech post from r/${sub}: "${title}"`, output: text.slice(0, 400) },
      ];

      await db.insert(trainingSamplesTable).values(
        samples.map((s) => ({
          datasetId: dataset.id,
          input: s.input,
          output: s.output,
          metadata: JSON.stringify({ source: "reddit", subreddit: sub, score }),
        }))
      );
      added += samples.length;
    }

    if (added > 0) log(`Reddit r/${sub}: ${added} samples`, "success");
  } catch (err) {
    log(`Reddit error (r/${sub}): ${String(err)}`, "error");
  }
  sourceStats.reddit = (sourceStats.reddit || 0) + added;
  return added;
}

// ─── Source 4: arXiv research papers ─────────────────────────────────────────
const ARXIV_SEARCHES = [
  "large language models", "machine learning transformers",
  "reinforcement learning AI", "computer vision deep learning",
  "natural language processing", "multi-modal AI",
  "diffusion models generative", "retrieval augmented generation",
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
    for (const entry of entries.slice(0, 5)) {
      const titleMatch   = entry.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      if (!titleMatch || !summaryMatch) continue;
      const title   = titleMatch[1].replace(/\s+/g, " ").trim();
      const summary = summaryMatch[1].replace(/\s+/g, " ").trim().slice(0, 600);
      await db.insert(trainingSamplesTable).values({
        datasetId: dataset.id,
        input: `Summarize the research paper: "${title}"`,
        output: summary,
        metadata: JSON.stringify({ source: "arxiv", query: q }),
      });
      added++;
    }
    if (added > 0) log(`arXiv: "${q}" → ${added} papers`, "success");
  } catch (err) {
    log(`arXiv error: ${String(err)}`, "error");
  }
  sourceStats.arxiv = (sourceStats.arxiv || 0) + added;
  return added;
}

// ─── Source 5: RSS Feeds (Tech blogs, AI news) ───────────────────────────────
const RSS_FEEDS = [
  { name: "MIT News AI", url: "https://news.mit.edu/rss/topic/artificial-intelligence2" },
  { name: "Google AI Blog", url: "https://feeds.feedburner.com/blogspot/gJZg" },
  { name: "OpenAI Blog", url: "https://openai.com/blog/rss" },
  { name: "Ars Technica AI", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/ai/feed/" },
];

function parseRSSItems(xml: string): Array<{ title: string; description: string }> {
  const items: Array<{ title: string; description: string }> = [];
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of itemMatches.slice(0, 5)) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch  = item.match(/<description>([\s\S]*?)<\/description>/);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    const desc  = descMatch
      ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim().slice(0, 400)
      : "";
    if (title && title.length > 10) items.push({ title, description: desc });
  }
  return items;
}

async function fetchRSSData(dataset: { id: number }): Promise<number> {
  let added = 0;
  const feed = RSS_FEEDS[Math.floor(Math.random() * RSS_FEEDS.length)];

  try {
    const res = await fetch(feed.url, {
      headers: { "Accept": "application/rss+xml, text/xml, */*", "User-Agent": "DLavieOS-AutoTraining/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return 0;

    const xml = await res.text();
    const items = parseRSSItems(xml);

    for (const item of items) {
      const content = item.description || `Article about: ${item.title}`;
      await db.insert(trainingSamplesTable).values([
        {
          datasetId: dataset.id,
          input: `Summarize this AI/tech news: "${item.title}"`,
          output: content,
          metadata: JSON.stringify({ source: "rss", feed: feed.name }),
        },
        {
          datasetId: dataset.id,
          input: `What is this article about? "${item.title}"`,
          output: content,
          metadata: JSON.stringify({ source: "rss", feed: feed.name }),
        },
      ]);
      added += 2;
    }

    if (added > 0) log(`RSS [${feed.name}]: ${added} samples`, "success");
  } catch (err) {
    log(`RSS error [${feed.name}]: ${String(err)}`, "error");
  }
  sourceStats.rss = (sourceStats.rss || 0) + added;
  return added;
}

// ─── Source 6: HuggingFace Datasets ──────────────────────────────────────────
const HF_DATASETS = [
  { ds: "tatsu-lab/alpaca",                  inputKey: "instruction", outputKey: "output" },
  { ds: "databricks/databricks-dolly-15k",   inputKey: "instruction", outputKey: "response" },
  { ds: "HuggingFaceH4/instruction-dataset", inputKey: "prompt",      outputKey: "completion" },
];

async function fetchHFData(dataset: { id: number }): Promise<number> {
  if (!isHFConfigured()) return 0;
  let added = 0;
  const chosen = HF_DATASETS[Math.floor(Math.random() * HF_DATASETS.length)];

  try {
    log(`Fetching HuggingFace dataset: ${chosen.ds}`);
    const rows = await fetchHFDataset(chosen.ds, "train", 20);
    const samples = rows
      .filter((r: Record<string, unknown>) => r[chosen.inputKey] && r[chosen.outputKey])
      .slice(0, 10)
      .map((r: Record<string, unknown>) => ({
        datasetId: dataset.id,
        input: String(r[chosen.inputKey]).slice(0, 500),
        output: String(r[chosen.outputKey]).slice(0, 600),
        metadata: JSON.stringify({ source: "huggingface", dataset: chosen.ds }),
      }));

    if (samples.length > 0) {
      await db.insert(trainingSamplesTable).values(samples);
      added += samples.length;
      log(`HuggingFace: ${chosen.ds} → ${samples.length} samples`, "success");
    }
  } catch (err) {
    log(`HuggingFace error (${chosen.ds}): ${String(err)}`, "error");
  }
  sourceStats.huggingface = (sourceStats.huggingface || 0) + added;
  return added;
}

// ─── Source 7: Curated AI knowledge ──────────────────────────────────────────
const CURATED_QA = [
  { input: "What is the difference between supervised and unsupervised learning?", output: "Supervised learning uses labeled data (input-output pairs) to train models, while unsupervised learning finds patterns in unlabeled data. Examples: supervised = image classification, spam detection; unsupervised = clustering, anomaly detection." },
  { input: "How do transformers work in NLP?", output: "Transformers use self-attention mechanisms to process sequences in parallel. They consist of encoder-decoder blocks with multi-head attention, allowing the model to focus on different parts of the input simultaneously. This enables models like BERT and GPT to achieve state-of-the-art NLP performance." },
  { input: "What is gradient descent?", output: "Gradient descent is an optimization algorithm that minimizes a loss function by iteratively moving in the direction of steepest descent (negative gradient). Variants include SGD, mini-batch GD, Adam, RMSprop. Learning rate controls step size." },
  { input: "Explain the concept of RAG in AI systems.", output: "Retrieval-Augmented Generation (RAG) combines information retrieval with generative AI. RAG systems retrieve relevant documents at inference time and inject them into the prompt. This grounds responses in real data, reduces hallucinations, and allows models to access up-to-date information without retraining." },
  { input: "What are embeddings in machine learning?", output: "Embeddings are dense vector representations of data (text, images, audio) in a continuous vector space. Similar items have similar embeddings. They capture semantic meaning, enabling ML models to understand relationships. Word2Vec, GloVe map words to vectors; sentence transformers map entire sentences." },
  { input: "What is fine-tuning vs. pre-training?", output: "Pre-training: training a model from scratch on large general datasets. Fine-tuning: further training a pre-trained model on a smaller, task-specific dataset. Fine-tuning is much faster and requires less data than pre-training from scratch." },
  { input: "How does temperature affect LLM outputs?", output: "Temperature controls randomness in LLM generation. Low (0.1-0.3): deterministic, focused outputs. Medium (0.5-0.8): balanced creativity. High (1.0+): diverse, creative. Temperature scales the logit distribution before softmax sampling." },
  { input: "What is RLHF in AI training?", output: "Reinforcement Learning from Human Feedback (RLHF) aligns LLMs with human preferences. Steps: 1) Train base model, 2) Collect human preference comparisons, 3) Train reward model, 4) Use PPO to fine-tune LLM to maximize reward. Used in ChatGPT, Claude, Gemini." },
  { input: "What is quantization in LLMs?", output: "Quantization reduces model size by converting weights from float32 to lower precision (int8, int4, float16). Benefits: smaller file size, faster inference, lower memory usage. GGUF format (used by Ollama) applies 4-bit quantization, reducing a 7B model from ~14GB to ~4GB." },
  { input: "Explain vector databases and why they matter for AI.", output: "Vector databases store and efficiently search high-dimensional vectors (embeddings). When a query arrives, it's converted to a vector, then the DB finds nearest neighbors using HNSW or IVF. Used in RAG systems, recommendation engines, semantic search. Examples: Pinecone, Chroma, pgvector." },
  { input: "What is Mixture of Experts (MoE) in AI?", output: "Mixture of Experts is a neural network architecture where only a subset of 'expert' networks are activated for each input token. This allows training much larger models efficiently. Examples: Mixtral, Kimi K2 (1T params MoE). MoE models use fewer FLOPs per forward pass than dense models of equivalent parameter count." },
  { input: "What is the difference between GPT and BERT?", output: "GPT is decoder-only (autoregressive, generates text left-to-right), pre-trained with causal language modeling. BERT is encoder-only (bidirectional attention), pre-trained with masked language modeling and next-sentence prediction. GPT excels at generation; BERT excels at classification and NLU tasks." },
];

async function generateAISamples(dataset: { id: number }): Promise<number> {
  const sample = [...CURATED_QA].sort(() => Math.random() - 0.5).slice(0, 4);
  await db.insert(trainingSamplesTable).values(
    sample.map((s) => ({
      datasetId: dataset.id,
      input: s.input,
      output: s.output,
      metadata: JSON.stringify({ source: "curated-ai-knowledge" }),
    }))
  );
  sourceStats.curated = (sourceStats.curated || 0) + sample.length;
  return sample.length;
}

// ─── Source 8: GitHub API (trending repos + READMEs) ─────────────────────────
const GITHUB_SEARCH_QUERIES = [
  "topic:machine-learning stars:>500",
  "topic:llm stars:>200",
  "topic:artificial-intelligence stars:>300",
  "topic:deep-learning stars:>400",
  "topic:nlp stars:>200",
  "topic:computer-vision stars:>300",
  "topic:pytorch stars:>500",
  "topic:transformers stars:>300",
  "language:python topic:ai stars:>200",
  "topic:rag stars:>100",
  "topic:ollama stars:>50",
  "topic:fine-tuning stars:>100",
];

function isGithubConfigured(): boolean {
  return true; // always available — uses public API (60 req/hr) even without token
}

async function fetchGitHubReadme(owner: string, repo: string, token: string | undefined): Promise<string | null> {
  async function tryFetch(useAuth: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.raw+json",
      "User-Agent": "DLavieOS-AutoTraining/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (useAuth && token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  }
  try {
    let res = await tryFetch(!!token);
    if ((res.status === 401 || res.status === 403) && token) {
      res = await tryFetch(false);
    }
    if (!res.ok) return null;
    const text = await res.text();
    // Strip markdown formatting for cleaner training data
    return text
      .replace(/!\[.*?\]\(.*?\)/g, "")    // remove images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links → text
      .replace(/#{1,6}\s*/g, "")          // headings
      .replace(/```[\s\S]*?```/g, "")     // code blocks
      .replace(/`[^`]+`/g, "")           // inline code
      .replace(/\n{3,}/g, "\n\n")        // extra newlines
      .trim()
      .slice(0, 800);
  } catch {
    return null;
  }
}

async function fetchGitHubData(dataset: { id: number }): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  let added = 0;
  const query = GITHUB_SEARCH_QUERIES[Math.floor(Math.random() * GITHUB_SEARCH_QUERIES.length)];

  // Build headers — try with token first, fall back to unauthenticated
  function buildHeaders(includeAuth: boolean): Record<string, string> {
    const h: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "DLavieOS-AutoTraining/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (includeAuth && token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function githubFetch(url: string, useAuth: boolean): Promise<Response> {
    return fetch(url, { headers: buildHeaders(useAuth), signal: AbortSignal.timeout(15_000) });
  }

  try {
    const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=8`;

    // Try authenticated first, fall back to unauthenticated on 401/403
    let searchRes = await githubFetch(searchUrl, !!token);
    if ((searchRes.status === 401 || searchRes.status === 403) && token) {
      log(`GitHub: token invalid (HTTP ${searchRes.status}) — retrying unauthenticated`, "info");
      searchRes = await githubFetch(searchUrl, false);
    }

    if (!searchRes.ok) {
      log(`GitHub search failed: HTTP ${searchRes.status}`, "error");
      return 0;
    }

    // Track auth mode used
    const authMode = token && searchRes.headers.get("x-oauth-scopes") !== null ? "authenticated" : "public";
    if (authMode === "public" && !token) {
      log("GitHub: using public API (no token — 60 req/hr limit)", "info");
    }

    const data = await searchRes.json() as {
      items?: Array<{
        full_name: string;
        name: string;
        owner: { login: string };
        description: string | null;
        stargazers_count: number;
        topics: string[];
        language: string | null;
      }>
    };

    const repos = data.items || [];

    for (const repo of repos.slice(0, 5)) {
      try {
        const owner = repo.owner.login;
        const name  = repo.name;
        const desc  = repo.description || "";
        const stars = repo.stargazers_count;
        const lang  = repo.language || "Unknown";
        const topics = (repo.topics || []).join(", ");

        // Sample 1: repo overview from description
        if (desc && desc.length > 20) {
          await db.insert(trainingSamplesTable).values({
            datasetId: dataset.id,
            input: `What is the GitHub repository "${repo.full_name}"?`,
            output: `${desc} (Stars: ${stars}, Language: ${lang}, Topics: ${topics})`.slice(0, 500),
            metadata: JSON.stringify({ source: "github", repo: repo.full_name, stars }),
          });
          added++;
        }

        // Sample 2: fetch and use README for deeper context
        const readme = await fetchGitHubReadme(owner, name, token);
        if (readme && readme.length > 100) {
          await db.insert(trainingSamplesTable).values([
            {
              datasetId: dataset.id,
              input: `Explain how to use the GitHub project "${repo.full_name}".`,
              output: readme.slice(0, 600),
              metadata: JSON.stringify({ source: "github-readme", repo: repo.full_name, stars }),
            },
            {
              datasetId: dataset.id,
              input: `Summarize the README of the project "${name}": ${desc}`.slice(0, 200),
              output: readme.slice(0, 500),
              metadata: JSON.stringify({ source: "github-readme", repo: repo.full_name }),
            },
          ]);
          added += 2;
        }

        // Small delay to respect rate limits
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        // skip individual repo errors
      }
    }

    if (added > 0) {
      log(`GitHub: "${query}" → ${added} samples from ${Math.min(repos.length, 5)} repos`, "success");
    }
  } catch (err) {
    log(`GitHub error: ${String(err)}`, "error");
  }

  sourceStats.github = (sourceStats.github || 0) + added;
  return added;
}

// ─── URL scraping (user-provided URLs) ───────────────────────────────────────
export async function scrapeUrlForTraining(
  url: string,
  datasetId?: number
): Promise<{ added: number; success: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DLavieOS-AutoTraining/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { added: 0, success: false, error: `HTTP ${res.status}` };

    const html = await res.text();
    // Strip HTML tags
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

    const dataset = datasetId
      ? { id: datasetId }
      : await getLiveDataset();

    const samples = [
      { input: `What is the content of the page "${title}"?`, output: text.slice(0, 500) },
      { input: `Summarize the web page: "${title}"`, output: text.slice(0, 400) },
      { input: `What information does this page contain? (${domain})`, output: text.slice(0, 450) },
    ];

    await db.insert(trainingSamplesTable).values(
      samples.map((s) => ({
        datasetId: dataset.id,
        input: s.input,
        output: s.output,
        metadata: JSON.stringify({ source: "url-scrape", url, domain }),
      }))
    );

    await updateSampleCount(dataset.id);
    totalSamplesAdded += samples.length;
    log(`URL scrape: "${title}" (${domain}) → ${samples.length} samples`, "success");

    return { added: samples.length, success: true };
  } catch (err) {
    return { added: 0, success: false, error: String(err) };
  }
}

// ─── Main cycle ───────────────────────────────────────────────────────────────
export async function runAutoTrainingCycle(): Promise<{
  samplesAdded: number;
  success: boolean;
  breakdown: Record<string, number>;
}> {
  if (autoTrainingRunning) {
    log("Cycle already running — skipping", "info");
    return { samplesAdded: 0, success: false, breakdown: {} };
  }

  autoTrainingRunning = true;
  currentCycleLog = [];
  let totalAdded = 0;
  const breakdown: Record<string, number> = {};

  try {
    log("=== Auto-training cycle started ===", "info");
    const dataset = await getLiveDataset();

    // Phase 1: Wikipedia
    const wikiAdded = await fetchWikipediaData(dataset);
    breakdown.wikipedia = wikiAdded;
    totalAdded += wikiAdded;

    // Phase 2: HackerNews
    const hnAdded = await fetchHackerNewsData(dataset);
    breakdown.hackernews = hnAdded;
    totalAdded += hnAdded;

    // Phase 3: Reddit
    const redditAdded = await fetchRedditData(dataset);
    breakdown.reddit = redditAdded;
    totalAdded += redditAdded;

    // Phase 4: arXiv papers
    const arxivAdded = await fetchArxivData(dataset);
    breakdown.arxiv = arxivAdded;
    totalAdded += arxivAdded;

    // Phase 5: RSS feeds
    const rssAdded = await fetchRSSData(dataset);
    breakdown.rss = rssAdded;
    totalAdded += rssAdded;

    // Phase 6: HuggingFace datasets (if configured)
    const hfAdded = await fetchHFData(dataset);
    breakdown.huggingface = hfAdded;
    totalAdded += hfAdded;

    // Phase 7: Curated AI knowledge
    const aiAdded = await generateAISamples(dataset);
    breakdown.curated = aiAdded;
    totalAdded += aiAdded;

    // Phase 8: GitHub trending repos + READMEs (if GITHUB_TOKEN set)
    const ghAdded = await fetchGitHubData(dataset);
    breakdown.github = ghAdded;
    totalAdded += ghAdded;

    const totalCount = await updateSampleCount(dataset.id);
    log(`=== Cycle complete: +${totalAdded} samples (${totalCount} total) ===`, "success");

    totalCyclesCompleted++;
    totalSamplesAdded += totalAdded;
    lastCycleAt = new Date();

    return { samplesAdded: totalAdded, success: true, breakdown };
  } catch (err) {
    log(`Cycle error: ${String(err)}`, "error");
    return { samplesAdded: 0, success: false, breakdown };
  } finally {
    autoTrainingRunning = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
export function startAutoTraining(intervalMs: number = 3 * 60 * 60 * 1000): void {
  if (autoTrainingTimer) {
    log("Auto-training already running — restarting", "info");
    stopAutoTraining();
  }
  log(`Auto-training started — cycle every ${Math.round(intervalMs / 60000)} minutes`, "success");
  runAutoTrainingCycle().catch((e) => log(`Initial cycle error: ${e}`, "error"));
  autoTrainingTimer = setInterval(() => {
    nextCycleAt = new Date(Date.now() + intervalMs);
    runAutoTrainingCycle().catch((e) => log(`Scheduled cycle error: ${e}`, "error"));
  }, intervalMs);
  nextCycleAt = new Date(Date.now() + intervalMs);
}

export function stopAutoTraining(): void {
  if (autoTrainingTimer) {
    clearInterval(autoTrainingTimer);
    autoTrainingTimer = null;
    nextCycleAt = null;
    log("Auto-training stopped", "info");
  }
}

// ─── Micro cycle (1 sample/min) ───────────────────────────────────────────────
let microTimer: ReturnType<typeof setInterval> | null = null;

async function runMicroCycle(): Promise<void> {
  if (autoTrainingRunning) return;
  try {
    const dataset = await getLiveDataset();
    const topic   = WIKIPEDIA_TOPICS[Math.floor(Math.random() * WIKIPEDIA_TOPICS.length)];
    const article = await fetchWikipediaArticle(topic);
    if (!article?.extract || article.extract.length < 80) return;

    const template = QA_TEMPLATES[Math.floor(Math.random() * QA_TEMPLATES.length)];
    const sample   = template(topic, article.extract);

    await db.insert(trainingSamplesTable).values({
      datasetId: dataset.id,
      input:    sample.input,
      output:   sample.output.trim(),
      metadata: JSON.stringify({ source: "micro_wiki", topic, ts: Date.now() }),
    });

    await updateSampleCount(dataset.id);
    totalSamplesAdded += 1;
    sourceStats.wikipedia = (sourceStats.wikipedia || 0) + 1;

    const entry = { at: new Date(), msg: `⚡ Micro: "${topic}" → 1 sample`, type: "success" as const };
    activityLog.unshift(entry);
    if (activityLog.length > 300) activityLog.pop();
  } catch {
    // silent — micro cycles are best-effort
  }
}

export function startMicroTraining(intervalMs: number = 60_000): void {
  if (microTimer) clearInterval(microTimer);
  microTimer = setInterval(() => {
    runMicroCycle().catch(() => {});
  }, intervalMs);
  log(`⚡ Micro-training active — 1 sample every ${Math.round(intervalMs / 1000)}s`, "success");
}

export function getAutoTrainingStatus() {
  return {
    running: !!autoTrainingTimer,
    currentlyCycling: autoTrainingRunning,
    totalCyclesCompleted,
    totalSamplesAdded,
    lastCycleAt: lastCycleAt?.toISOString() || null,
    nextCycleAt: nextCycleAt?.toISOString() || null,
    activityLog: activityLog.slice(0, 50),
    currentCycleLog,
    hfConnected: isHFConfigured(),
    githubConnected: isGithubConfigured(),
    sourceStats,
    sources: ["wikipedia", "hackernews", "reddit", "arxiv", "rss", "huggingface", "curated", "github"],
  };
}
