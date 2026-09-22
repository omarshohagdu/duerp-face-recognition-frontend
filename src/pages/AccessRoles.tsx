import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { Table, Td, Th } from "../components/ui/Table";
import * as api from "../api/access";

/**
 * Access Roles — who may do what in this service.
 *
 * TWO THINGS THIS SCREEN IS NOT:
 *
 *  1. It is not the ERP's `/access-roles`. That one writes `ictcell` and no
 *     longer reaches the gate this service enforces (backend
 *     `docs/access_control.md` §2.1). This screen edits `attendance.*` — the
 *     tables `ext_api_can_call()` actually reads.
 *  2. It is not where permission is decided. Everything here is refused
 *     server-side without `admin.roles.manage` / `admin.users.manage`, and
 *     those endpoints enforce today rather than in audit mode. Hiding this
 *     screen would hide a link; the API is the gate.
 *
 * The permission set is saved WHOLE: an unticked box is a revocation, which is
 * what the API expects and why Save always sends every ticked key.
 *
 * WHY THE SCREEN IS SHAPED THE WAY IT IS
 * Every control here changes what somebody else can do, and most of it cannot
 * be undone by pressing back. So the screen is built around three rules:
 *
 *   * Nothing that revokes access happens on a single click. A role change, a
 *     deletion and a discarded edit each ask first, naming what is about to
 *     change.
 *   * Work is never lost silently. Edits are tracked against what was loaded,
 *     the difference is shown in words, and leaving with unsaved changes is
 *     interrupted.
 *   * A permission is never just a key. Each one carries its name, and the
 *     endpoints it opens are one hover away, because `wow.enroll` means
 *     nothing to the person deciding whether a card desk should have it.
 */

type Tab = "roles" | "people";

interface Failure {
  title: string;
  detail?: string;
}

/** The server's envelope, turned into something a human reads. */
function failureOf(env: { message?: string; code?: string }): Failure {
  const detail =
    env.code === "forbidden"
      ? "Your account does not hold admin.roles.manage or admin.users.manage."
      : env.code
        ? `(${env.code})`
        : undefined;
  return { title: env.message || "That did not work.", detail };
}

/**
 * Permissions this screen does not manage — a whole category, or one key.
 *
 * Everything listed here maps to ZERO endpoints in this service
 * (`ext_api_endpoint_permissions`), so ticking one changed nothing any gate
 * reads. It only made the picker longer and invited an administrator to think
 * they had granted something. `Course` is ERP vocabulary in its entirety;
 * `attendance.take` is one dead key inside a category whose other permissions
 * are live, which is why both shapes exist.
 *
 * CHECK BEFORE ADDING: a key with endpoints behind it must never be listed
 * here — hiding a live permission would leave no way to grant it.
 *
 *   select res.key,
 *          (select count(*) from attendance.ext_api_endpoint_permissions m
 *            where m.resource_key = res.key) as endpoints
 *     from attendance.resources res order by endpoints;
 *
 * HIDDEN, NOT DELETED, and the difference matters: roles currently hold these
 * grants (four hold Course keys, three hold `attendance.take`), and
 * `role-save` replaces the whole permission set. Dropping them from what the
 * screen sends would silently revoke them on the next unrelated save. So they
 * stay in `ticked` and go back exactly as they came — see `keptHidden` below,
 * which says so on screen rather than leaving a surprise in the database.
 * Removing them for real is a decision about the vocabulary itself, and
 * belongs in SQL, not in a screen.
 */
const HIDDEN_CATEGORIES = ["course"];
const HIDDEN_KEYS = ["attendance.take"];

/**
 * Retired roles — `is_active: false` on the server (backend `sql/008`).
 *
 * This replaced a hard-coded list in this file. A screen that hides rows its
 * own source names is a screen where "remove this role" means a deployment;
 * the flag lives in the database, an administrator flips it here, and the
 * audit trail records who did.
 *
 * Retiring is deliberately narrow: the role stops being ASSIGNABLE and
 * everybody already holding it keeps exactly what they had. So a retired role
 * is hidden rather than deleted — it is still doing its job for its holders —
 * and the list can show it again on request.
 */
function selectableRoles(roles: api.Role[]): api.Role[] {
  return roles.filter((r) => r.is_active);
}

function isHidden(r: api.Resource): boolean {
  return (
    HIDDEN_CATEGORIES.includes(r.category.trim().toLowerCase()) ||
    HIDDEN_KEYS.includes(r.key.trim().toLowerCase())
  );
}

/** The permission keys this screen does not show, for filtering by key alone. */
function hiddenKeysOf(resources: api.Resource[]): Set<string> {
  return new Set(resources.filter(isHidden).map((r) => r.key));
}

/**
 * Permissions, grouped the way the API categorises them.
 *
 * Shared by both tabs: the tick-box list and the per-person exception editor
 * show the same vocabulary in the same order, so a permission is in the same
 * place whichever screen you came from.
 */
function byCategory(resources: api.Resource[]): [string, api.Resource[]][] {
  const out = new Map<string, api.Resource[]>();
  for (const r of resources) {
    const list = out.get(r.category) ?? [];
    list.push(r);
    out.set(r.category, list);
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Free-text match over everything a permission is findable by. */
function matches(r: api.Resource, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    r.name.toLowerCase().includes(needle) ||
    r.key.toLowerCase().includes(needle) ||
    r.category.toLowerCase().includes(needle) ||
    r.endpoints.some((e) => e.toLowerCase().includes(needle))
  );
}

/** What a permission key opens, for the `title` tooltip. */
function endpointHint(r: api.Resource): string | undefined {
  return r.endpoints.length ? r.endpoints.join("\n") : undefined;
}

type ChipTone = "neutral" | "grant" | "deny";

const CHIP: Record<ChipTone, string> = {
  neutral: "bg-slate-100 text-ink-600",
  grant: "bg-emerald-100 text-emerald-800",
  deny: "bg-rose-100 text-rose-800",
};

function Chip({
  tone = "neutral",
  title,
  children,
}: {
  tone?: ChipTone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

/** A dismissible banner pair — success and failure look the same everywhere. */
function Banners({
  failure,
  notice,
  onDismiss,
}: {
  failure: Failure | null;
  notice: string | null;
  onDismiss: () => void;
}) {
  if (!failure && !notice) return null;
  return (
    <>
      {failure ? (
        <Alert
          tone="danger"
          title={failure.title}
          actions={
            <Button size="md" variant="secondary" onClick={onDismiss}>
              Dismiss
            </Button>
          }
        >
          {failure.detail}
        </Alert>
      ) : null}
      {notice ? (
        <Alert
          tone="success"
          actions={
            <Button size="md" variant="secondary" onClick={onDismiss}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}
    </>
  );
}

export function AccessRoles() {
  /**
   * The tab lives in the URL, not in component state, so a link to the People
   * tab is a link to the People tab — and Back steps between them instead of
   * leaving the screen.
   */
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "people" ? "people" : "roles";
  const setTab = (next: Tab) =>
    setParams(next === "people" ? { tab: "people" } : {});

  /**
   * Unsaved role edits, tracked here rather than inside the tab, because
   * switching tabs unmounts the editor and would drop them without a word.
   * `pending` holds what to do once the question is answered.
   */
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );

  const onDirty = useCallback((next: boolean) => setDirty(next), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access roles"
        description="Roles, what each one may do, and who holds them. Changes take effect on the next request — no restart."
      />

      <div
        role="tablist"
        aria-label="Access administration"
        className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
      >
        {(
          [
            ["roles", "Roles & permissions"],
            ["people", "People"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => guard(() => setTab(key))}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              tab === key
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-900",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "roles" ? (
        <RolesTab guard={guard} onDirty={onDirty} />
      ) : (
        <PeopleTab />
      )}

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Discard unsaved changes?"
      >
        <div className="space-y-4 p-4">
          <h2 className="text-base font-semibold text-ink-900">
            Discard unsaved changes?
          </h2>
          <p className="text-sm text-ink-600">
            This role has edits that have not been saved. Leaving now throws
            them away — nothing on the server has changed yet.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const run = pending;
                setPending(null);
                setDirty(false);
                run?.();
              }}
            >
              Discard changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------

/** Keys may only ever be `[a-z0-9_]`, so the field shapes what is typed. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function RolesTab({
  guard,
  onDirty,
}: {
  guard: (action: () => void) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [roles, setRoles] = useState<api.Role[]>([]);
  const [resources, setResources] = useState<api.Resource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [permFilter, setPermFilter] = useState("");
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<api.Role | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<api.Role | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const role = roles.find((r) => r.key === selected) ?? null;
  const creating = role === null;

  /**
   * What changed since the role was loaded, in the two forms the screen needs:
   * a boolean that gates Save and the discard prompt, and the actual keys, so
   * the difference can be stated rather than implied.
   */
  const baseline = useMemo(
    () => new Set(role?.permissions ?? []),
    [role],
  );
  const added = useMemo(
    () => [...ticked].filter((k) => !baseline.has(k)),
    [ticked, baseline],
  );
  const removed = useMemo(
    () => [...baseline].filter((k) => !ticked.has(k)),
    [ticked, baseline],
  );
  const dirty = role
    ? name.trim() !== role.name || added.length > 0 || removed.length > 0
    : newKey.trim() !== "" || name.trim() !== "" || ticked.size > 0;

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  // Leaving the tab must not leave the parent holding a stale "dirty".
  useEffect(() => () => onDirty(false), [onDirty]);

  function pick(r: api.Role) {
    setSelected(r.key);
    setNewKey("");
    setName(r.name);
    setTicked(new Set(r.permissions));
    setNotice(null);
  }

  function startNew() {
    setSelected(null);
    setNewKey("");
    setName("");
    setTicked(new Set());
    setNotice(null);
  }

  const load = useCallback(
    async (keep: string | null) => {
      setLoading(true);
      const [r, res] = await Promise.all([api.listRoles(), api.listResources()]);
      setLoading(false);
      if (r.status !== "success") return setFailure(failureOf(r));
      if (res.status !== "success") return setFailure(failureOf(res));
      setFailure(null);
      setRoles(r.data.roles);
      setResources(res.data.resources);

      const offered = selectableRoles(r.data.roles);
      const target =
        (keep ? offered.find((x) => x.key === keep) : undefined) ?? offered[0];
      if (target) pick(target);
      else startNew();
    },
    [],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggle(key: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setMany(keys: string[], on: boolean) {
    setTicked((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  const keyError =
    creating && newKey !== "" && !/^[a-z][a-z0-9_]*$/.test(newKey)
      ? "Start with a letter; then lower-case letters, digits and underscore only."
      : undefined;

  async function save() {
    const key = selected ?? newKey.trim();
    if (!key || !name.trim()) {
      return setFailure({ title: "A key and a name are both required." });
    }
    if (keyError) return setFailure({ title: keyError });
    setSaving(true);
    // The WHOLE set, every time: the API replaces what is stored, so an
    // unticked box is a revocation.
    const env = await api.saveRole(key, name.trim(), [...ticked]);
    setSaving(false);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(env.message);
    setSelected(key);
    await load(key);
  }

  async function setActive(r: api.Role, next: boolean) {
    setConfirmRetire(null);
    setSaving(true);
    const env = await api.setRoleActive(r.key, next);
    setSaving(false);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(env.message);
    // Keep the role selected either way: the admin has just acted on it and
    // may well want to act again.
    await load(r.key);
  }

  async function remove(r: api.Role) {
    setConfirmDelete(null);
    setSaving(true);
    const env = await api.deleteRole(r.key);
    setSaving(false);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(env.message);
    await load(null);
  }

  const selectable = useMemo(() => selectableRoles(roles), [roles]);
  const retiredCount = roles.length - selectable.length;
  const visibleRoles = roles.filter((r) => {
    // A retired role stays on screen while it is the one being edited —
    // retiring the open role should not make it vanish mid-edit.
    if (!r.is_active && !showRetired && r.key !== selected) return false;
    const q = roleFilter.trim().toLowerCase();
    return (
      !q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)
    );
  });

  // `resources` stays complete — `ticked` is seeded from it and sent back
  // whole — while everything the screen RENDERS comes from `shown`.
  const shown = useMemo(() => resources.filter((r) => !isHidden(r)), [resources]);
  const hiddenKeys = useMemo(() => hiddenKeysOf(resources), [resources]);
  const visibleTicked = useMemo(
    () => [...ticked].filter((k) => !hiddenKeys.has(k)),
    [ticked, hiddenKeys],
  );
  const keptHidden = useMemo(
    () => [...ticked].filter((k) => hiddenKeys.has(k)),
    [ticked, hiddenKeys],
  );

  const groups = useMemo(() => byCategory(shown), [shown]);
  const visibleGroups = groups
    .map(([category, items]) =>
      [category, items.filter((r) => matches(r, permFilter))] as const,
    )
    .filter(([, items]) => items.length > 0);

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-3 text-ink-500">
          <Spinner /> Loading roles…
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Banners
        failure={failure}
        notice={notice}
        onDismiss={() => {
          setFailure(null);
          setNotice(null);
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card
          title="Roles"
          actions={
            <Button
              size="md"
              variant="secondary"
              onClick={() => guard(startNew)}
            >
              New role
            </Button>
          }
        >
          <div className="space-y-3">
            <input
              className="field-input"
              placeholder="Filter roles"
              aria-label="Filter roles"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            />

            {retiredCount > 0 ? (
              <label className="flex items-center gap-2 text-xs text-ink-500">
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(e) => setShowRetired(e.target.checked)}
                />
                Show {retiredCount} retired role
                {retiredCount === 1 ? "" : "s"}
              </label>
            ) : null}

            {visibleRoles.length === 0 ? (
              <EmptyState title="No roles match">
                Clear the filter to see all {selectable.length}.
              </EmptyState>
            ) : (
              <ul className="space-y-1">
                {visibleRoles.map((r) => {
                  const on = r.key === selected;
                  // Count what this screen shows, so the list and the editor's
                  // "n of m selected" cannot disagree about the same role.
                  const count = r.permissions.filter(
                    (k) => !hiddenKeys.has(k),
                  ).length;
                  return (
                    <li key={r.key}>
                      {/* A button, not a clickable row: this is the screen's
                          primary navigation and has to be reachable by
                          keyboard. */}
                      <button
                        type="button"
                        aria-current={on ? "true" : undefined}
                        onClick={() => guard(() => pick(r))}
                        className={[
                          "w-full rounded-lg border px-3 py-2 text-left transition",
                          on
                            ? "border-brand-200 bg-brand-50"
                            : "border-transparent hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-ink-900">
                            {r.name}
                          </span>
                          {r.is_system ? (
                            <Chip title="Came from the ERP; duerp-api joins on this key.">
                              system
                            </Chip>
                          ) : null}
                          {!r.is_active ? (
                            <Chip
                              tone="deny"
                              title="Retired: cannot be assigned. Anyone already holding it is unaffected."
                            >
                              retired
                            </Chip>
                          ) : null}
                        </span>
                        <code className="block text-xs text-ink-500">
                          {r.key}
                        </code>
                        <span className="mt-1 block text-[11px] text-ink-500">
                          {count} permission{count === 1 ? "" : "s"} ·{" "}
                          {r.members} holder{r.members === 1 ? "" : "s"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card
          title={role ? `Edit ${role.name}` : "New role"}
          description={
            role?.is_system
              ? "A system role: its key is fixed because duerp-api joins on it. The name and permissions are yours to change."
              : "Tick what this role may do. Unticking revokes it for everybody holding the role."
          }
          actions={
            role ? (
              <>
                {/* Retiring is the removal that works for the roles Delete
                    cannot touch: system roles, and roles people still hold. */}
                <Button
                  variant="secondary"
                  onClick={() =>
                    role.is_active
                      ? setConfirmRetire(role)
                      : void setActive(role, true)
                  }
                  disabled={saving || (role.is_active && role.key === "admin")}
                  title={
                    role.is_active && role.key === "admin"
                      ? "The admin role cannot be retired — nobody could be made an admin again."
                      : undefined
                  }
                >
                  {role.is_active ? "Retire" : "Restore"}
                </Button>
                {!role.is_system ? (
                  <Button
                    variant="danger"
                    onClick={() => setConfirmDelete(role)}
                    disabled={saving || role.members > 0}
                    title={
                      role.members > 0
                        ? `${role.members} person${role.members === 1 ? "" : "s"} still hold this role. Move them first.`
                        : undefined
                    }
                  >
                    Delete
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          <div className="space-y-4">
            {creating ? (
              <Field
                label="Key"
                error={keyError}
                hint="Lower-case letters, digits and underscore — this is what queries and guards refer to, and it cannot be changed later."
              >
                {(id) => (
                  <input
                    id={id}
                    className="field-input"
                    value={newKey}
                    placeholder="card_desk"
                    onChange={(e) => setNewKey(slugify(e.target.value))}
                  />
                )}
              </Field>
            ) : null}

            <Field label="Name">
              {(id) => (
                <input
                  id={id}
                  className="field-input"
                  value={name}
                  placeholder="Card Desk"
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>

            <div className="rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
                <input
                  className="field-input flex-1"
                  placeholder="Search permissions, keys or endpoints"
                  aria-label="Search permissions"
                  value={permFilter}
                  onChange={(e) => setPermFilter(e.target.value)}
                />
                <span className="text-xs text-ink-500">
                  {visibleTicked.length} of {shown.length} selected
                </span>
              </div>

              {/* What Save would actually do, in words. The tick-boxes show
                  the end state; only this shows the change. */}
              {role && dirty ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <span className="font-medium">Unsaved:</span>
                  {added.length ? <span>+{added.length} granted</span> : null}
                  {removed.length ? (
                    <span>−{removed.length} revoked</span>
                  ) : null}
                  {name.trim() !== role.name ? <span>name changed</span> : null}
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={() => pick(role)}
                    className="ml-auto"
                  >
                    Revert
                  </Button>
                </div>
              ) : null}

              <div className="space-y-3 p-3">
                {visibleGroups.length === 0 ? (
                  <EmptyState title="No permissions match">
                    Nothing here matches “{permFilter}”.
                  </EmptyState>
                ) : (
                  visibleGroups.map(([category, items]) => {
                    const keys = items.map((i) => i.key);
                    const on = keys.filter((k) => ticked.has(k)).length;
                    return (
                      <fieldset
                        key={category}
                        className="rounded-lg border border-slate-200 p-3"
                      >
                        <legend className="sr-only">{category}</legend>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
                            {category}{" "}
                            <span className="text-ink-400">
                              ({on}/{keys.length})
                            </span>
                          </span>
                          <span className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setMany(keys, true)}
                              disabled={on === keys.length}
                              className="rounded px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:text-ink-300 disabled:hover:bg-transparent"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              onClick={() => setMany(keys, false)}
                              disabled={on === 0}
                              className="rounded px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:text-ink-300 disabled:hover:bg-transparent"
                            >
                              Clear
                            </button>
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {items.map((res) => (
                            <label
                              key={res.key}
                              className="flex gap-2 rounded-md p-1 text-sm hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={ticked.has(res.key)}
                                onChange={() => toggle(res.key)}
                              />
                              <span>
                                <span className="font-medium">{res.name}</span>
                                <br />
                                <code className="text-xs text-ink-500">
                                  {res.key}
                                </code>
                                {res.endpoints.length ? (
                                  <span
                                    title={endpointHint(res)}
                                    className="block cursor-help text-[11px] text-ink-400 underline decoration-dotted"
                                  >
                                    {res.endpoints.length} endpoint
                                    {res.endpoints.length === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void save()}
                disabled={
                  saving ||
                  !dirty ||
                  !name.trim() ||
                  (creating && (!newKey.trim() || !!keyError))
                }
              >
                {saving ? "Saving…" : creating ? "Create role" : "Save changes"}
              </Button>
              <span className="text-xs text-ink-500">
                {!dirty && role
                  ? "No unsaved changes."
                  : `Saves all ${visibleTicked.length} ticked permission${visibleTicked.length === 1 ? "" : "s"} as the complete set.`}
                {keptHidden.length ? (
                  <span
                    className="block text-ink-400"
                    title={keptHidden.join("\n")}
                  >
                    Plus {keptHidden.length} permission
                    {keptHidden.length === 1 ? "" : "s"} this screen does not
                    manage, kept as they are.
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={confirmRetire !== null}
        onClose={() => setConfirmRetire(null)}
        title="Retire role"
      >
        {confirmRetire ? (
          <div className="space-y-4 p-4">
            <h2 className="text-base font-semibold text-ink-900">
              Retire &ldquo;{confirmRetire.name}&rdquo;?
            </h2>
            <p className="text-sm text-ink-600">
              It stops being assignable and drops off the roles list. Nothing is
              deleted and it can be restored here at any time.
            </p>
            {confirmRetire.members > 0 ? (
              <Alert tone="info" title="Its holders are not affected">
                {confirmRetire.members}{" "}
                {confirmRetire.members === 1 ? "person keeps" : "people keep"}{" "}
                this role and everything it grants. Retiring only stops it being
                given to anybody new — to take access away, deactivate the
                account or use a deny exception.
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmRetire(null)}>
                Cancel
              </Button>
              <Button onClick={() => void setActive(confirmRetire, false)}>
                Retire role
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete role"
      >
        <div className="space-y-4 p-4">
          <h2 className="text-base font-semibold text-ink-900">
            Delete “{confirmDelete?.name}”?
          </h2>
          <p className="text-sm text-ink-600">
            The role and its {confirmDelete?.permissions.length} permission
            {confirmDelete?.permissions.length === 1 ? "" : "s"} are removed.
            This cannot be undone — the role would have to be rebuilt by hand.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmDelete && void remove(confirmDelete)}
            >
              Delete role
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------
// People
// ---------------------------------------------------------------------

const PAGE_SIZE = 25;

function PeopleTab() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<api.AccountRow[]>([]);
  const [roles, setRoles] = useState<api.Role[]>([]);
  const [resources, setResources] = useState<api.Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRole, setConfirmRole] = useState<{
    person: api.AccountRow;
    to: string;
  } | null>(null);
  const [managing, setManaging] = useState<api.AccountRow | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<api.AccountRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<api.AccountRow | null>(null);

  // Typing searches on its own after a pause. The button stays for anybody who
  // expects one, but nobody has to find it.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, r, res] = await Promise.all([
      api.listUsers(query, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      api.listRoles(),
      api.listResources(),
    ]);
    setLoading(false);
    if (u.status !== "success") return setFailure(failureOf(u));
    setFailure(null);
    setRows(u.data.users);
    setTotal(u.data.total);
    if (r.status === "success") setRoles(r.data.roles);
    if (res.status === "success") setResources(res.data.resources);
    // Keep an open exceptions dialog looking at the row it was opened on,
    // rather than at a copy that predates the change just made in it.
    setManaging((prev) =>
      prev
        ? (u.data.users.find((x) => x.person_id === prev.person_id) ?? prev)
        : prev,
    );
  }, [query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // The same rule the roles picker follows, applied to what this tab shows:
  // a permission that opens nothing here is noise on a person's row too.
  const hiddenKeys = useMemo(() => hiddenKeysOf(resources), [resources]);
  const shown = useMemo(
    () => resources.filter((r) => !isHidden(r)),
    [resources],
  );
  const visible = (keys: string[]) => keys.filter((k) => !hiddenKeys.has(k));

  const nameOf = (u: api.AccountRow) => u.username ?? `person ${u.person_id}`;

  /**
   * What one person's role dropdown offers.
   *
   * The hidden roles, plus THEIR OWN role even when it is hidden. A `<select>`
   * whose value matches no option renders as the first one, so a person on a
   * hidden role would read as "(no role)" — and the next touch of any control
   * in that row would save that misreading as fact.
   */
  const optionsFor = (u: api.AccountRow) => {
    const offered = selectableRoles(roles);
    const own = u.role ? roles.find((r) => r.key === u.role) : undefined;
    return own && !offered.some((r) => r.key === own.key)
      ? [...offered, own]
      : offered;
  };
  const roleName = (key: string | null) =>
    key ? (roles.find((r) => r.key === key)?.name ?? key) : "(no role)";

  async function applyRole(person: api.AccountRow, roleKey: string) {
    setConfirmRole(null);
    setBusy(person.person_id);
    const env = await api.setUserRole(person.person_id, roleKey || null);
    setBusy(null);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(`${nameOf(person)}: ${env.message.toLowerCase()}`);
    await load();
  }

  async function applyStatus(person: api.AccountRow, next: "active" | "inactive") {
    setConfirmStatus(null);
    setBusy(person.person_id);
    const env = await api.setUserStatus(person.person_id, next);
    setBusy(null);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(`${nameOf(person)}: ${env.message.toLowerCase()}`);
    await load();
  }

  async function applyDelete(person: api.AccountRow) {
    setConfirmDelete(null);
    setBusy(person.person_id);
    const env = await api.deleteUser(person.person_id);
    setBusy(null);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    const gone = env.data?.overrides_removed ?? 0;
    setNotice(
      `${nameOf(person)}: account deleted` +
        (gone ? `, along with ${gone} exception${gone === 1 ? "" : "s"}.` : "."),
    );
    // The row is gone, so anything open on it must go too.
    setManaging((prev) => (prev?.person_id === person.person_id ? null : prev));
    await load();
  }

  async function applyOverride(
    person: api.AccountRow,
    permission: string,
    effect: "grant" | "deny" | "clear",
  ) {
    setBusy(person.person_id);
    const env = await api.setUserOverride(person.person_id, permission, effect);
    setBusy(null);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(
      effect === "clear"
        ? `${nameOf(person)}: ${permission} back to whatever the role says.`
        : `${nameOf(person)}: ${permission} ${effect}ed.`,
    );
    await load();
  }

  return (
    <div className="space-y-4">
      <Banners
        failure={failure}
        notice={notice}
        onDismiss={() => {
          setFailure(null);
          setNotice(null);
        }}
      />

      <Card
        title="People"
        description="A person with no role is refused everything once the gate enforces. Deny overrides beat the role; grant overrides add to it."
      >
        <div className="mb-4 flex gap-2">
          <input
            className="field-input"
            placeholder="Search by id or username"
            aria-label="Search accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
          <Button variant="secondary" onClick={() => void load()}>
            Search
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 py-6 text-ink-500">
            <Spinner /> Loading accounts…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No accounts match">
            {query
              ? `Nothing matches “${query}”.`
              : "There are no accounts to show."}
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>DU role</Th>
                  <Th>Role here</Th>
                  <Th>What they can do</Th>
                  <Th>Account</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.person_id}>
                    <Td>
                      <span className="font-medium">{u.username ?? "—"}</span>
                      <br />
                      <code className="text-xs text-ink-500">
                        {u.person_id}
                      </code>
                      {u.status !== "active" ? (
                        <span
                          title="Every request from this account is refused, whatever their token says."
                          className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] text-rose-700"
                        >
                          {u.status}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-xs text-ink-500">
                        {u.du_base_role ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <select
                        className="field-input"
                        aria-label={`Role for ${nameOf(u)}`}
                        value={u.role ?? ""}
                        disabled={busy === u.person_id}
                        onChange={(e) =>
                          setConfirmRole({ person: u, to: e.target.value })
                        }
                      >
                        <option value="">(no role)</option>
                        {optionsFor(u).map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                            {!r.is_active ? " (retired)" : ""}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      {(() => {
                        const effective = visible(u.effective);
                        const overrides = u.overrides.filter(
                          (o) => !hiddenKeys.has(o.permission),
                        );
                        return (
                          <>
                            {effective.length === 0 ? (
                              <span className="text-xs text-ink-400">
                                nothing — refused everything once the gate
                                enforces
                              </span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {effective.slice(0, 3).map((p) => (
                                  <Chip key={p}>{p}</Chip>
                                ))}
                                {effective.length > 3 ? (
                                  <Chip title={effective.join("\n")}>
                                    +{effective.length - 3} more
                                  </Chip>
                                ) : null}
                              </span>
                            )}
                            {overrides.length ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {overrides.map((o) => (
                                  <Chip
                                    key={o.permission}
                                    tone={o.effect === "deny" ? "deny" : "grant"}
                                  >
                                    {o.effect}: {o.permission}
                                  </Chip>
                                ))}
                              </span>
                            ) : null}
                          </>
                        );
                      })()}
                      <Button
                        size="md"
                        variant="ghost"
                        className="mt-1 px-0"
                        onClick={() => setManaging(u)}
                      >
                        Exceptions…
                      </Button>
                    </Td>
                    <Td>
                      <span className="flex flex-col items-start gap-1">
                        {/* Deactivating is offered first and phrased as the
                            reversible thing it is; deleting sits below it,
                            because for access they do the same job and only
                            one of them can be undone. */}
                        <Button
                          size="md"
                          variant="secondary"
                          disabled={busy === u.person_id}
                          onClick={() => setConfirmStatus(u)}
                        >
                          {u.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          size="md"
                          variant="ghost"
                          className="px-0 text-rose-700 hover:bg-rose-50"
                          disabled={busy === u.person_id}
                          onClick={() => setConfirmDelete(u)}
                        >
                          Delete…
                        </Button>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={total}
              onPage={setPage}
              busy={loading}
            />
          </>
        )}
      </Card>

      <Modal
        open={confirmRole !== null}
        onClose={() => setConfirmRole(null)}
        title="Change role"
      >
        {confirmRole ? (
          <div className="space-y-4 p-4">
            <h2 className="text-base font-semibold text-ink-900">
              Change {nameOf(confirmRole.person)}&rsquo;s role?
            </h2>
            <p className="text-sm text-ink-600">
              From <strong>{roleName(confirmRole.person.role)}</strong> to{" "}
              <strong>{roleName(confirmRole.to || null)}</strong>. This takes
              effect on their next request.
            </p>
            {confirmRole.to === "" ? (
              <Alert tone="warning" title="No role means no access">
                Once the gate enforces, a person with no role is refused
                everything this service protects.
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmRole(null)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  void applyRole(confirmRole.person, confirmRole.to)
                }
              >
                Change role
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmStatus !== null}
        onClose={() => setConfirmStatus(null)}
        title="Change account status"
      >
        {confirmStatus ? (
          <div className="space-y-4 p-4">
            <h2 className="text-base font-semibold text-ink-900">
              {confirmStatus.status === "active" ? "Deactivate" : "Activate"}{" "}
              {nameOf(confirmStatus)}?
            </h2>
            {confirmStatus.status === "active" ? (
              <>
                <p className="text-sm text-ink-600">
                  Every request from this account is refused from the next one
                  onwards — their role and permissions are left untouched, and
                  activating again restores them exactly.
                </p>
                <Alert tone="warning" title="This is the only way to stop a token">
                  Sign-in tokens last about 730 hours and there is no revocation
                  list, so changing a role does not stop somebody who is already
                  signed in. This does.
                </Alert>
              </>
            ) : (
              <p className="text-sm text-ink-600">
                Their requests are accepted again from the next one onwards,
                with the role and exceptions they had before.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmStatus(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmStatus.status === "active" ? "danger" : "primary"}
                onClick={() =>
                  void applyStatus(
                    confirmStatus,
                    confirmStatus.status === "active" ? "inactive" : "active",
                  )
                }
              >
                {confirmStatus.status === "active" ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete account"
      >
        {confirmDelete ? (
          <div className="space-y-4 p-4">
            <h2 className="text-base font-semibold text-ink-900">
              Delete {nameOf(confirmDelete)}&rsquo;s account?
            </h2>
            <p className="text-sm text-ink-600">
              The account row goes, and{" "}
              {confirmDelete.overrides.length
                ? `their ${confirmDelete.overrides.length} exception${confirmDelete.overrides.length === 1 ? "" : "s"} go with it`
                : "their exceptions go with it"}
              . Nothing here recreates accounts — they arrive by import — so
              signing in again will not give them a new one.
            </p>
            <Alert tone="warning" title="Deactivating does the same job and can be undone">
              For access, an inactive account and a deleted one are identical:
              both are refused everything. Deleting only additionally loses the
              record that they were ever here.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const person = confirmDelete;
                  setConfirmDelete(null);
                  setConfirmStatus(person);
                }}
              >
                Deactivate instead
              </Button>
              <Button
                variant="danger"
                onClick={() => void applyDelete(confirmDelete)}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {managing ? (
        <ExceptionsModal
          person={managing}
          rolePermissions={visible(
            roles.find((r) => r.key === managing.role)?.permissions ?? [],
          )}
          roleLabel={roleName(managing.role)}
          resources={shown}
          busy={busy === managing.person_id}
          onApply={(permission, effect) =>
            void applyOverride(managing, permission, effect)
          }
          onClose={() => setManaging(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// Per-person exceptions
//
// The row shows overrides; this is where they are changed. Three states per
// permission, and "Inherit" is the one to reach for — an exception is a
// standing decision about one person that no longer moves when the role does,
// so the screen names what the role would give and makes going back one click.
// ---------------------------------------------------------------------

type Effect = "inherit" | "grant" | "deny";

function ExceptionsModal({
  person,
  rolePermissions,
  roleLabel,
  resources,
  busy,
  onApply,
  onClose,
}: {
  person: api.AccountRow;
  rolePermissions: string[];
  roleLabel: string;
  resources: api.Resource[];
  busy: boolean;
  onApply: (permission: string, effect: "grant" | "deny" | "clear") => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const fromRole = useMemo(
    () => new Set(rolePermissions),
    [rolePermissions],
  );
  const overrides = useMemo(
    () => new Map(person.overrides.map((o) => [o.permission, o.effect])),
    [person.overrides],
  );

  const groups = byCategory(resources)
    .map(
      ([category, items]) =>
        [category, items.filter((r) => matches(r, filter))] as const,
    )
    .filter(([, items]) => items.length > 0);

  const current = (key: string): Effect =>
    (overrides.get(key) as Effect | undefined) ?? "inherit";

  return (
    <Modal open onClose={onClose} title="Exceptions" size="lg">
      <div className="space-y-4 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">
            Exceptions for {person.username ?? `person ${person.person_id}`}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Role: <strong>{roleLabel}</strong> — {fromRole.size} permission
            {fromRole.size === 1 ? "" : "s"}. An exception overrides it for this
            person only, and stays put when the role changes.
          </p>
        </div>

        <input
          className="field-input"
          placeholder="Search permissions, keys or endpoints"
          aria-label="Search permissions"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        {groups.length === 0 ? (
          <EmptyState title="No permissions match" />
        ) : (
          <div className="space-y-4">
            {groups.map(([category, items]) => (
              <div key={category}>
                <p className="mb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                  {category}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {items.map((res) => {
                    const state = current(res.key);
                    const granted = fromRole.has(res.key);
                    const effective =
                      state === "grant" || (state === "inherit" && granted);
                    return (
                      <li
                        key={res.key}
                        className="flex flex-wrap items-center gap-3 p-3"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-ink-900">
                            {res.name}
                          </span>
                          <br />
                          <code
                            title={endpointHint(res)}
                            className="text-xs text-ink-500"
                          >
                            {res.key}
                          </code>
                        </span>

                        <Chip tone={effective ? "grant" : "neutral"}>
                          {effective ? "can" : "cannot"}
                        </Chip>
                        <span className="w-28 text-right text-[11px] text-ink-400">
                          {state === "inherit"
                            ? granted
                              ? "from role"
                              : "not in role"
                            : "exception"}
                        </span>

                        <span className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5">
                          {(
                            [
                              ["inherit", "Inherit"],
                              ["grant", "Grant"],
                              ["deny", "Deny"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={busy || state === value}
                              aria-pressed={state === value}
                              onClick={() =>
                                onApply(
                                  res.key,
                                  value === "inherit" ? "clear" : value,
                                )
                              }
                              className={[
                                "rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed",
                                state === value
                                  ? "bg-white text-ink-900 shadow-sm"
                                  : "text-ink-500 hover:text-ink-900 disabled:text-ink-300",
                              ].join(" ")}
                            >
                              {label}
                            </button>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
