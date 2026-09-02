import type { ReactNode } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    // Wide tables scroll inside their own container so the page body never
    // scrolls horizontally.
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold tracking-wide text-ink-500 uppercase ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={`border-b border-slate-100 px-4 py-3 align-middle text-ink-900 ${className}`}
    >
      {children}
    </td>
  );
}
