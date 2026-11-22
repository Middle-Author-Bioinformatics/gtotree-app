import { Loader2 } from "lucide-react";

interface Props { state: string; }

const MAP: Record<string, { cls: string; label: string }> = {
  pending:   { cls: "pill-pending",  label: "queued"    },
  queued:    { cls: "pill-pending",  label: "queued"    },
  running:   { cls: "pill-running",  label: "running"   },
  succeeded: { cls: "pill-success",  label: "succeeded" },
  failed:    { cls: "pill-failed",   label: "failed"    },
  skipped:   { cls: "pill-skipped",  label: "skipped"   },
};

export function StatePill({ state }: Props) {
  const m = MAP[state] || MAP.pending;
  return (
    <span className={m.cls}>
      {state === "running" && <Loader2 size={12} className="animate-spin" />}
      {m.label}
    </span>
  );
}
