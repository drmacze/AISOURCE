import { useEffect, useRef } from "react";
import { toast } from "sonner";

type TrainingEvent =
  | { type: "cycle_complete"; cycleNumber: number; samplesAdded: number; totalSamples: number; breakdown: Record<string, number>; at: string }
  | { type: "cycle_start"; cycleNumber: number; at: string }
  | { type: "cycle_error"; cycleNumber: number; error: string; at: string }
  | { type: "heartbeat"; at: string };

export function useTrainingNotifications() {
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    function connect() {
      if (!active) return;
      const es = new EventSource("/api/autotraining/events");
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data as string) as TrainingEvent;
          handleEvent(event);
        } catch {
          // skip malformed
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (active) {
          reconnectTimer.current = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);
}

function formatBreakdown(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([src, n]) => `${src}: +${n}`)
    .join(" · ");
}

function handleEvent(event: TrainingEvent) {
  switch (event.type) {
    case "cycle_complete": {
      const detail = formatBreakdown(event.breakdown);
      toast.success(`Auto-Training Cycle #${event.cycleNumber} Selesai`, {
        description: detail
          ? `+${event.samplesAdded} sampel baru · ${detail}`
          : `+${event.samplesAdded} sampel baru (total ${event.totalSamples})`,
        duration: 8000,
        icon: "🧠",
      });
      break;
    }
    case "cycle_start": {
      toast.info(`Siklus Training #${event.cycleNumber} Dimulai`, {
        description: "Mengumpulkan data dari 12+ sumber...",
        duration: 4000,
        icon: "⚙️",
      });
      break;
    }
    case "cycle_error": {
      toast.error(`Training Cycle #${event.cycleNumber} Gagal`, {
        description: event.error.slice(0, 120),
        duration: 10000,
        icon: "❌",
      });
      break;
    }
    case "heartbeat":
      break;
  }
}
