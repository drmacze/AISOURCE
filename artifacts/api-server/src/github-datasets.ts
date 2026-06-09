/**
 * DLavie OS — GitHub Dataset Fetcher
 *
 * Fetches REAL training data from GitHub:
 *  1. Dataset repos (tagged "dataset", "nlp-dataset", "instruction-tuning")
 *  2. JSONL/JSON/CSV training files directly from repo contents
 *  3. GitHub issue discussions as Q&A pairs
 *  4. Code tutorials and examples from curated repos
 *  5. Multilingual content from GitHub repos
 *
 * Uses GITHUB_TOKEN for 5000 req/hr (vs 60/hr unauthenticated).
 */

import { createHash } from "crypto";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GH_API = "https://api.github.com";
const TIMEOUT_MS = 15_000;

function ghHeaders(useAuth = true): Record<string, string> {
  const h: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "DLavieOS-AutoTraining/2.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (useAuth && GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

async function ghFetch(url: string): Promise<Response> {
  let res = await fetch(url, { headers: ghHeaders(true), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if ((res.status === 401 || res.status === 403) && GITHUB_TOKEN) {
    res = await fetch(url, { headers: ghHeaders(false), signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
  return res;
}

export function hashText(text: string): string {
  return createHash("md5").update(text.slice(0, 200).toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

export interface TrainingSample {
  input: string;
  output: string;
  source: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

// ─── Dataset repos search ─────────────────────────────────────────────────────
const DATASET_QUERIES = [
  "topic:instruction-tuning stars:>50 language:json",
  "topic:nlp-dataset stars:>30",
  "topic:training-data stars:>30 language:jsonlines",
  "filename:train.jsonl stars:>100 in:name dataset",
  "topic:alpaca-style stars:>30",
  "topic:llm-dataset stars:>20",
  "topic:fine-tuning-data stars:>30",
  "topic:rlhf-data stars:>20",
];

interface GHRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  stargazers_count: number;
  topics: string[];
  language: string | null;
  default_branch: string;
}

export async function searchDatasetRepos(query: string, perPage = 5): Promise<GHRepo[]> {
  try {
    const url = `${GH_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;
    const res = await ghFetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { items?: GHRepo[] };
    return data.items || [];
  } catch {
    return [];
  }
}

// ─── Fetch JSONL training files from a repo ───────────────────────────────────
interface GHContent {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  download_url: string | null;
}

async function listRepoContents(owner: string, repo: string, path = ""): Promise<GHContent[]> {
  try {
    const url = `${GH_API}/repos/${owner}/${repo}/contents/${path}`;
    const res = await ghFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data as GHContent[] : [];
  } catch {
    return [];
  }
}

async function fetchFileContent(downloadUrl: string): Promise<string | null> {
  try {
    const res = await fetch(downloadUrl, {
      headers: { "User-Agent": "DLavieOS-AutoTraining/2.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 500_000); // max 500KB
  } catch {
    return null;
  }
}

function parseJSONLSamples(content: string): TrainingSample[] {
  const samples: TrainingSample[] = [];
  const lines = content.split("\n").filter((l) => l.trim());
  for (const line of lines.slice(0, 100)) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // Try different instruction/response field name patterns
      const input =
        (obj.instruction ?? obj.prompt ?? obj.input ?? obj.question ?? obj.human ?? obj.user) as string | undefined;
      const output =
        (obj.output ?? obj.response ?? obj.answer ?? obj.assistant ?? obj.completion) as string | undefined;

      if (input && output && input.length > 20 && output.length > 20) {
        samples.push({
          input: String(input).slice(0, 600),
          output: String(output).slice(0, 800),
          source: "github-dataset-jsonl",
          score: Math.min(1.0, (input.length + output.length) / 1000),
        });
      }
    } catch {
      continue;
    }
  }
  return samples;
}

function parseJSONArraySamples(content: string): TrainingSample[] {
  const samples: TrainingSample[] = [];
  try {
    const arr = JSON.parse(content);
    if (!Array.isArray(arr)) return [];
    for (const obj of arr.slice(0, 100)) {
      if (typeof obj !== "object" || !obj) continue;
      const input =
        (obj.instruction ?? obj.prompt ?? obj.input ?? obj.question ?? obj.human ?? obj.user) as string | undefined;
      const output =
        (obj.output ?? obj.response ?? obj.answer ?? obj.assistant ?? obj.completion) as string | undefined;
      if (input && output && input.length > 20 && output.length > 20) {
        samples.push({
          input: String(input).slice(0, 600),
          output: String(output).slice(0, 800),
          source: "github-dataset-json",
          score: 0.8,
        });
      }
    }
  } catch {
    return [];
  }
  return samples;
}

function parseCSVSamples(content: string): TrainingSample[] {
  const samples: TrainingSample[] = [];
  const lines = content.split("\n");
  if (lines.length < 2) return samples;

  const header = lines[0].toLowerCase().split(",").map((h: string) => h.replace(/"/g, "").trim());
  const inputIdx = header.findIndex((h: string) => ["instruction", "prompt", "input", "question", "text"].includes(h));
  const outputIdx = header.findIndex((h: string) => ["output", "response", "answer", "completion", "label"].includes(h));

  if (inputIdx === -1 || outputIdx === -1) return samples;

  for (const line of lines.slice(1, 101)) {
    const parts = line.split(",").map((p: string) => p.replace(/^"|"$/g, "").trim());
    const input = parts[inputIdx];
    const output = parts[outputIdx];
    if (input && output && input.length > 20 && output.length > 20) {
      samples.push({ input: input.slice(0, 600), output: output.slice(0, 800), source: "github-dataset-csv", score: 0.7 });
    }
  }
  return samples;
}

export async function fetchDatasetFromRepo(owner: string, repo: string): Promise<TrainingSample[]> {
  const allSamples: TrainingSample[] = [];
  const contents = await listRepoContents(owner, repo);

  for (const file of contents) {
    if (file.type !== "file" || file.size > 5_000_000) continue; // max 5MB files
    const name = file.name.toLowerCase();
    if (!name.endsWith(".jsonl") && !name.endsWith(".json") && !name.endsWith(".csv")) continue;
    // Skip obviously non-training files
    if (["package.json", "tsconfig.json", "config.json"].includes(name)) continue;
    if (!file.download_url) continue;

    const content = await fetchFileContent(file.download_url);
    if (!content) continue;

    let samples: TrainingSample[] = [];
    if (name.endsWith(".jsonl")) {
      samples = parseJSONLSamples(content);
    } else if (name.endsWith(".json")) {
      samples = parseJSONArraySamples(content);
    } else if (name.endsWith(".csv")) {
      samples = parseCSVSamples(content);
    }

    allSamples.push(...samples.slice(0, 30));
    if (allSamples.length >= 50) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  return allSamples;
}

// ─── GitHub Issue Discussions as Q&A ─────────────────────────────────────────
const ISSUE_REPOS = [
  "huggingface/transformers",
  "ollama/ollama",
  "langchain-ai/langchain",
  "ggml-org/llama.cpp",
  "microsoft/semantic-kernel",
  "openai/openai-python",
  "vllm-project/vllm",
];

interface GHIssue {
  title: string;
  body: string | null;
  comments_url: string;
  state: string;
  labels: Array<{ name: string }>;
}

interface GHComment {
  body: string;
  reactions?: { "+1": number };
}

export async function fetchGitHubIssueQA(repoFullName: string): Promise<TrainingSample[]> {
  const samples: TrainingSample[] = [];
  try {
    const url = `${GH_API}/repos/${repoFullName}/issues?state=closed&labels=question&per_page=8&sort=comments`;
    const res = await ghFetch(url);
    if (!res.ok) return [];
    const issues = await res.json() as GHIssue[];

    for (const issue of issues.slice(0, 5)) {
      if (!issue.title || !issue.body || issue.body.length < 50) continue;
      const question = `${issue.title}\n${issue.body.slice(0, 300)}`;

      // Get top comment as answer
      try {
        const commentRes = await ghFetch(`${issue.comments_url}?per_page=3`);
        if (commentRes.ok) {
          const comments = await commentRes.json() as GHComment[];
          const bestComment = comments
            .filter((c) => c.body && c.body.length > 30)
            .sort((a, b) => (b.reactions?.["+1"] || 0) - (a.reactions?.["+1"] || 0))[0];

          if (bestComment?.body) {
            samples.push({
              input: question.slice(0, 500),
              output: bestComment.body.slice(0, 600),
              source: "github-issues",
              metadata: { repo: repoFullName },
              score: 0.75,
            });
          }
        }
      } catch { /* skip */ }

      await new Promise((r) => setTimeout(r, 200));
    }
  } catch { /* skip */ }
  return samples;
}

// ─── Trending Repos with full README ─────────────────────────────────────────
export async function fetchTrendingWithREADME(query: string, limit = 5): Promise<TrainingSample[]> {
  const samples: TrainingSample[] = [];
  try {
    const searchUrl = `${GH_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limit}`;
    const res = await ghFetch(searchUrl);
    if (!res.ok) return [];
    const data = await res.json() as { items?: GHRepo[] };
    const repos = data.items || [];

    for (const repo of repos) {
      const { full_name, description, stargazers_count, topics, language, owner, name } = repo;
      if (description && description.length > 20) {
        samples.push({
          input: `What is the GitHub project "${full_name}" about?`,
          output: `${description} (⭐ ${stargazers_count.toLocaleString()} stars, Language: ${language || "N/A"}, Topics: ${(topics || []).slice(0, 4).join(", ")})`.slice(0, 500),
          source: "github-trending",
          score: Math.min(1.0, stargazers_count / 10000),
          metadata: { repo: full_name, stars: stargazers_count },
        });
      }

      // Fetch README
      try {
        const readmeRes = await ghFetch(`${GH_API}/repos/${owner.login}/${name}/readme`);
        if (readmeRes.ok) {
          const readmeText = await readmeRes.text();
          const clean = readmeText
            .replace(/!\[.*?\]\(.*?\)/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/#{1,6}\s*/g, "")
            .replace(/```[\s\S]*?```/g, "[code block]")
            .replace(/`[^`]+`/g, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, 1000);

          if (clean.length > 100) {
            samples.push({
              input: `Explain the purpose and usage of the GitHub project "${full_name}".`,
              output: clean,
              source: "github-readme",
              score: Math.min(1.0, stargazers_count / 5000),
              metadata: { repo: full_name, stars: stargazers_count },
            });
          }
        }
      } catch { /* skip */ }

      await new Promise((r) => setTimeout(r, 300));
    }
  } catch { /* skip */ }
  return samples;
}

// ─── GitHub code search (tutorials/examples) ─────────────────────────────────
const CODE_SEARCH_QUERIES = [
  "How to use Ollama in Python tutorial filename:README.md",
  "LLM fine-tuning example Jupyter notebook",
  "RAG retrieval augmented generation tutorial",
  "Hugging Face Transformers example usage",
];

export async function fetchGitHubCodeExamples(): Promise<TrainingSample[]> {
  const samples: TrainingSample[] = [];
  const query = CODE_SEARCH_QUERIES[Math.floor(Math.random() * CODE_SEARCH_QUERIES.length)];

  try {
    const url = `${GH_API}/search/code?q=${encodeURIComponent(query)}&per_page=5`;
    const res = await ghFetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { items?: Array<{ path: string; repository: { full_name: string }; html_url: string }> };
    const items = data.items || [];

    for (const item of items.slice(0, 3)) {
      const rawUrl = `https://raw.githubusercontent.com/${item.repository.full_name}/HEAD/${item.path}`;
      try {
        const content = await fetchFileContent(rawUrl);
        if (!content || content.length < 100) continue;

        const title = item.path.split("/").pop() || item.path;
        samples.push({
          input: `Show me an example of ${query.split(" ").slice(0, 5).join(" ")} from the project "${item.repository.full_name}".`,
          output: content.slice(0, 800),
          source: "github-code",
          metadata: { repo: item.repository.full_name, file: item.path },
          score: 0.7,
        });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return samples;
}

// ─── API Rate Limit Check ─────────────────────────────────────────────────────
export async function checkGitHubRateLimit(): Promise<{
  limit: number;
  remaining: number;
  reset: Date;
  authenticated: boolean;
}> {
  try {
    const res = await ghFetch(`${GH_API}/rate_limit`);
    if (!res.ok) return { limit: 60, remaining: 0, reset: new Date(), authenticated: false };
    const data = await res.json() as { rate: { limit: number; remaining: number; reset: number } };
    return {
      limit: data.rate.limit,
      remaining: data.rate.remaining,
      reset: new Date(data.rate.reset * 1000),
      authenticated: GITHUB_TOKEN.length > 0,
    };
  } catch {
    return { limit: 60, remaining: 0, reset: new Date(), authenticated: false };
  }
}

// ─── Pick next dataset repo query ─────────────────────────────────────────────
let queryIndex = 0;
export function getNextDatasetQuery(): string {
  const q = DATASET_QUERIES[queryIndex % DATASET_QUERIES.length];
  queryIndex++;
  return q;
}

export function getIssueRepo(): string {
  return ISSUE_REPOS[Math.floor(Math.random() * ISSUE_REPOS.length)];
}

export function isGitHubConfigured(): boolean {
  return GITHUB_TOKEN.length > 0;
}
