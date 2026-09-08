import { useCallback, useEffect, useState } from "react";
import { useAdminKey } from "../lib/adminKey";
import { classifyLogs, networkFailure, type Failure } from "../lib/errors";
import { fullDateTime, relativeTime } from "../lib/format";
import * as api from "../pages/attendanceApi";
import type { LogFileRow } from "../types/attendance";
import { AdminKeyGate } from "./AdminKeyGate";
import { LogDetail } from "./LogDetail";
import { PageHeader } from "./PageHeader";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Modal } from "./ui/Modal";
import { Pagination } from "./ui/Pagination";
import { Spinner } from "./ui/Spinner";
import { Table, Td, Th } from "./ui/Table";

const LIMIT = 20;

interface Props {
  source: api.LogSource;
  title: string;
  description: string;
  /** Column head for the id — it means different things per folder. */
  idLabel: string;
  idPlaceholder: string;
  /** Shown when the folder is empty, not when a filter matched nothing. */
  emptyTitle: string;
  emptyDetail: string;
  /** `route:` is one constant value in the login folder; no point as a column. */
  showRoute?: boolean;
}

/**
 * Shared body of the two step-log screens.
 *
 * §9 applies here more than anywhere else in the app: these files are the raw
 * diagnostic record — client IPs, GPS, employee ids, full request and response
 * bodies. They are shown VERBATIM and never parsed into friendly copy, because
 * the whole reason to open one is that something did not behave as the friendly
 * copy claimed. The screen's job is to find the right file and get out of the
 * way.
 *
 * The listing never fetches file contents; one file is read only when opened.
 */
export function LogViewer({
  source,
  title,
  description,
  idLabel,
  idPlaceholder,
  emptyTitle,
  emptyDetail,
  showRoute = true,
}: Props) {
  const [adminKey] = useAdminKey();

  const [personId, setPersonId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Committed filter values. The inputs above are drafts; the list reloads when
  // these change, so typing a date one digit at a time does not fire four
  // requests with nonsense ranges.
  const [applied, setApplied] = useState({
    personId: "",
    fromDate: "",
    toDate: "",
  });

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<LogFileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const [open, setOpen] = useState<LogFileRow | null>(null);

  const load = useCallback(async () => {
    if (!adminKey) return; // nothing to send yet; the key prompt is showing
    setLoading(true);
    setFailure(null);
    try {
      const res = await api.logList({
        source,
        adminKey,
        personId: applied.personId,
        fromDate: applied.fromDate,
        toDate: applied.toDate,
        page,
        limit: LIMIT,
      });
      const body = res.data;
      if (body?.success === true) {
        setRows(body.files ?? []);
        setTotal(body.total ?? 0);
      } else {
        setFailure(classifyLogs(res));
        setRows([]);
        setTotal(0);
      }
    } catch {
      setFailure(networkFailure());
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [source, adminKey, applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1); // a filtered result set is shorter; page 4 of it may not exist
    setApplied({ personId, fromDate, toDate });
  }

  function clearFilters() {
    setPersonId("");
    setFromDate("");
    setToDate("");
    setPage(1);
    setApplied({ personId: "", fromDate: "", toDate: "" });
  }

  const filtered =
    applied.personId !== "" || applied.fromDate !== "" || applied.toDate !== "";

  return (
    <div>
      <PageHeader title={title} description={description} />

      {/* Everything below needs the admin key; the gate renders the prompt
          instead when it is missing or the server rejected it. */}
      <AdminKeyGate
        unlocks="read the logs"
        failure={failure}
        onUnlock={() => setFailure(null)}
      >
        <Card
          title="Filters"
          actions={
            <Button
              variant="secondary"
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh
            </Button>
          }
        >
          <form
            onSubmit={applyFilters}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-48 flex-1">
              <label className="field-label" htmlFor="log-person">
                {idLabel}
              </label>
              <input
                id="log-person"
                className="field-input font-mono"
                value={personId}
                placeholder={idPlaceholder}
                onChange={(e) => setPersonId(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="log-from">
                From
              </label>
              <input
                id="log-from"
                type="date"
                className="field-input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="log-to">
                To
              </label>
              <input
                id="log-to"
                type="date"
                className="field-input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              Apply
            </Button>
            {filtered && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </form>
        </Card>

        <Card
          className="mt-6"
          title={`${total} ${total === 1 ? "entry" : "entries"}`}
        >
          {failure ? (
            <Alert
              tone="danger"
              title={failure.title}
              actions={
                failure.retryable && (
                  <Button onClick={() => void load()}>Try again</Button>
                )
              }
            >
              {failure.detail}
            </Alert>
          ) : loading ? (
            <div className="flex items-center gap-3 py-8 text-sm text-ink-500">
              <Spinner /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? "Nothing matched those filters" : emptyTitle}
            >
              {filtered
                ? "Try a wider date range, or clear the filters."
                : emptyDetail}
            </EmptyState>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>{idLabel}</Th>
                    {showRoute && <Th>Call</Th>}
                    <Th className="text-right">Size</Th>
                    {/* The View button's column. The label is on the span,
                        not the cell: `sr-only` is absolutely positioned, and
                        applying it to the <th> itself takes the cell out of the
                        table's layout. */}
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.file}>
                      <Td title={fullDateTime(isoOf(row.logged_at))}>
                        <time dateTime={isoOf(row.logged_at)}>
                          {relativeTime(isoOf(row.logged_at))}
                        </time>
                      </Td>
                      <Td className="font-mono text-xs">{row.person_id}</Td>
                      {showRoute && (
                        <Td className="text-xs text-ink-500">
                          {row.route ?? "—"}
                        </Td>
                      )}
                      <Td className="text-right tabular-nums text-ink-500">
                        {formatBytes(row.size_bytes)}
                      </Td>
                      <Td className="text-right">
                        <Button variant="ghost" onClick={() => setOpen(row)}>
                          View
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <Pagination
                page={page}
                limit={LIMIT}
                total={total}
                onPage={setPage}
                busy={loading}
              />
            </>
          )}
        </Card>
      </AdminKeyGate>

      <LogFileModal
        source={source}
        adminKey={adminKey}
        row={open}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

/** `YYYY-MM-DD HH:MM:SS` -> something `new Date()` parses as local time. */
function isoOf(loggedAt: string): string {
  return loggedAt.replace(" ", "T");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * The file itself, fetched on open. Rendered in a `<pre>` exactly as written:
 * the timestamps, the redactions and the line order are the evidence.
 */
function LogFileModal({
  source,
  adminKey,
  row,
  onClose,
}: {
  source: api.LogSource;
  adminKey: string;
  row: LogFileRow | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // A photo opened from inside the log, shown over it. Escape closes only this
  // one — `ui/Modal` tracks which modal is on top (§ the stack there).
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    let live = true;
    setContent(null);
    setTruncated(false);
    setFailure(null);
    setPhoto(null);
    setLoading(true);

    void (async () => {
      try {
        const res = await api.logFile({ source, adminKey, file: row.file });
        if (!live) return;
        const body = res.data;
        if (body?.success === true) {
          setContent(body.content ?? "");
          setTruncated(body.truncated === true);
        } else {
          setFailure(classifyLogs(res));
        }
      } catch {
        if (live) setFailure(networkFailure());
      } finally {
        if (live) setLoading(false);
      }
    })();

    // Reopening a different row while the first is in flight must not paint the
    // first file's body under the second file's heading.
    return () => {
      live = false;
    };
  }, [row, source, adminKey]);

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={row?.file ?? "Log"}
      // The detail view is tables of request and response fields; at the
      // default width they wrapped to unreadability on a laptop.
      size="lg"
    >
      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm font-semibold break-all text-ink-900">
              {row?.file}
            </h2>
            {row && (
              <p className="mt-1 text-xs text-ink-500">
                {fullDateTime(isoOf(row.logged_at))}
                {row.route ? ` · ${row.route}` : ""}
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

        {truncated && (
          <Alert tone="warning" className="mb-3" title="Shown in part">
            This file is over the 512 KB the server returns. Read the rest on
            the box.
          </Alert>
        )}

        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.detail}
          </Alert>
        ) : loading ? (
          <div className="flex items-center gap-3 py-8 text-sm text-ink-500">
            <Spinner /> Loading…
          </div>
        ) : content !== null ? (
          <LogDetail content={content} onOpenImage={setPhoto} />
        ) : null}
      </div>

      {/* Nested on purpose: closing the photo must return to the log, not
          discard it. */}
      <Modal
        open={photo !== null}
        onClose={() => setPhoto(null)}
        title="Attendance photo"
      >
        {photo && (
          <img
            src={photo}
            alt="Attendance photo, full size"
            className="max-h-[80vh] rounded-lg"
          />
        )}
      </Modal>
    </Modal>
  );
}
