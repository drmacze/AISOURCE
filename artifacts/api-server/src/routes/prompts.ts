/**
 * DLavie OS — Prompt Library API
 *
 * Save, organize, and reuse prompts across conversations.
 * Endpoints:
 *   GET    /api/prompts             — List all prompts (with optional category filter)
 *   POST   /api/prompts             — Create a new prompt
 *   GET    /api/prompts/:id         — Get single prompt
 *   PATCH  /api/prompts/:id         — Update prompt
 *   DELETE /api/prompts/:id         — Delete prompt
 *   POST   /api/prompts/:id/use     — Increment use counter
 *   GET    /api/prompts/categories  — List all categories
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { promptsTable } from "@workspace/db";
import { eq, desc, sql, ilike } from "drizzle-orm";

const router: IRouter = Router();

// ─── GET /api/prompts ─────────────────────────────────────────────────────────
router.get("/prompts", async (req, res) => {
  const { category, search, limit = "50" } = req.query as Record<string, string>;

  let query = db.select().from(promptsTable).$dynamic();

  if (category && category !== "all") {
    query = query.where(eq(promptsTable.category, category));
  }
  if (search) {
    query = query.where(ilike(promptsTable.name, `%${search}%`));
  }

  const rows = await query.orderBy(desc(promptsTable.useCount), desc(promptsTable.createdAt)).limit(parseInt(limit, 10) || 50);
  res.json(rows);
});

// ─── GET /api/prompts/categories ──────────────────────────────────────────────
router.get("/prompts/categories", async (_req, res) => {
  const rows = await db.execute(sql`SELECT category, COUNT(*)::int as count FROM prompts GROUP BY category ORDER BY count DESC`);
  res.json(rows);
});

// ─── POST /api/prompts ────────────────────────────────────────────────────────
router.post("/prompts", async (req, res) => {
  const { name, content, category = "general", tags = [], description = "" } = req.body as {
    name?: string; content?: string; category?: string; tags?: string[]; description?: string;
  };
  if (!name?.trim() || !content?.trim()) {
    res.status(400).json({ error: "name and content are required" });
    return;
  }

  const [row] = await db.insert(promptsTable).values({
    name: name.trim(),
    content: content.trim(),
    category: category || "general",
    tags: JSON.stringify(tags),
    description: description?.trim() || null,
  }).returning();
  res.status(201).json(row);
});

// ─── GET /api/prompts/:id ────────────────────────────────────────────────────
router.get("/prompts/:id", async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(promptsTable).where(eq(promptsTable.id, id));
  if (!row) { res.status(404).json({ error: "Prompt not found" }); return; }
  res.json(row);
});

// ─── PATCH /api/prompts/:id ───────────────────────────────────────────────────
router.patch("/prompts/:id", async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, content, category, tags, description } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name)        updates.name        = String(name).trim();
  if (content)     updates.content     = String(content).trim();
  if (category)    updates.category    = String(category);
  if (tags)        updates.tags        = JSON.stringify(tags);
  if (description !== undefined) updates.description = String(description).trim() || null;

  const [updated] = await db.update(promptsTable).set(updates).where(eq(promptsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Prompt not found" }); return; }
  res.json(updated);
});

// ─── DELETE /api/prompts/:id ──────────────────────────────────────────────────
router.delete("/prompts/:id", async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.delete(promptsTable).where(eq(promptsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Prompt not found" }); return; }
  res.status(204).send();
});

// ─── POST /api/prompts/:id/use ────────────────────────────────────────────────
router.post("/prompts/:id/use", async (req, res) => {
  const id = parseInt((req.params['id'] as string), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(promptsTable)
    .set({ useCount: sql`use_count + 1`, updatedAt: new Date() })
    .where(eq(promptsTable.id, id));
  res.json({ ok: true });
});

// ─── POST /api/prompts/seed ───────────────────────────────────────────────────
// Seeds the DB with a curated set of default prompts (skips if already seeded)
router.post("/prompts/seed", async (_req, res) => {
  const existing = await db.select().from(promptsTable).limit(1);
  if (existing.length > 0) {
    res.json({ message: "Already seeded", seeded: 0 });
    return;
  }

  const defaults = [
    { name: "Expert Code Reviewer", category: "coding", description: "Thorough code analysis with security focus",
      content: `You are an expert senior engineer performing a deep code review. Analyze this code for:\n1. Bugs and potential runtime errors\n2. Security vulnerabilities (XSS, injection, auth issues)\n3. Performance bottlenecks\n4. Code quality and maintainability\n5. Missing error handling\n6. Suggestions for improvement\n\nProvide concrete examples and fixes for each issue found.` },
    { name: "Technical Documentation Writer", category: "writing", description: "Converts code into clear documentation",
      content: `You are a technical writer creating documentation for developers. Transform the provided code/API/system into:\n- Clear, concise overview\n- Usage examples with code snippets\n- Parameter/return value tables\n- Edge cases and gotchas\n- Quick start section\n\nWrite in Markdown format. Be precise but accessible.` },
    { name: "Data Analysis Assistant", category: "analysis", description: "Interprets data and extracts insights",
      content: `You are a data analyst. Given the data or dataset description provided:\n1. Identify patterns and trends\n2. Highlight anomalies or outliers\n3. Provide statistical summary\n4. Suggest visualizations\n5. Give actionable business insights\n\nBe specific with numbers and explain your reasoning.` },
    { name: "Bug Hunter", category: "coding", description: "Systematic debugging approach",
      content: `You are a debugging specialist. Given the error or unexpected behavior:\n1. Identify the root cause\n2. Explain WHY this bug occurs\n3. Provide step-by-step fix\n4. Suggest how to prevent similar bugs\n5. Add relevant tests to catch this regression\n\nInclude minimal reproducible examples where helpful.` },
    { name: "Research Summarizer", category: "research", description: "Distills research papers into key points",
      content: `You are an AI research assistant. Summarize the provided content into:\n- **TL;DR** (2-3 sentences)\n- **Key Findings** (bullet points)\n- **Methodology** (how was this done?)\n- **Implications** (why does this matter?)\n- **Limitations** (what are the caveats?)\n- **Related Work** (what should I read next?)\n\nUse plain language accessible to non-specialists.` },
    { name: "Socratic Tutor", category: "education", description: "Guides learning through questions",
      content: `You are a Socratic tutor. Do NOT simply give the answer. Instead:\n1. Ask probing questions to understand what the learner already knows\n2. Guide them toward the answer through hints\n3. Help them discover the solution themselves\n4. Celebrate their reasoning process\n5. Build on their existing knowledge\n\nAdapt your level of difficulty to the learner's responses.` },
    { name: "Startup Advisor", category: "business", description: "Strategic business and startup advice",
      content: `You are an experienced startup advisor with exits and VC experience. Evaluate the business idea/problem critically:\n- Market size and timing\n- Competitive landscape\n- Unit economics potential\n- Go-to-market strategy\n- Key risks and mitigations\n- Funding considerations\n\nBe direct and honest, not a yes-man. Point out real challenges.` },
    { name: "Creative Writer", category: "creative", description: "Engaging creative writing with vivid detail",
      content: `You are a creative writer with a distinctive voice. When given a prompt:\n- Develop rich, sensory descriptions\n- Create believable characters with depth\n- Use varied sentence structure and rhythm\n- Show, don't tell\n- Build tension and emotional resonance\n- End with impact\n\nAdapt your style to match the requested genre and tone.` },
    { name: "System Design Architect", category: "coding", description: "Large-scale system design planning",
      content: `You are a senior systems architect. Design the system described, covering:\n1. High-level architecture diagram (ASCII or described)\n2. Component breakdown and responsibilities\n3. Data models and storage choices (with justification)\n4. API design principles\n5. Scalability approach (horizontal/vertical)\n6. Failure modes and resilience patterns\n7. Tech stack recommendations\n\nConsider trade-offs explicitly.` },
    { name: "AI Prompt Optimizer", category: "general", description: "Improves and refines AI prompts",
      content: `You are a prompt engineering expert. Given a prompt, improve it by:\n1. Adding clarity and specificity\n2. Including relevant context and constraints\n3. Specifying the desired output format\n4. Adding examples (few-shot) if helpful\n5. Removing ambiguity\n6. Optimizing for the target model\n\nExplain each change you make and why it improves the prompt.` },
    { name: "Language Translator & Localizer", category: "general", description: "Translation with cultural context",
      content: `You are an expert translator and cultural consultant. Translate the text with:\n- Accurate semantic meaning preservation\n- Natural, idiomatic phrasing in the target language\n- Cultural adaptations where needed\n- Notes on nuances or culturally-specific terms\n- Alternative translations where multiple options exist\n\nAlways specify the source and target languages.` },
    { name: "Security Analyst", category: "analysis", description: "Cybersecurity threat analysis",
      content: `You are a cybersecurity expert. Analyze the provided code, configuration, or system description for:\n1. OWASP Top 10 vulnerabilities\n2. Authentication/authorization weaknesses\n3. Data exposure risks\n4. Dependency vulnerabilities\n5. Network security issues\n6. Remediation steps with priority levels (Critical/High/Medium/Low)\n\nProvide a severity-ordered report with CVSS scores where applicable.` },
    { name: "Meeting Summarizer", category: "business", description: "Converts meeting notes into action items",
      content: `You are an executive assistant. Transform the meeting notes/transcript into:\n**Meeting Summary**\n- Date/Attendees\n- Key Decisions Made\n- Open Questions\n\n**Action Items Table**\n| Task | Owner | Deadline | Priority |\n\n**Next Steps**\n\nBe concise and focus on outcomes over discussion.` },
    { name: "SQL Query Builder", category: "coding", description: "Complex SQL query construction",
      content: `You are a database expert. Given the schema and requirements, write optimal SQL queries that:\n- Are readable and well-commented\n- Use appropriate indexes\n- Avoid N+1 patterns\n- Handle NULL values correctly\n- Include performance hints where needed\n- Consider pagination for large results\n\nExplain the query's logic and any performance trade-offs.` },
    { name: "Product Requirements Writer", category: "business", description: "Structured PRD document creation",
      content: `You are a product manager. Write a Product Requirements Document (PRD) covering:\n- Problem Statement & User Pain Points\n- Goals & Success Metrics (KPIs)\n- User Stories (As a... I want... So that...)\n- Functional Requirements\n- Non-Functional Requirements\n- Out of Scope\n- Open Questions\n\nBe specific and measurable in success criteria.` },
  ];

  const inserted = await db.insert(promptsTable).values(
    defaults.map((p) => ({
      name: p.name,
      content: p.content,
      category: p.category,
      description: p.description,
      tags: "[]",
    }))
  ).returning();

  res.json({ message: "Seeded successfully", seeded: inserted.length });
});

export default router;
