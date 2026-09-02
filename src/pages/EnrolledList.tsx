import { useCallback, useEffect, useState } from "react";
import { ManualEnrollForm } from "../components/ManualEnrollForm";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { Table, Td, Th } from "../components/ui/Table";
import { classifyAdmin, networkFailure, type Failure } from "../lib/errors";
import { fullDateTime, relativeTime } from "../lib/format";
import type {
  CheckEnrolledResponse,
  EnrolledRow,
  IdType,
} from "../types/attendance";
import * as api from "./attendanceApi";

const TAB_STORAGE_KEY = "duerp_enrolled_tab";
const LIMIT = 20;

export function EnrolledList() {
  /**
   * `id_type` is REQUIRED — there is no "all people" query, and the two lists
   * paginate independently, so an "All" tab firing two requests and merging
   * them would report a page count that is simply wrong (§5.1). The screen
   * therefore opens on a segmented control, never on an unfiltered table.
   */
  const [idType, setIdType] = useState<IdType>(
    () =>
      (localStorage.getItem(TAB_STORAGE_KEY) as IdType | null) ?? "Employee",
  );
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<EnrolledRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<Failure | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const res = await api.enrolledList({ idType, page, limit: LIMIT });
      const body = res.data;
      if (body?.success === true) {
        setRows(body.data.list ?? []);
        setTotal(body.data.total ?? 0);
      } else {
        setFailure(classifyAdmin(res));
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
  }, [idType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function switchTab(next: IdType) {
    setIdType(next);
    setPage(1);
    localStorage.setItem(TAB_STORAGE_KEY, next); // persist the last-used tab (§5.1)
  }

  return (
    <div>
      <PageHeader
        title="Enrolled people"
        description="Who has registered a face."
      />

      <Card
        title={
          <div
            role="tablist"
            aria-label="Person type"
            className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
          >
            {(["Student", "Employee"] as const).map((option) => (
              <button
                key={option}
                role="tab"
                aria-selected={idType === option}
                onClick={() => switchTab(option)}
                className={[
                  "rounded-md px-4 py-1.5 text-sm font-medium transition",
                  idType === option
                    ? "bg-white text-ink-900 shadow-sm"
                    : "text-ink-500 hover:text-ink-900",
                ].join(" ")}
              >
                {option === "Student" ? "Students" : "Employees"}
              </button>
            ))}
          </div>
        }
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      >
        {/* §5.3: the endpoint takes only id_type, page and limit. A search box
            here could only filter the current page, which is worse than none —
            it looks like it searched everything. The single-person lookup below
            is the real answer. */}
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
            title={`No ${idType === "Student" ? "students" : "employees"} have enrolled yet`}
          >
            People appear here once they register a face.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>ID</Th>
                  <Th className="text-right">Photos</Th>
                  <Th>Enrolled</Th>
                </tr>
              </thead>
              <tbody>
                {/* `is_active` is deliberately not a column: re-enrollment
                    retires the previous row and this list only surfaces current
                    enrollments, so it would show one value forever (§5.2). */}
                {rows.map((row) => (
                  <tr key={row.enrollment_id}>
                    <Td className="font-medium">{row.name ?? "—"}</Td>
                    {/* Monospace — these get copied into support tickets. */}
                    <Td className="font-mono text-xs">{row.id}</Td>
                    <Td className="text-right tabular-nums">
                      {row.image_count}
                    </Td>
                    <Td title={fullDateTime(row.enrolled_at)}>
                      <time dateTime={row.enrolled_at}>
                        {relativeTime(row.enrolled_at)}
                      </time>
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

      <CheckEnrolledLookup />

      {/* A successful enroll changes the roster above, so reload it rather
          than leaving a list that no longer matches the database. */}
      <ManualEnrollForm onEnrolled={() => void load()} />
    </div>
  );
}

/**
 * §5.4 — the right control for "is *this* person enrolled?", and the workable
 * path an admin has from "who is this?" to a decision, given there is no search
 * anywhere in this API.
 */
function CheckEnrolledLookup() {
  const [personId, setPersonId] = useState("");
  const [result, setResult] = useState<CheckEnrolledResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const id = personId.trim();
    if (!id || loading) return;

    setLoading(true);
    setResult(null);
    setFailure(null);
    try {
      const res = await api.checkEnrolled(id);
      // Both outcomes are 200 and `success` mirrors `enrolled`, so a
      // `success: false` here means "not enrolled" — an answer, not an error.
      // A missing person_id is the only 400 (§5.4).
      if (res.status === 400) {
        setFailure(classifyAdmin(res));
      } else {
        setResult(res.data);
      }
    } catch {
      setFailure(networkFailure());
    } finally {
      setLoading(false);
    }
  }

  const enrolled = result?.enrolled === true;
  const data = result?.data;

  return (
    <Card
      className="mt-6"
      title="Check one person"
      description="Look up a single student or employee by ID."
    >
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="field-label" htmlFor="check-person-id">
            Person ID
          </label>
          <input
            id="check-person-id"
            className="field-input font-mono"
            value={personId}
            placeholder="2002033008"
            onChange={(e) => setPersonId(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={loading || !personId.trim()}>
          {loading && <Spinner className="size-4" />}
          Check
        </Button>
      </form>

      {failure && (
        <Alert tone="danger" className="mt-4" title={failure.title}>
          {failure.detail}
        </Alert>
      )}

      {result && (
        <div className="mt-4">
          {enrolled ? (
            <Alert tone="success" title="Enrolled">
              <dl className="mt-1 space-y-1">
                <div className="flex gap-2">
                  <dt className="text-ink-500">ID</dt>
                  <dd className="font-mono">{data?.id}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-500">Photos</dt>
                  <dd>{data?.image_count}</dd>
                </div>
                {data?.enrolled_at && (
                  <div className="flex gap-2">
                    <dt className="text-ink-500">Enrolled</dt>
                    <dd title={fullDateTime(data.enrolled_at)}>
                      {relativeTime(data.enrolled_at)}
                    </dd>
                  </div>
                )}
                {data?.version != null && data.version > 1 && (
                  <div className="flex gap-2">
                    <dt className="text-ink-500">Updated</dt>
                    <dd>
                      {data.version - 1}{" "}
                      {data.version - 1 === 1 ? "time" : "times"}
                    </dd>
                  </div>
                )}
              </dl>
            </Alert>
          ) : (
            // Nothing else is offered here on purpose: an admin cannot enroll
            // on someone's behalf — enroll only ever registers the token
            // holder's own face (§2.2, §5.4).
            <Alert tone="neutral" title="Not enrolled">
              No active enrollment for{" "}
              <span className="font-mono">{personId.trim()}</span>. They need to
              register their own face — it can't be done for them.
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
}
