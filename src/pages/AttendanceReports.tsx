import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { LiveImageThumb } from "../components/LiveImageThumb";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { Table, Td, Th } from "../components/ui/Table";
import { classifyAdmin, networkFailure, type Failure } from "../lib/errors";
import { dateOnly, describeRange, timeOnly, today } from "../lib/format";
import type { AttendanceRecord, IdType } from "../types/attendance";
import * as api from "./attendanceApi";

const LIMIT = 20;

/**
 * Two endpoints, two genuinely different screens — not one table with a toggle
 * (§6). They answer different questions ("who checked in this week?" vs "when
 * did *this person* check in?"), take different required inputs, and put `name`
 * in different places.
 */
type Mode = "by-date" | "by-person";

export function AttendanceReports() {
  const [mode, setMode] = useState<Mode>("by-date");

  // The date range is held here rather than inside each screen so a drill-down
  // from a by-date row can carry it across (§6.3).
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [personId, setPersonId] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  function drillDown(id: string) {
    setPersonId(id);
    setMode("by-person");
  }

  return (
    <div>
      <PageHeader
        title="Attendance report"
        description="Only successful check-ins are recorded — rejected attempts are not stored."
      />

      <div
        role="tablist"
        aria-label="Report type"
        className="mb-4 inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
      >
        {(
          [
            ["by-date", "By date range"],
            ["by-person", "By person"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              mode === value
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-900",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "by-date" ? (
        <ByDateReport
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={setFromDate}
          onToDate={setToDate}
          onDrillDown={drillDown}
          onOpenPhoto={setLightbox}
        />
      ) : (
        <ByPersonReport
          fromDate={fromDate}
          toDate={toDate}
          personId={personId}
          onFromDate={setFromDate}
          onToDate={setToDate}
          onPersonId={setPersonId}
          onOpenPhoto={setLightbox}
        />
      )}

      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        title="Check-in photo"
      >
        {lightbox && (
          <img
            src={lightbox}
            alt="Check-in photo, full size"
            className="max-h-[80vh] rounded-lg"
          />
        )}
      </Modal>
    </div>
  );
}

/** Shared date inputs. Both dates are required and both are INCLUSIVE (§6.2). */
function DateRangeFields({
  fromDate,
  toDate,
  onFromDate,
  onToDate,
}: {
  fromDate: string;
  toDate: string;
  onFromDate: (v: string) => void;
  onToDate: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label className="field-label" htmlFor="from-date">
          From (inclusive)
        </label>
        {/* A native date input emits a strict YYYY-MM-DD value. The API rejects
            anything else with `Invalid from_date/to_date`, so a locale-
            formatted string must never reach it (§6.2). */}
        <input
          id="from-date"
          type="date"
          className="field-input"
          value={fromDate}
          max={toDate || undefined}
          onChange={(e) => onFromDate(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="to-date">
          To (inclusive)
        </label>
        <input
          id="to-date"
          type="date"
          className="field-input"
          value={toDate}
          min={fromDate || undefined}
          onChange={(e) => onToDate(e.target.value)}
        />
      </div>
    </>
  );
}

function ByDateReport({
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  onDrillDown,
  onOpenPhoto,
}: {
  fromDate: string;
  toDate: string;
  onFromDate: (v: string) => void;
  onToDate: (v: string) => void;
  onDrillDown: (id: string) => void;
  onOpenPhoto: (url: string) => void;
}) {
  /** undefined = "All", which means OMIT the parameter, not send "" (§6.2). */
  const [idType, setIdType] = useState<IdType | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AttendanceRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [ran, setRan] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  // Dates are required — keep Run disabled rather than firing a request that
  // 400s (§6.2).
  const canRun = Boolean(fromDate && toDate);

  async function run(nextPage = 1) {
    if (!canRun || loading) return;
    setLoading(true);
    setFailure(null);
    setPage(nextPage);
    try {
      const res = await api.reportByDate({
        fromDate,
        toDate,
        idType,
        page: nextPage,
        limit: LIMIT,
      });
      if (res.data?.success === true) {
        setRows(res.data.data.list ?? []);
        setTotal(res.data.data.total ?? 0);
        setRan({ from: fromDate, to: toDate });
      } else {
        setFailure(classifyAdmin(res));
        setRows(null);
      }
    } catch {
      setFailure(networkFailure());
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DateRangeFields
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={onFromDate}
          onToDate={onToDate}
        />
        <div>
          <label className="field-label" htmlFor="type-filter">
            Type
          </label>
          <select
            id="type-filter"
            className="field-input"
            value={idType ?? ""}
            onChange={(e) =>
              setIdType((e.target.value || undefined) as IdType | undefined)
            }
          >
            <option value="">All</option>
            <option value="Student">Students</option>
            <option value="Employee">Employees</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button block onClick={() => void run(1)} disabled={!canRun || loading}>
            {loading && <Spinner className="size-4" />}
            Run
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.detail}
          </Alert>
        ) : rows === null ? (
          <EmptyState title="Choose a date range and select Run">
            Both dates are included in the results.
          </EmptyState>
        ) : rows.length === 0 ? (
          // An empty list with total 0 is not an error — name the range and
          // leave the filters visible so it can be widened (§6.5).
          <EmptyState
            title={`No check-ins ${ran ? describeRange(ran.from, ran.to) : ""}`}
          >
            Try widening the date range or clearing the type filter.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Time</Th>
                  <Th>Name</Th>
                  <Th>ID</Th>
                  <Th>Type</Th>
                  <Th>Photo</Th>
                </tr>
              </thead>
              <tbody>
                {/* Rows come newest first, already sorted server-side. No
                    column sorting is offered — it would only sort the current
                    page. And neither `matched` nor `confidence` is a column:
                    both are constants, and a "100%" badge on every row is a
                    number the user would believe (§6.1, §6.2). */}
                {rows.map((row) => (
                  <tr key={row.record_id}>
                    <Td className="whitespace-nowrap">
                      {dateOnly(row.created_at)}
                    </Td>
                    <Td className="tabular-nums">{timeOnly(row.created_at)}</Td>
                    <Td className="font-medium">
                      {row.id ? (
                        <button
                          type="button"
                          className="text-brand-700 hover:underline"
                          onClick={() => onDrillDown(row.id!)}
                        >
                          {row.name ?? row.id}
                        </button>
                      ) : (
                        (row.name ?? "—")
                      )}
                    </Td>
                    <Td className="font-mono text-xs">{row.id ?? "—"}</Td>
                    <Td>{row.id_type}</Td>
                    <Td>
                      <LiveImageThumb
                        path={row.live_image}
                        alt={row.name ?? row.id ?? "check-in"}
                        onOpen={onOpenPhoto}
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
              onPage={(p) => void run(p)}
              busy={loading}
            />
          </>
        )}
      </div>
    </Card>
  );
}

function ByPersonReport({
  fromDate,
  toDate,
  personId,
  onFromDate,
  onToDate,
  onPersonId,
  onOpenPhoto,
}: {
  fromDate: string;
  toDate: string;
  personId: string;
  onFromDate: (v: string) => void;
  onToDate: (v: string) => void;
  onPersonId: (v: string) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AttendanceRecord[] | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [ran, setRan] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const canRun = Boolean(personId.trim() && fromDate && toDate);

  async function run(nextPage = 1) {
    if (!canRun || loading) return;
    setLoading(true);
    setFailure(null);
    setPage(nextPage);
    try {
      const res = await api.reportByPerson({
        personId: personId.trim(),
        fromDate,
        toDate,
        page: nextPage,
        limit: LIMIT,
      });
      if (res.data?.success === true) {
        setRows(res.data.data.list ?? []);
        // For by-person the name comes back ONCE at the top level, not per row
        // (§6), so it belongs in the header rather than in a column.
        setName(res.data.data.name ?? null);
        setTotal(res.data.data.total ?? 0);
        setRan({ from: fromDate, to: toDate });
      } else {
        setFailure(classifyAdmin(res));
        setRows(null);
      }
    } catch {
      setFailure(networkFailure());
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="field-label" htmlFor="report-person-id">
            Person ID
          </label>
          {/* There is no search by name anywhere in this API — the ID must be
              known. Pairing this with the check-enrolled lookup on the Enrolled
              screen is the workable path from "who is this?" (§6.3). */}
          <input
            id="report-person-id"
            className="field-input font-mono"
            value={personId}
            placeholder="2002033008"
            onChange={(e) => onPersonId(e.target.value)}
          />
        </div>
        <DateRangeFields
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={onFromDate}
          onToDate={onToDate}
        />
        <div className="flex items-end">
          <Button block onClick={() => void run(1)} disabled={!canRun || loading}>
            {loading && <Spinner className="size-4" />}
            Run
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {failure ? (
          <Alert tone="danger" title={failure.title}>
            {failure.detail}
          </Alert>
        ) : rows === null ? (
          <EmptyState title="Enter a person ID and date range, then select Run" />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-lg font-semibold">{name ?? "Unknown"}</h2>
              <span className="font-mono text-sm text-ink-500">
                {personId.trim()}
              </span>
              <span className="text-sm text-ink-500">
                · {total} {total === 1 ? "check-in" : "check-ins"}
              </span>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title={`No check-ins ${ran ? describeRange(ran.from, ran.to) : ""}`}
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
                      <Th>Type</Th>
                      <Th>Photo</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Same table minus Name and ID — both are in the header
                        above (§6.3). */}
                    {rows.map((row) => (
                      <tr key={row.record_id}>
                        <Td className="whitespace-nowrap">
                          {dateOnly(row.created_at)}
                        </Td>
                        <Td className="tabular-nums">
                          {timeOnly(row.created_at)}
                        </Td>
                        <Td>{row.id_type}</Td>
                        <Td>
                          <LiveImageThumb
                            path={row.live_image}
                            alt={name ?? personId}
                            onOpen={onOpenPhoto}
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
                  onPage={(p) => void run(p)}
                  busy={loading}
                />
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
