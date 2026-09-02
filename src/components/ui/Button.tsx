import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300 disabled:text-ink-500",
  secondary:
    "bg-white text-ink-900 border border-slate-300 shadow-sm hover:bg-slate-50 disabled:text-ink-400",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:text-ink-400",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-slate-300",
};

const SIZES: Record<Size, string> = {
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3.5 text-base",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        block ? "w-full" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
