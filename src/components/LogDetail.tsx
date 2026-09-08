import { useMemo, useState } from "react";
import { liveImageUrl, MISSING_IMAGE_HINT } from "../lib/liveImage";
import { imagePathsOf, parseLog } from "../lib/logParse";
import { JsonTable } from "./JsonTable";
import { Button } from "./ui/Button";

/**
 * A step log, rendered as its sections instead of one wall of text.
 *
 * THE RAW FILE STAYS ONE CLICK AWAY, and that is not decoration. These files
 * are the evidence when a check-in is disputed, and the parser is best-effort
 * against a writer that is free to add sections (`lib/logParse.ts`). A parsed
 * view that quietly dropped a line it did not understand would be worse than no
 * parsed view at all — so anything unrecognised is rendered verbatim below, and
 * "Raw" shows the bytes exactly as written.
 */
export function LogDetail({
  content,
  onOpenImage,
}: {
  content: string;
  onOpenImage: (url: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => parseLog(content), [content]);
  const images = useMemo(
    () => imagePathsOf(parsed, content),
    [parsed, content],
  );

  if (raw) {
    return (
      <div>
        <Toggle raw={raw} onToggle={() => setRaw(false)} />
        <pre className="mt-3 max-h-[65vh] overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed whitespace-pre text-slate-100">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <Toggle raw={raw} onToggle={() => setRaw(true)} />

      <div className="mt-3 max-h-[65vh] space-y-6 overflow-auto pr-1">
        {parsed.head.length > 0 && (
          <Section title="Call">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {parsed.head.map((row) => (
                    <tr key={row.label} className="align-top">
                      <th
                        scope="row"
                        className="w-48 border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-left font-mono text-xs font-medium text-ink-500"
                      >
                        {row.label}
                      </th>
                      <td className="border-b border-slate-100 px-3 py-2 font-mono text-xs break-all">
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {parsed.params.map((param) => (
          <Section key={param.label} title={`Params — ${param.label}`}>
            {param.json !== undefined ? (
              <JsonTable value={param.json} />
            ) : (
              <RawBlock text={param.raw} />
            )}
          </Section>
        ))}

        {images.length > 0 && (
          <Section title={`Images (${images.length})`}>
            <ImageStrip paths={images} onOpen={onOpenImage} />
          </Section>
        )}

        {parsed.steps.length > 0 && (
          <Section title="Steps">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {parsed.steps.map((step, i) => (
                    <tr key={i} className="align-top">
                      <td className="w-32 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 font-mono text-xs tabular-nums text-ink-500">
                        {step.time ?? ""}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-1.5 font-mono text-xs break-words">
                        {step.text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {parsed.responses.map((response, i) => (
          <Section
            key={i}
            title={`Response — ${response.source}`}
            badge={response.status}
          >
            {response.json !== undefined ? (
              <JsonTable value={response.json} />
            ) : (
              <RawBlock text={response.raw} />
            )}
          </Section>
        ))}

        {parsed.unparsed.length > 0 && (
          <Section title="Other lines">
            <RawBlock text={parsed.unparsed.join("\n")} />
          </Section>
        )}
      </div>
    </div>
  );
}

function Toggle({ raw, onToggle }: { raw: boolean; onToggle: () => void }) {
  return (
    <div className="flex justify-end">
      <Button variant="secondary" onClick={onToggle}>
        {raw ? "Show details" : "Show raw file"}
      </Button>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  // 2xx is not automatically good here: verify answers 200 with
  // `matched: false` for the two commonest real-world outcomes (§1), so the
  // badge is coloured by class only and the body is what decides.
  const bad = badge ? Number(badge) >= 400 : false;
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
        {title}
        {badge && (
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
              bad ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-ink-700",
            ].join(" ")}
          >
            {badge}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function RawBlock({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs whitespace-pre-wrap text-slate-100">
      {text}
    </pre>
  );
}

/**
 * Thumbnails for every image the log names. Some WILL 404 — records written
 * before the 2026-08-19 uploads move point at a folder that no longer holds the
 * file (§6.4) — so a failure renders a labelled placeholder, never a broken
 * image, and never something that reads as "this check-in was invalid".
 */
function ImageStrip({
  paths,
  onOpen,
}: {
  paths: string[];
  onOpen: (url: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-3">
      {paths.map((path) => (
        <li key={path}>
          <Thumb path={path} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

function Thumb({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (url: string) => void;
}) {
  const url = liveImageUrl(path);
  const [failed, setFailed] = useState(false);
  const name = path.split("/").pop() ?? path;

  if (!url || failed) {
    return (
      <div
        title={`${MISSING_IMAGE_HINT} — ${path}`}
        className="flex size-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2 text-center text-xs text-ink-400"
      >
        {MISSING_IMAGE_HINT}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      title={path}
      className="block rounded-lg transition hover:opacity-80"
      aria-label={`View ${name} full size`}
    >
      <img
        src={url}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-28 rounded-lg border border-slate-200 object-cover"
      />
    </button>
  );
}
