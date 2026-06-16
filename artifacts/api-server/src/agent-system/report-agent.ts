/**
 * DLavie OS — Report Agent
 *
 * Handles all incoming user reports autonomously:
 * 1. Polls bot_tickets table for unprocessed reports (from Telegram .report command)
 * 2. Uses AI to categorize: bug / feature request / question / praise
 * 3. Determines priority: critical / high / medium / low
 * 4. Writes agent_notes with analysis + suggested action
 * 5. Updates ticket status to in_progress
 * 6. Sends digest mail to boss with summary + action items
 * 7. Can coordinate with other agents (e.g. ask quality-agent to test reported issue)
 */

import { db } from "@workspace/db";
import { botTicketsTable, agentMailTable } from "@workspace/db/schema";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { BaseAgent } from "./base-agent.js";

type TicketCategory = "bug" | "feature_request" | "question" | "praise" | "other";
type TicketPriority = "low" | "medium" | "high" | "critical";

interface TicketAnalysis {
  category:      TicketCategory;
  priority:      TicketPriority;
  summary:       string;
  suggestedAction: string;
  sentiment:     "negative" | "neutral" | "positive";
}

export class ReportAgent extends BaseAgent {
  private processedThisSession = new Set<number>();

  constructor() {
    super({
      id:             "report",
      displayName:    "📋 Report Agent",
      tickIntervalMs: 90 * 1000, // every 90 seconds — fast response to user reports
    });
  }

  protected async tick() {
    // Get all open/unprocessed tickets
    const openTickets = await db
      .select()
      .from(botTicketsTable)
      .where(eq(botTicketsTable.status, "open"))
      .orderBy(botTicketsTable.createdAt)
      .limit(10);

    const unprocessed = openTickets.filter(t => !this.processedThisSession.has(t.id));

    if (unprocessed.length === 0) {
      return; // Nothing to do
    }

    this.log(`Processing ${unprocessed.length} new ticket(s)…`);

    const processed: Array<{ ticket: typeof unprocessed[0]; analysis: TicketAnalysis }> = [];

    for (const ticket of unprocessed) {
      try {
        this.log(`Analyzing ticket #${ticket.id}: "${ticket.title}"`);
        const analysis = await this.analyzeTicket(ticket);

        // Write AI analysis into agent_notes and update status
        const notes = [
          `[Report Agent Analysis]`,
          `Category: ${analysis.category}`,
          `Priority: ${analysis.priority}`,
          `Sentiment: ${analysis.sentiment}`,
          ``,
          `Summary: ${analysis.summary}`,
          ``,
          `Suggested Action: ${analysis.suggestedAction}`,
          ``,
          `Processed at: ${new Date().toISOString()}`,
        ].join("\n");

        await db
          .update(botTicketsTable)
          .set({
            status:     "in_progress",
            priority:   analysis.priority,
            agentNotes: notes,
            updatedAt:  new Date(),
          })
          .where(eq(botTicketsTable.id, ticket.id));

        this.processedThisSession.add(ticket.id);
        processed.push({ ticket, analysis });
        this.log(`✅ Ticket #${ticket.id}: ${analysis.category} / ${analysis.priority}`);

        await this.recordMetric("ticket_processed", 1, analysis.category, {
          ticketId: ticket.id,
          priority: analysis.priority,
        });
      } catch (e) {
        this.logError(`Failed to process ticket #${ticket.id}: ${String(e)}`);
      }
    }

    if (processed.length === 0) return;

    // Group by category for mail summary
    const bugs     = processed.filter(p => p.analysis.category === "bug");
    const features = processed.filter(p => p.analysis.category === "feature_request");
    const criticals = processed.filter(p => p.analysis.priority === "critical");

    const mailLines = [
      `Report Agent processed ${processed.length} ticket(s) from users.`,
      ``,
    ];

    if (criticals.length > 0) {
      mailLines.push(`🚨 **CRITICAL ISSUES (${criticals.length}):**`);
      for (const { ticket, analysis } of criticals) {
        mailLines.push(`  • #${ticket.id} [${ticket.platform}] — ${ticket.title}`);
        mailLines.push(`    From: ${ticket.fromName}`);
        mailLines.push(`    Action: ${analysis.suggestedAction}`);
      }
      mailLines.push("");
    }

    if (bugs.length > 0) {
      mailLines.push(`🐛 **Bugs (${bugs.length}):**`);
      for (const { ticket, analysis } of bugs) {
        mailLines.push(`  • #${ticket.id} [${analysis.priority}] — ${ticket.title}`);
        mailLines.push(`    ${analysis.summary}`);
      }
      mailLines.push("");
    }

    if (features.length > 0) {
      mailLines.push(`✨ **Feature Requests (${features.length}):**`);
      for (const { ticket, analysis } of features) {
        mailLines.push(`  • #${ticket.id} — ${ticket.title}`);
        mailLines.push(`    ${analysis.summary}`);
      }
      mailLines.push("");
    }

    const others = processed.filter(p => !["bug", "feature_request"].includes(p.analysis.category));
    if (others.length > 0) {
      mailLines.push(`💬 **Other (${others.length}):** ${others.map(p => `#${p.ticket.id}`).join(", ")}`);
    }

    await this.sendMail({
      subject:  `📋 ${processed.length} Ticket(s) Processed${criticals.length > 0 ? ` — ${criticals.length} CRITICAL` : ""}`,
      body:     mailLines.join("\n"),
      priority: criticals.length > 0 ? "critical" : bugs.length > 0 ? "high" : "normal",
      metadata: {
        processed: processed.length,
        bugs:      bugs.length,
        features:  features.length,
        criticals: criticals.length,
      },
    });
  }

  private async analyzeTicket(ticket: typeof botTicketsTable.$inferSelect): Promise<TicketAnalysis> {
    const prompt = [
      `Analyze this user report from a bot user and return structured JSON.`,
      ``,
      `Platform: ${ticket.platform}`,
      `Title: ${ticket.title}`,
      `Description: ${ticket.description}`,
      `Steps to reproduce: ${ticket.steps || "Not provided"}`,
      ``,
      `Return ONLY valid JSON in this exact format:`,
      `{`,
      `  "category": "bug" | "feature_request" | "question" | "praise" | "other",`,
      `  "priority": "low" | "medium" | "high" | "critical",`,
      `  "summary": "one sentence summary of the issue",`,
      `  "suggestedAction": "one sentence recommended action",`,
      `  "sentiment": "negative" | "neutral" | "positive"`,
      `}`,
    ].join("\n");

    try {
      const text     = await this.think(prompt, "You are a support ticket analyzer. Return ONLY valid JSON.");
      const jsonStr  = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
      const parsed   = JSON.parse(jsonStr) as TicketAnalysis;

      // Validate fields
      const validCategories: TicketCategory[] = ["bug", "feature_request", "question", "praise", "other"];
      const validPriorities: TicketPriority[] = ["low", "medium", "high", "critical"];

      return {
        category:        validCategories.includes(parsed.category) ? parsed.category : "other",
        priority:        validPriorities.includes(parsed.priority) ? parsed.priority : "medium",
        summary:         parsed.summary?.slice(0, 200) || ticket.title,
        suggestedAction: parsed.suggestedAction?.slice(0, 200) || "Review and respond to user",
        sentiment:       ["negative","neutral","positive"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
      };
    } catch {
      // Fallback analysis based on keywords
      const text = `${ticket.title} ${ticket.description}`.toLowerCase();
      return {
        category:        text.includes("bug") || text.includes("error") || text.includes("crash") ? "bug"
                       : text.includes("feature") || text.includes("add") || text.includes("want") ? "feature_request"
                       : "question",
        priority:        text.includes("crash") || text.includes("urgent") || text.includes("critical") ? "high" : "medium",
        summary:         ticket.title,
        suggestedAction: "Review ticket and respond to user",
        sentiment:       text.includes("great") || text.includes("love") || text.includes("thank") ? "positive"
                       : text.includes("hate") || text.includes("terrible") || text.includes("awful") ? "negative"
                       : "neutral",
      };
    }
  }
}
