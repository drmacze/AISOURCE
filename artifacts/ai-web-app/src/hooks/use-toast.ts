import { useState, useCallback } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

let toastFn: ((toast: Omit<Toast, "id">) => void) | null = null;

export function useToast() {
  const toast = useCallback((opts: Omit<Toast, "id">) => {
    if (toastFn) {
      toastFn(opts);
    } else {
      console.log(`[toast] ${opts.title}${opts.description ? ": " + opts.description : ""}`);
    }
  }, []);

  return { toast };
}
