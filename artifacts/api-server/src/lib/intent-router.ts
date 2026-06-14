/**
 * BLOK E — Smart Model Routing (Intent-Based)
 *
 * Classifies every incoming message and routes it to the best available model.
 * Falls back gracefully if the best model is rate-limited.
 */

export type Intent =
  | "coding"
  | "bahasa_indonesia"
  | "math"
  | "creative"
  | "quickqa"
  | "long_context"
  | "general";

interface IntentRoute {
  intent: Intent;
  primary: string;   // e.g. "groq:qwen-qwq-32b"
  fallback: string;  // e.g. "groq:llama-3.3-70b-versatile"
  description: string;
}

// ─── Intent → Model routing table ─────────────────────────────────────────────
const ROUTES: IntentRoute[] = [
  {
    intent: "coding",
    primary: "groq:qwen-qwq-32b",
    fallback: "groq:llama-3.3-70b-versatile",
    description: "Code, programming, algorithms, debugging",
  },
  {
    intent: "bahasa_indonesia",
    primary: "kimi:kimi-k2-instruct",
    fallback: "groq:llama-3.3-70b-versatile",
    description: "Indonesian language, multilingual tasks",
  },
  {
    intent: "math",
    primary: "groq:deepseek-r1-distill-llama-70b",
    fallback: "groq:qwen-qwq-32b",
    description: "Math, logic, calculations, proofs",
  },
  {
    intent: "creative",
    primary: "groq:llama-3.3-70b-versatile",
    fallback: "openrouter:openrouter/free",
    description: "Creative writing, stories, poetry, brainstorming",
  },
  {
    intent: "quickqa",
    primary: "groq:llama-3.1-8b-instant",
    fallback: "groq:llama-3.3-70b-versatile",
    description: "Quick factual questions, simple lookups",
  },
  {
    intent: "long_context",
    primary: "groq:llama-3.3-70b-versatile",
    fallback: "openrouter:openrouter/free",
    description: "Long documents, large context analysis",
  },
  {
    intent: "general",
    primary: "groq:llama-3.3-70b-versatile",
    fallback: "openrouter:openrouter/free",
    description: "General conversation, mixed topics",
  },
];

// ─── Keyword patterns per intent ──────────────────────────────────────────────
const INTENT_PATTERNS: Array<{ intent: Intent; patterns: RegExp[] }> = [
  {
    intent: "coding",
    patterns: [
      /\b(code|kode|program|script|function|fungsi|bug|error|debug|compile|syntax|algorithm|algoritma|api|database|sql|html|css|javascript|typescript|python|java|c\+\+|rust|golang|npm|git|deploy|dockerfile|regex|loop|array|object|class|interface)\b/i,
      /```/,
      /\bfix\s+(this|my|the)\s+(code|bug|error)\b/i,
    ],
  },
  {
    intent: "bahasa_indonesia",
    patterns: [
      /\b(apa|bagaimana|kenapa|mengapa|tolong|bantu|jelaskan|ceritakan|buatkan|tuliskan|berikan|saya|kami|kita|yang|dengan|untuk|dari|dalam|pada|atau|dan|juga|sudah|belum|sedang|akan|bisa|tidak|jangan|gimana|gini|dong|sih|nih|lah|deh)\b/i,
      /[^a-zA-Z0-9\s](iya|ya|okay|oke|ok)[^a-zA-Z0-9\s]/i,
    ],
  },
  {
    intent: "math",
    patterns: [
      /\b(calculate|hitung|math|matematika|equation|persamaan|integral|derivative|turunan|matrix|matriks|probability|probabilitas|statistics|statistik|proof|bukti|theorem|teorema|algebra|geometry|calculus|trigonometry)\b/i,
      /\b\d+\s*[\+\-\*\/\^]\s*\d+/,
      /\b(solve|selesaikan|find\s+the\s+value|cari\s+nilai)\b/i,
    ],
  },
  {
    intent: "creative",
    patterns: [
      /\b(write|tulis|cerita|story|poem|puisi|novel|lyrics|lirik|creative|kreatif|imagine|bayangkan|fiction|fiksi|script|skenario|drama|pantun|sajak)\b/i,
      /\b(make\s+me\s+a\s+story|buat\s+(cerita|puisi|lagu))\b/i,
    ],
  },
  {
    intent: "quickqa",
    patterns: [
      /^.{0,60}\?$/,  // short question
      /\b(what\s+is|who\s+is|when\s+did|where\s+is|siapa|kapan|dimana|berapa)\b/i,
    ],
  },
  {
    intent: "long_context",
    patterns: [
      /\b(summarize|ringkas|analyze|analisis|review|document|dokumen|article|artikel|report|laporan|entire|seluruh|full\s+text|teks\s+panjang)\b/i,
    ],
  },
];

// ─── Main detector ─────────────────────────────────────────────────────────────

export function detectIntent(message: string): Intent {
  const scores: Record<Intent, number> = {
    coding: 0,
    bahasa_indonesia: 0,
    math: 0,
    creative: 0,
    quickqa: 0,
    long_context: 0,
    general: 0,
  };

  // Give weight based on how many patterns match
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        scores[intent] += 1;
      }
    }
  }

  // Long messages default to long_context
  if (message.length > 2000) scores.long_context += 2;

  // Find highest score
  let best: Intent = "general";
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores) as [Intent, number][]) {
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }

  return best;
}

// ─── Route resolver ────────────────────────────────────────────────────────────

export interface RouterDecision {
  intent: Intent;
  model: string;
  routedTo: string;
  description: string;
}

export function resolveRoute(message: string): RouterDecision {
  const intent = detectIntent(message);
  const route = ROUTES.find((r) => r.intent === intent) ?? ROUTES[ROUTES.length - 1];

  return {
    intent,
    model: route.primary,
    routedTo: route.primary,
    description: route.description,
  };
}

export function getRouteTable(): IntentRoute[] {
  return ROUTES;
}
