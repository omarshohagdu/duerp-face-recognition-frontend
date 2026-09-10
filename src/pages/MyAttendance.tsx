import { useCallback, useEffect, useState } from "react";
import { LiveImageThumb } from "../components/LiveImageThumb";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { Table, Td, Th } from "../components/ui/Table";
import { useAuth } from "../hooks/useAuth";
import { classifyMyAttendance, networkFailure, type Failure } from "../lib/errors";
import { dateOnly, describeRange, timeOnly, toIsoDate, today } from "../lib/format";
import type { AttendanceRecord } from "../types/attendance";
import * as api from "./attendanceApi";

const LIMIT = 20;

/** First of the current month — the range someone actually wants on arrival. */
function startOfMonth(): string {
  const now = new Date();
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

/**
 * The member's own attendance history — `reports/by-person`, run against the
 * signed-in person and nobody else.
 *
 * WHY THIS IS A SEPARATE SCREEN from `AttendanceReports` rather than that page
 * with the ID field disabled: the admin page also carries the by-date tab,
 * which lists the whole university. Sharing the route would mean one component
 * hiding a tab by role, and the hidden tab is one `useState` away from being
 * reachable. A separate route keeps the member's screen incapable of asking
 * for anyone else's records — there is no input that takes an id.
 *
 * That separation is now the ONLY thing keeping a member off other people's
 * records. The server used to reject a `person_id` that was not the token's
 * `sub` unless the caller presented the admin key; that check went with the
 * key, so `reports/by-person` answers for anyone a valid token asks about. A
 * hand-made request is no longer stopped — only this screen's shape is.
 */
export function MyAttendance() {
  const { session } = useAuth();
  const personId = session?.personId ?? "";

  const [fromDate, setFromDate] = useState(startOfMonth);
  const [toDate, setToDate] = useState(today);
  // Committed range. The inputs above are drafts, so typing a date one digit at
  // a time does not fire a request per keystroke with a half-built range.
  const [applied, setApplied] = useState({ from: startOfMonth(), to: today() });

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AttendanceRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setFailure(null);
    try {
      const res = await api.reportByPerson({
        personId,
        fromDate: applied.from,
        toDate: applied.to,
        page,
        limit: LIMIT,
      });
      if (res.data?.success === true) {
        setRows(res.data.data.list ?? []);
        setTotal(res.data.data.total ?? 0);
      } else {
        setFailure(classifyMyAttendance(res));
        setRows(null);
        setTotal(0);
      }
    } catch {
      setFailure(networkFailure());
      setRows(null);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [personId, applied, page]);

  // Runs on arrival, unlike the admin screen's Run button: there is nothing to
  // type first here, so an empty table with a button would just be an extra
  // click between the user and the only answer this page has.
  useEffect(() => {
    void load();
  }, [load]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setPage(1); // a shorter range may not have the page currently shown
    setApplied({ from: fromDate, to: toDate });
  }

  return (
    <div>
      <PageHeader
        title="My attendance"
        description="Your own check-ins. Only successful ones are recorded — a rejected attempt is not stored."
      />

      <Card title="Date range">
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="field-label" htmlFor="my-from">
              From
            </label>
            <input
              id="my-from"
              type="date"
              className="field-input"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="my-to">
              To
            </label>
            {/* Both dates are required and both are INCLUSIVE (§6.2). */}
            <input
              id="my-to"
              type="date"
              className="field-input"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading || !fromDate || !toDate}>
            {loading && <Spinner className="size-4" />}
            Show
          </Button>
        </form>
      </Card>

      <Card
        className="mt-6"
        title={`${total} ${total === 1 ? "check-in" : "check-ins"}`}
        description={describeRange(applied.from, applied.to)}
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
        ) : loading && rows === null ? (
          <div className="flex items-center gap-3 py-8 text-sm text-ink-500">
            <Spinner /> Loading…
          </div>
        ) : rows === null || rows.length === 0 ? (
          <EmptyState
            title={`No check-ins ${describeRange(applied.from, applied.to)}`}
          >
            Try widening the date range.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Time</Th>
                  <Th>Photo</Th>
                </tr>
              </thead>
              <tbody>
                {/* No Name or ID column: every row is this one person, and
                    `id_type` is a property of the account, not of the check-in
                    — neither tells the user anything they do not know. */}
                {rows.map((row) => (
                  <tr key={row.record_id}>
                    <Td className="whitespace-nowrap">
                      {dateOnly(row.created_at)}
                    </Td>
                    <Td className="tabular-nums">{timeOnly(row.created_at)}</Td>
                    <Td>
                      <LiveImageThumb
                        path={row.live_image}
                        alt={session?.displayName ?? "Check-in photo"}
                        onOpen={setLightbox}
                      />
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

      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        title="Check-in photo"
      >
        {lightbox && (
          <img
            src={lightbox}
            alt="Your check-in photo, full size"
            className="max-h-[80vh] rounded-lg"
          />
        )}
      </Modal>
    </div>
  );
}
