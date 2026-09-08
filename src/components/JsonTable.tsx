import { tryNestedJson } from "../lib/logParse";

/**
 * Render a parsed JSON value as nested key/value tables.
 *
 * Why a table and not pretty-printed JSON: these bodies are read to answer one
 * question at a time — what was the similarity score, which building was
 * matched, what did the AI actually say — and a table gives every field a
 * consistent place on the row rather than a place that moves with nesting
 * depth. The raw text is still one toggle away for anyone who needs the bytes.
 */
export function JsonTable({ value }: { value: unknown }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <tbody>
          <Rows value={value} />
        </tbody>
      </table>
    </div>
  );
}

function Rows({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <EmptyRow label="(empty list)" />;
    return (
      <>
        {value.map((item, i) => (
          <Row key={i} label={`${i}`} value={item} />
        ))}
      </>
    );
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return <EmptyRow label="(empty)" />;
    return (
      <>
        {keys.map((key) => (
          <Row key={key} label={key} value={value[key]} />
        ))}
      </>
    );
  }

  // A bare primitive at the top level — rare, but a response body can be a
  // plain string (`"Login failed at external API"`).
  return <Row label="value" value={value} />;
}

function Row({ label, value }: { label: string; value: unknown }) {
  // `device_info` arrives as a JSON object serialised into a string. Unwrapping
  // it here is what turns an unreadable escaped blob into the GPS fix and the
  // device the check-in came from.
  const nested = tryNestedJson(value);
  const expandable = nested !== undefined || isRecord(value) || Array.isArray(value);

  return (
    <tr className="align-top">
      <th
        scope="row"
        className="w-48 border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-left font-mono text-xs font-medium break-words text-ink-500"
      >
        {label}
      </th>
      <td className="border-b border-slate-100 px-3 py-2">
        {expandable ? (
          <div className="rounded-lg border border-slate-200">
            <table className="w-full border-collapse">
              <tbody>
                <Rows value={nested ?? value} />
              </tbody>
            </table>
          </div>
        ) : (
          <Primitive value={value} />
        )}
      </td>
    </tr>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <tr>
      <td className="px-3 py-2 text-xs text-ink-400">{label}</td>
    </tr>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-xs text-ink-400">null</span>;

  if (typeof value === "boolean") {
    // `matched`, `success` and `is_active` are the fields people scan for, so
    // they get a shape the eye finds without reading.
    return (
      <span
        className={[
          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
          value
            ? "bg-emerald-50 text-emerald-700"
            : "bg-rose-50 text-rose-700",
        ].join(" ")}
      >
        {String(value)}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="font-mono text-xs tabular-nums">{value}</span>;
  }

  const text = String(value);
  if (text === "") return <span className="text-xs text-ink-400">(empty)</span>;

  // Long values (base64-ish ids, stack traces, absolute paths) wrap rather than
  // stretching the table past the modal.
  return <span className="font-mono text-xs break-all whitespace-pre-wrap">{text}</span>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
