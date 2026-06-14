/**
 * BLOK M — Knowledge Graph (Bukan Sekedar RAG Flat)
 *
 * Routes:
 *  GET  /api/kg/entities         — list entities
 *  POST /api/kg/entities         — add entity
 *  GET  /api/kg/entities/:id     — get entity with relations
 *  POST /api/kg/relations        — add relation between entities
 *  POST /api/kg/extract          — auto-extract entities from text
 *  GET  /api/kg/search           — search entities
 *  GET  /api/kg/context          — get context for a query (graph traversal)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { kgEntitiesTable, kgRelationsTable, kgEntityChunksTable } from "@workspace/db";
import { eq, or, like, desc } from "drizzle-orm";
import { generateWithFallback } from "../lib/provider-chain.js";
import { eventBus } from "../lib/event-bus.js";

const router = Router();

// ── GET /api/kg/entities ───────────────────────────────────────────────────────

router.get("/kg/entities", async (req, res) => {
  try {
    const { limit = "100", search } = req.query as { limit?: string; search?: string };
    let rows;
    if (search) {
      rows = await db.select().from(kgEntitiesTable)
        .where(like(kgEntitiesTable.name, `%${search}%`))
        .orderBy(desc(kgEntitiesTable.updatedAt))
        .limit(Number(limit));
    } else {
      rows = await db.select().from(kgEntitiesTable)
        .orderBy(desc(kgEntitiesTable.updatedAt))
        .limit(Number(limit));
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/kg/entities ──────────────────────────────────────────────────────

router.post("/kg/entities", async (req, res) => {
  try {
    const { name, type, description } = req.body as { name: string; type: string; description?: string };
    if (!name || !type) return res.status(400).json({ error: "name and type required" });

    const [entity] = await db.insert(kgEntitiesTable).values({ name, type, description: description ?? null }).returning();
    eventBus.fire("kg_entity_added", { entityId: entity.id, name, type }, "kg_api");
    res.json(entity);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/kg/entities/:id ───────────────────────────────────────────────────

router.get("/kg/entities/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [entity] = await db.select().from(kgEntitiesTable).where(eq(kgEntitiesTable.id, id));
    if (!entity) return res.status(404).json({ error: "Entity not found" });

    const outgoing = await db.select().from(kgRelationsTable).where(eq(kgRelationsTable.fromId, id));
    const incoming = await db.select().from(kgRelationsTable).where(eq(kgRelationsTable.toId, id));
    const chunks   = await db.select().from(kgEntityChunksTable).where(eq(kgEntityChunksTable.entityId, id));

    res.json({ ...entity, outgoing, incoming, chunks });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/kg/relations ─────────────────────────────────────────────────────

router.post("/kg/relations", async (req, res) => {
  try {
    const { fromId, toId, relationType, weight = 1.0 } = req.body as {
      fromId: number; toId: number; relationType: string; weight?: number;
    };
    if (!fromId || !toId || !relationType) return res.status(400).json({ error: "fromId, toId, relationType required" });

    const [relation] = await db.insert(kgRelationsTable).values({ fromId, toId, relationType, weight }).returning();
    res.json(relation);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── POST /api/kg/extract ───────────────────────────────────────────────────────
// Auto-extract entities from text using LLM

router.post("/kg/extract", async (req, res) => {
  try {
    const { text, sourceId } = req.body as { text: string; sourceId?: number };
    if (!text) return res.status(400).json({ error: "text required" });

    const prompt = `Extract named entities and key concepts from this text. Return a JSON array only.

Text: "${text.slice(0, 2000)}"

Format:
[{"name": "EntityName", "type": "concept|technology|person|place|organization", "description": "brief description"}]

Extract entities now:`;

    const { text: llmOut } = await generateWithFallback(prompt, undefined, undefined, { maxTokens: 800 });

    // Parse JSON from LLM output
    const jsonMatch = llmOut.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.json({ extracted: [], message: "No entities found" });

    const entities = JSON.parse(jsonMatch[0]) as Array<{ name: string; type: string; description?: string }>;
    const saved: number[] = [];

    for (const ent of entities.slice(0, 20)) {
      if (!ent.name || !ent.type) continue;
      try {
        const [entity] = await db.insert(kgEntitiesTable)
          .values({ name: ent.name, type: ent.type, description: ent.description ?? null })
          .returning();
        saved.push(entity.id);

        if (sourceId) {
          await db.insert(kgEntityChunksTable).values({ entityId: entity.id, chunkId: sourceId });
        }

        eventBus.fire("kg_entity_added", { entityId: entity.id, name: ent.name, type: ent.type }, "kg_extract");
      } catch { /* may already exist */ }
    }

    res.json({ extracted: entities.length, saved: saved.length, entityIds: saved });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/kg/stats ──────────────────────────────────────────────────────────

router.get("/kg/stats", async (_req, res) => {
  try {
    const [entityRows, relationRows] = await Promise.all([
      db.select().from(kgEntitiesTable),
      db.select({ fromId: kgRelationsTable.fromId }).from(kgRelationsTable),
    ]);

    const types: Record<string, number> = {};
    for (const e of entityRows) {
      types[e.type] = (types[e.type] ?? 0) + 1;
    }

    res.json({
      totalEntities: entityRows.length,
      totalRelations: relationRows.length,
      types,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/kg/context ────────────────────────────────────────────────────────
// Graph traversal: find relevant entities + context for a query

router.get("/kg/context", async (req, res) => {
  try {
    const { q, depth = "2" } = req.query as { q: string; depth?: string };
    if (!q) return res.status(400).json({ error: "q query param required" });

    // Find matching entities
    const matchedEntities = await db.select().from(kgEntitiesTable)
      .where(or(
        like(kgEntitiesTable.name, `%${q}%`),
        like(kgEntitiesTable.description, `%${q}%`)
      ))
      .limit(5);

    if (matchedEntities.length === 0) return res.json({ entities: [], context: "" });

    // Traverse relations (BFS up to depth)
    const visited = new Set<number>();
    const queue = matchedEntities.map((e) => ({ entity: e, currentDepth: 0 }));
    const contextEntities: typeof matchedEntities = [];

    const maxDepth = Math.min(Number(depth), 3);

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      if (visited.has(item.entity.id)) continue;
      visited.add(item.entity.id);
      contextEntities.push(item.entity);

      if (item.currentDepth < maxDepth) {
        const relations = await db.select().from(kgRelationsTable)
          .where(or(
            eq(kgRelationsTable.fromId, item.entity.id),
            eq(kgRelationsTable.toId, item.entity.id)
          ))
          .limit(10);

        for (const rel of relations) {
          const neighborId = rel.fromId === item.entity.id ? rel.toId : rel.fromId;
          if (!visited.has(neighborId)) {
            const [neighbor] = await db.select().from(kgEntitiesTable).where(eq(kgEntitiesTable.id, neighborId));
            if (neighbor) queue.push({ entity: neighbor, currentDepth: item.currentDepth + 1 });
          }
        }
      }
    }

    const context = contextEntities
      .map((e) => `${e.name} (${e.type}): ${e.description ?? ""}`)
      .join("\n");

    res.json({ entities: contextEntities, context });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
