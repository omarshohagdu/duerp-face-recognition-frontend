/**
 * Turn a step-log file into something renderable.
 *
 * The files are written by `utils/step_logger.rs` in a fixed shape:
 *
 *   route: ext-api/wow-attendance/verify
 *   id: 2020111007
 *   started_at: 2026-09-08 11:06:43.606
 *   endpoint: POST /ext-api/wow-attendance/verify
 *   ----
 *   Params:
 *     query: {"id":"2020111007"}
 *
 *   Steps:
 *     [11:06:43.607] request received (client_ip=127.0.0.1)
 *
 *   Images:
 *     /uploads/wow_attendance/live/uuid_live.jpg
 *
 *   Response (AI /recognize) 400: {...}
 *   Response (backend) 200: {...}
 *
 * PARSING IS BEST-EFFORT AND MUST STAY THAT WAY. The writer is free to add
 * sections, and a log this cannot fully parse is still the evidence someone
 * opened the screen to read — so anything unrecognised is kept verbatim in
 * `unparsed`, and the raw file is always one toggle away. Never let a parse
 * miss hide a line.
 */

export interface LogEntry {
  label: string;
  /** Raw text as written. */
  raw: string;
  /** Parsed JSON when `raw` was JSON, else undefined. */
  json?: unknown;
}

export interface LogStep {
  /** `11:06:43.607`, or undefined for a line that carried no timestamp. */
  time?: string;
  text: string;
}

export interface LogResponse {
  /** `AI /recognize`, `backend`, … — whatever the writer put in brackets. */
  source: string;
  status?: string;
  raw: string;
  json?: unknown;
}

export interface ParsedLog {
  /** route / id / started_at / endpoint and anything else above the `----`. */
  head: { label: string; value: string }[];
  params: LogEntry[];
  steps: LogStep[];
  images: string[];
  responses: LogResponse[];
  /** Lines belonging to no recognised section. Rendered verbatim. */
  unparsed: string[];
}

/** Parse when the text is JSON, else undefined. Never throws. */
export function tryJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * A JSON *string* that is itself JSON — `device_info` is exactly this, a JSON
 * object serialised into a form field. Rendering it as one long escaped string
 * is the difference between reading the GPS fix and not.
 */
export function tryNestedJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  return tryJson(value);
}

const STEP_LINE = /^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s*(.*)$/;
const RESPONSE_LINE = /^Response\s*\(([^)]*)\)\s*(\d{3})?\s*:\s*([\s\S]*)$/;
const HEAD_LINE = /^([a-z_]+):\s*(.*)$/;

type Section = "head" | "params" | "steps" | "images" | null;

export function parseLog(content: string): ParsedLog {
  const out: ParsedLog = {
    head: [],
    params: [],
    steps: [],
    images: [],
    responses: [],
    unparsed: [],
  };

  const lines = content.split("\n");
  let section: Section = "head";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed === "----") continue;

    // Section headers are written flush left; their contents are indented.
    if (trimmed === "Params:") {
      section = "params";
      continue;
    }
    if (trimmed === "Steps:") {
      section = "steps";
      continue;
    }
    if (trimmed === "Images:") {
      section = "images";
      continue;
    }

    // Responses are flush-left one-liners that can appear after any section,
    // so they are matched before the section dispatch rather than inside it.
    const response = RESPONSE_LINE.exec(trimmed);
    if (response && !line.startsWith("  ")) {
      const raw = response[3] ?? "";
      out.responses.push({
        source: response[1] ?? "",
        status: response[2],
        raw,
        json: tryJson(raw),
      });
      section = null;
      continue;
    }

    switch (section) {
      case "head": {
        const head = HEAD_LINE.exec(trimmed);
        if (head) out.head.push({ label: head[1], value: head[2] ?? "" });
        else out.unparsed.push(line);
        break;
      }
      case "params": {
        // `query: {...}` / `form: {...}` / `json: {...}`
        const at = trimmed.indexOf(":");
        if (at > 0) {
          const raw = trimmed.slice(at + 1).trim();
          out.params.push({
            label: trimmed.slice(0, at).trim(),
            raw,
            json: tryJson(raw),
          });
        } else {
          out.unparsed.push(line);
        }
        break;
      }
      case "steps": {
        const step = STEP_LINE.exec(trimmed);
        // A wrapped continuation line has no timestamp; keep it as its own row
        // rather than dropping it, so nothing the writer emitted disappears.
        out.steps.push(
          step ? { time: step[1], text: step[2] ?? "" } : { text: trimmed },
        );
        break;
      }
      case "images":
        out.images.push(trimmed);
        break;
      default:
        out.unparsed.push(line);
    }
  }

  return out;
}

/**
 * Every image path the log mentions, deduped, in the order they appear.
 *
 * Not just the `Images:` block: `verify` also names the stored capture inside a
 * step line (`File: … | url: /uploads/…`) and in its response body, and those
 * are sometimes the only place a path appears when a call failed before the
 * block was written.
 */
export function imagePathsOf(parsed: ParsedLog, content: string): string[] {
  const found = new Set<string>(parsed.images);
  for (const match of content.matchAll(
    /\/uploads\/wow_attendance\/[^\s"'|,}\\)]+/g,
  )) {
    found.add(match[0]);
  }
  return [...found];
}
