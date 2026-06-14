/**
 * BLOK G — Event Bus (Sistem Reaktif)
 *
 * Replaces timer-only system with event-driven architecture.
 * Agents can emit and listen to events. All events stored in DB for audit.
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { systemEventsTable } from "@workspace/db";

// ─── Event types ──────────────────────────────────────────────────────────────

export type SystemEventType =
  | "feedback_received"        // BLOK A: user gave 👍/👎
  | "model_created"            // BLOK F: new model created via AI Forge
  | "quality_drop_detected"    // BLOK C: model score dropped after training
  | "quality_rise_detected"    // BLOK C: model score improved
  | "dataset_threshold_hit"    // trigger training when enough samples collected
  | "benchmark_completed"      // BLOK B: benchmark run finished
  | "training_completed"       // training job finished
  | "training_failed"          // training job failed
  | "error_rate_spike"         // BLOK K: high error rate detected
  | "golden_test_failed"       // BLOK N: golden test set score below threshold
  | "plateau_detected"         // BLOK F: quality plateau — need new data
  | "project_milestone"        // BLOK D: project milestone reached
  | "agent_task_completed"     // agent finished a task
  | "distillation_ready"       // BLOK H: distillation dataset ready
  | "red_team_attack_found"    // BLOK K: adversarial vulnerability found
  | "kg_entity_added"          // BLOK M: knowledge graph entity added
  | "uncertainty_map_ready";   // BLOK J: active learning uncertainty map ready

export interface SystemEventPayload {
  eventType: SystemEventType;
  source: string;
  data?: Record<string, unknown>;
}

// ─── In-process emitter ────────────────────────────────────────────────────────

class DLavieEventBus extends EventEmitter {
  private persistEnabled = true;

  async emit(event: SystemEventType, payload: Record<string, unknown>, source = "system"): Promise<boolean> {
    // Persist to DB for audit trail
    if (this.persistEnabled) {
      try {
        await db.insert(systemEventsTable).values({
          eventType: event,
          source,
          payload,
          handled: "no",
        });
      } catch (e) {
        console.warn("[EventBus] Failed to persist event:", String(e));
      }
    }

    // Emit in-process to all listeners
    return super.emit(event, payload);
  }

  /** Emit without awaiting DB persist (fire-and-forget) */
  fire(event: SystemEventType, payload: Record<string, unknown>, source = "system"): void {
    void this.emit(event, payload, source);
  }

  disablePersist() { this.persistEnabled = false; }
  enablePersist()  { this.persistEnabled = true; }
}

export const eventBus = new DLavieEventBus();
eventBus.setMaxListeners(50);

// ─── SSE clients for real-time dashboard feed ─────────────────────────────────

type SSEEventClient = { send: (event: string, data: unknown) => void };
export const eventSSEClients = new Set<SSEEventClient>();

function broadcastToSSE(eventType: string, data: unknown) {
  for (const client of eventSSEClients) {
    try { client.send(eventType, data); }
    catch { eventSSEClients.delete(client); }
  }
}

// Bridge all events to SSE clients
eventBus.on("feedback_received", (d) => broadcastToSSE("feedback_received", d));
eventBus.on("model_created", (d) => broadcastToSSE("model_created", d));
eventBus.on("quality_drop_detected", (d) => broadcastToSSE("quality_drop_detected", d));
eventBus.on("benchmark_completed", (d) => broadcastToSSE("benchmark_completed", d));
eventBus.on("training_completed", (d) => broadcastToSSE("training_completed", d));
eventBus.on("error_rate_spike", (d) => broadcastToSSE("error_rate_spike", d));
eventBus.on("golden_test_failed", (d) => broadcastToSSE("golden_test_failed", d));
eventBus.on("plateau_detected", (d) => broadcastToSSE("plateau_detected", d));
eventBus.on("red_team_attack_found", (d) => broadcastToSSE("red_team_attack_found", d));
