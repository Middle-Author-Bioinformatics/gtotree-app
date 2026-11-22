import { useMemo, useState } from "react";
import {
  GTOTREE_OPTION_GROUPS, countChangedOptions,
  type AdvancedOptions as AdvOpts, type GtOptionDef,
} from "../lib/gtotree-config";
import { cn } from "../lib/utils";
import { ChevronDown } from "lucide-react";

interface Props {
  options: AdvOpts;
  setOptions: (o: AdvOpts) => void;
  defaults: AdvOpts;
}

/** Collapsible "Advanced GToTree options" block. Hidden by default. */
export function AdvancedOptions({ options, setOptions, defaults }: Props) {
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const changed = useMemo(() => countChangedOptions(options), [options]);

  const set = (key: string, val: number | boolean | string) =>
    setOptions({ ...options, [key]: val });
  const resetAll = () => setOptions({ ...defaults });

  return (
    <div className="rounded-xl border border-border bg-surface-2/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold flex items-center gap-2">
            Advanced options
            {changed > 0 && (
              <span className="pill border-accent/40 bg-accent/10 text-accent">
                {changed} changed
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={cn("text-fg-subtle transition-transform shrink-0", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 animate-fade-in">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={resetAll}
              disabled={changed === 0}
              className="btn-ghost py-1 text-xs shrink-0">
              Reset
            </button>
          </div>

          {GTOTREE_OPTION_GROUPS.map((g) => {
            const groupOpen = openGroups[g.id] ?? false;
            const groupChanged = g.options.filter((d) => {
              const v = options[d.key];
              return d.kind === "bool"
                ? v === true && d.default !== true
                : String(v) !== String(d.default);
            }).length;
            return (
              <div key={g.id} className="rounded-lg border border-border-soft bg-surface/60">
                <button
                  type="button"
                  onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !groupOpen }))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left">
                  <ChevronDown
                    size={14}
                    className={cn("text-fg-subtle transition-transform shrink-0", groupOpen && "rotate-180")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold flex items-center gap-2">
                      {g.title}
                      {groupChanged > 0 && (
                        <span className="text-accent font-mono text-[10px]">·{groupChanged}</span>
                      )}
                    </div>
                  </div>
                </button>
                {groupOpen && (
                  <div className="px-3 pb-3 pt-0 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3 animate-fade-in">
                    {g.options.map((def) => (
                      <OptionField
                        key={def.key}
                        def={def}
                        value={options[def.key]}
                        onChange={(v) => set(def.key, v)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OptionField({ def, value, onChange }: {
  def: GtOptionDef;
  value: number | boolean | string;
  onChange: (v: number | boolean | string) => void;
}) {
  const isDefault = def.kind === "bool"
    ? (value === true) === (def.default === true)
    : String(value) === String(def.default);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[11px] font-medium truncate" title={def.help}>{def.label}</span>
        {!isDefault && <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" title="changed from default" />}
        <span className="text-[9px] uppercase tracking-wider text-fg-faint shrink-0 font-mono">{def.flag}</span>
      </div>

      {def.kind === "bool" ? (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-[rgb(var(--accent))] h-4 w-4"
          />
          <span className="text-[11px] text-fg-subtle">{value === true ? "enabled" : "disabled"}</span>
        </label>
      ) : def.kind === "select" ? (
        <select
          className="field py-1.5 text-sm"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}>
          {(def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : def.kind === "text" ? (
        <input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="field py-1.5 text-sm font-mono"
        />
      ) : (
        <input
          type="number"
          inputMode="decimal"
          step={def.step ?? 1}
          min={def.min ?? undefined}
          max={def.max ?? undefined}
          value={String(value)}
          onChange={(e) => {
            const n = e.target.value === "" ? def.default : Number(e.target.value);
            onChange(typeof n === "number" && Number.isFinite(n) ? n : (def.default as number));
          }}
          className="field py-1.5 text-sm font-mono"
        />
      )}

    </div>
  );
}
