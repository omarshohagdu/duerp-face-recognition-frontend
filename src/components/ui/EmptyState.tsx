import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {children && <p className="mt-1 text-sm text-ink-500">{children}</p>}
    </div>
  );
}
