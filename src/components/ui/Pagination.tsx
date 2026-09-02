import { Button } from "./Button";

interface Props {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  busy?: boolean;
}

/**
 * Server-side pagination throughout. The rosters and reports grow with the
 * university, so nothing here fetches everything and pages client-side (§5.3).
 */
export function Pagination({ page, limit, total, onPage, busy }: Props) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-500">
        Showing <span className="font-medium text-ink-700">{first}</span>–
        <span className="font-medium text-ink-700">{last}</span> of{" "}
        <span className="font-medium text-ink-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => onPage(page - 1)}
          disabled={busy || page <= 1}
        >
          Previous
        </Button>
        <span className="px-1 text-sm text-ink-500">
          Page {page} of {pages}
        </span>
        <Button
          variant="secondary"
          onClick={() => onPage(page + 1)}
          disabled={busy || page >= pages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
