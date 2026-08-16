import { CheckCircle2, Loader2, Clock, AlertCircle, MinusCircle } from "lucide-react";

interface Props { state: string; }

const MAP: Record<string, { cls: string; icon: any; label: string }> = {
  pending:   { cls: "pill-pending",  icon: Clock,        label: "queued"    },
  queued:    { cls: "pill-pending",  icon: Clock,        label: "queued"    },
  running:   { cls: "pill-running",  icon: Loader2,      label: "running"   },
  succeeded: { cls: "pill-success",  icon: CheckCircle2, label: "succeeded" },
  failed:    { cls: "pill-failed",   icon: AlertCircle,  label: "failed"    },
  skipped:   { cls: "pill-skipped",  icon: MinusCircle,  label: "skipped"   },
};

export function StatePill({ state }: Props) {
  const m = MAP[state] || MAP.pending;
  const Icon = m.icon;
  return (
    <span className={m.cls}>
      <Icon size={12} className={state === "running" ? "animate-spin" : ""} />
      {m.label}
    </span>
  );
}
