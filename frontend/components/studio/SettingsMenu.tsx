"use client";

/**
 * Settings.
 *
 * Five switches, deliberately. Each one changes how the interface reads, not
 * what the model computes — the planning knobs live next to the plan. Values
 * are written straight to CSS custom properties by the store, so nothing here
 * needs to re-render the map.
 */

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";

import { accents, type AccentId } from "@/lib/zoning/palette";
import { useStudio } from "@/store/useStudio";

const ACCENT_IDS = Object.keys(accents) as AccentId[];

export function SettingsMenu() {
  const settings = useStudio((s) => s.settings);
  const setSettings = useStudio((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Interface settings"
        className={`grid h-8 w-8 place-items-center rounded-md border transition-colors duration-150 ${
          open
            ? "border-line bg-raised text-ink"
            : "border-hairline bg-ground text-ink-3 hover:border-line hover:text-ink-2"
        }`}
      >
        <Settings2 size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Interface settings"
          className="absolute right-0 top-[calc(100%+6px)] w-[268px] rounded-lg border border-line bg-raised p-3 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.75)]"
          style={{ zIndex: 40 }}
        >
          <p className="eyebrow mb-3">Interface</p>

          <Field label="Accent" hint="Highlights, focus rings, selection">
            <div className="flex gap-1.5">
              {ACCENT_IDS.map((id) => {
                const on = settings.accent === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSettings({ accent: id })}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-[5px] border px-2 py-1.5 text-[11px] transition-colors duration-150 ${
                      on
                        ? "border-line bg-shell text-ink"
                        : "border-transparent text-ink-3 hover:bg-shell"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: accents[id].hex }}
                      aria-hidden="true"
                    />
                    {accents[id].label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Zone wash" hint="How strongly land use tints the map">
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={25}
                max={100}
                step={5}
                value={Math.round(settings.wash * 100)}
                onChange={(e) => setSettings({ wash: Number(e.target.value) / 100 })}
                className="flex-1 cursor-pointer accent-[var(--accent)]"
                aria-label="Zone wash opacity"
              />
              <span className="num w-8 text-right text-[11px] text-ink-3">
                {Math.round(settings.wash * 100)}%
              </span>
            </div>
          </Field>

          <Field label="Density" hint="Spacing of the surrounding panels">
            <Choice
              value={settings.density}
              options={[
                ["comfortable", "Comfortable"],
                ["compact", "Compact"],
              ]}
              onChange={(v) => setSettings({ density: v as "comfortable" | "compact" })}
            />
          </Field>

          <Field label="Motion" hint="Calm skips the flag pulse and camera dive">
            <Choice
              value={settings.motion}
              options={[
                ["full", "Full"],
                ["calm", "Calm"],
              ]}
              onChange={(v) => setSettings({ motion: v as "full" | "calm" })}
            />
          </Field>

          <label className="flex cursor-pointer items-center justify-between gap-3 pt-1">
            <span>
              <span className="block text-[12px] text-ink">Cell labels</span>
              <span className="block text-[10.5px] leading-tight text-ink-4">
                Shows the selected cell&rsquo;s grid reference when zoomed in
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.labels}
              onChange={(e) => setSettings({ labels: e.target.checked })}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5">
      <p className="text-[12px] text-ink">{label}</p>
      <p className="mb-1.5 text-[10.5px] leading-tight text-ink-4">{hint}</p>
      {children}
    </div>
  );
}

function Choice({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map(([id, label]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={on}
            className={`flex-1 rounded-[5px] border px-2 py-1.5 text-[11px] transition-colors duration-150 ${
              on
                ? "border-line bg-shell text-ink"
                : "border-transparent text-ink-3 hover:bg-shell"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
