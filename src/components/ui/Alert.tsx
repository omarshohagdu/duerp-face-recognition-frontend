import type { ReactNode } from "react";

export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, { box: string; icon: string; glyph: string }> = {
  info: {
    box: "border-brand-100 bg-brand-50 text-ink-900",
    icon: "text-brand-600",
    glyph: "i",
  },
  success: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-950",
    icon: "text-emerald-600",
    glyph: "✓",
  },
  // A save with warnings is a success WITH A CAVEAT, not a failure (§7.5) —
  // that is what this neutral/attention tone is for.
  warning: {
    box: "border-amber-200 bg-amber-50 text-amber-950",
    icon: "text-amber-600",
    glyph: "!",
  },
  danger: {
    box: "border-rose-200 bg-rose-50 text-rose-950",
    icon: "text-rose-600",
    glyph: "!",
  },
  neutral: {
    box: "border-slate-200 bg-slate-50 text-ink-900",
    icon: "text-ink-500",
    glyph: "i",
  },
};

interface Props {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Alert({
  tone = "info",
  title,
  children,
  actions,
  className = "",
}: Props) {
  const t = TONES[tone];
  return (
    <div
      className={`rounded-lg border p-4 ${t.box} ${className}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold ${t.icon}`}
        >
          {t.glyph}
        </span>
        <div className="min-w-0 flex-1">
          {title && <p className="text-sm font-semibold">{title}</p>}
          {children && (
            <div className={`text-sm ${title ? "mt-1" : ""} opacity-90`}>
              {children}
            </div>
          )}
          {actions && (
            <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
          )}
        </div>
      </div>
    </div>
  );
}
