import { useEffect, useState } from "react";
import { liveImageUrl, MISSING_IMAGE_HINT } from "../lib/liveImage";

interface Props {
  path: string | null | undefined;
  alt: string;
  onOpen?: (url: string) => void;
}

/**
 * The captured face is the evidence behind an attendance record, so it should
 * be reachable — but not dominant (§6.4). Hence a small avatar that opens full
 * size on click.
 *
 * Records written before the 2026-08-19 uploads move point at a folder that no
 * longer holds the file, so some of these WILL 404. A placeholder is the right
 * answer: the attendance record is still valid, and a broken-image icon reads
 * as if it isn't.
 */
export function LiveImageThumb({ path, alt, onOpen }: Props) {
  const url = liveImageUrl(path);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <span
        title={MISSING_IMAGE_HINT}
        aria-label={MISSING_IMAGE_HINT}
        className="flex size-10 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-ink-400"
      >
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 6.5a8 8 0 1 1 16 0v.5H4V19Z"
          />
        </svg>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(url)}
      className="rounded-full transition hover:opacity-80"
      aria-label={`View photo — ${alt}`}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-10 rounded-full border border-slate-200 object-cover"
      />
    </button>
  );
}
