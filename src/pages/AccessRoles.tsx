import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
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

export function AccessRoles() {
  const [tab, setTab] = useState<Tab>("roles");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access roles"
        description="Roles, what each one may do, and who holds them. Changes take effect on the next request — no restart."
      />

      <div className="flex gap-2">
        <Button
          variant={tab === "roles" ? "primary" : "secondary"}
          onClick={() => setTab("roles")}
        >
          Roles &amp; permissions
        </Button>
        <Button
          variant={tab === "people" ? "primary" : "secondary"}
          onClick={() => setTab("people")}
        >
          People
        </Button>
      </div>

      {tab === "roles" ? <RolesTab /> : <PeopleTab />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------

function RolesTab() {
  const [roles, setRoles] = useState<api.Role[]>([]);
  const [resources, setResources] = useState<api.Resource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const creating = selected === null && newKey !== "";
  const role = roles.find((r) => r.key === selected) ?? null;

  async function load(keepSelection = true) {
    setLoading(true);
    const [r, res] = await Promise.all([api.listRoles(), api.listResources()]);
    setLoading(false);
    if (r.status !== "success") return setFailure(failureOf(r));
    if (res.status !== "success") return setFailure(failureOf(res));
    setFailure(null);
    setRoles(r.data.roles);
    setResources(res.data.resources);
    if (!keepSelection || !selected) {
      const first = r.data.roles[0];
      if (first) pick(first);
    } else {
      const again = r.data.roles.find((x) => x.key === selected);
      if (again) pick(again);
    }
  }

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function toggle(key: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    const key = selected ?? newKey.trim().toLowerCase();
    if (!key || !name.trim()) {
      return setFailure({ title: "A key and a name are both required." });
    }
    setSaving(true);
    // The WHOLE set, every time: the API replaces what is stored, so an
    // unticked box is a revocation.
    const env = await api.saveRole(key, name.trim(), [...ticked]);
    setSaving(false);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(env.message);
    setSelected(key);
    await load();
  }

  async function remove(r: api.Role) {
    // No confirm dialog: the API refuses to delete a role anybody holds, and
    // refuses system roles outright, so the dangerous cases answer for
    // themselves with a reason worth reading.
    setSaving(true);
    const env = await api.deleteRole(r.key);
    setSaving(false);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(env.message);
    startNew();
    await load(false);
  }

  const byCategory = useMemo(() => {
    const out = new Map<string, api.Resource[]>();
    for (const r of resources) {
      const list = out.get(r.category) ?? [];
      list.push(r);
      out.set(r.category, list);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [resources]);

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-3 p-6 text-ink-500">
          <Spinner /> Loading roles…
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {failure ? (
        <Alert tone="danger" title={failure.title}>
          {failure.detail}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card
          title="Roles"
          actions={
            <Button size="md" variant="secondary" onClick={startNew}>
              New role
            </Button>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Holders</Th>
                <Th>Permissions</Th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => pick(r)}
                  className={`cursor-pointer ${r.key === selected ? "bg-brand-50" : ""}`}
                >
                  <Td>
                    <span className="font-medium">{r.name}</span>
                    <br />
                    <code className="text-xs text-ink-500">{r.key}</code>
                    {r.is_system ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-ink-500">
                        system
                      </span>
                    ) : null}
                  </Td>
                  <Td>{r.members}</Td>
                  <Td>{r.permissions.length}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card
          title={role ? `Edit ${role.name}` : "New role"}
          description={
            role?.is_system
              ? "A system role: its key is fixed because duerp-api joins on it. The name and permissions are yours to change."
              : "Tick what this role may do. Unticking revokes it for everybody holding the role."
          }
          actions={
            role && !role.is_system ? (
              <Button variant="danger" onClick={() => void remove(role)} disabled={saving}>
                Delete
              </Button>
            ) : null
          }
        >
          <div className="space-y-4 p-4">
            {!role ? (
              <Field
                label="Key"
                hint="Lower-case letters, digits and underscore — this is what queries and guards refer to, and it cannot be changed later."
              >
                {(id) => (
                  <input
                    id={id}
                    className="field-input"
                    value={newKey}
                    placeholder="card_desk"
                    onChange={(e) => setNewKey(e.target.value)}
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

            {byCategory.map(([category, items]) => (
              <fieldset key={category} className="rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {category}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((res) => (
                    <label key={res.key} className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={ticked.has(res.key)}
                        onChange={() => toggle(res.key)}
                      />
                      <span>
                        <span className="font-medium">{res.name}</span>
                        <br />
                        <code className="text-xs text-ink-500">{res.key}</code>
                        {res.endpoints.length ? (
                          <span className="block text-[11px] text-ink-400">
                            {res.endpoints.length} endpoint
                            {res.endpoints.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            <div className="flex items-center gap-3">
              <Button onClick={() => void save()} disabled={saving || (!role && !newKey.trim())}>
                {saving ? "Saving…" : creating || !role ? "Create role" : "Save changes"}
              </Button>
              <span className="text-xs text-ink-500">
                {ticked.size} permission{ticked.size === 1 ? "" : "s"} selected
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// People
// ---------------------------------------------------------------------

function PeopleTab() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<api.AccountRow[]>([]);
  const [roles, setRoles] = useState<api.Role[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [u, r] = await Promise.all([api.listUsers(search), api.listRoles()]);
    setLoading(false);
    if (u.status !== "success") return setFailure(failureOf(u));
    setFailure(null);
    setRows(u.data.users);
    setTotal(u.data.total);
    if (r.status === "success") setRoles(r.data.roles);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function assign(person: api.AccountRow, roleKey: string) {
    setBusy(person.person_id);
    const env = await api.setUserRole(person.person_id, roleKey || null);
    setBusy(null);
    if (env.status !== "success") return setFailure(failureOf(env));
    setFailure(null);
    setNotice(`${person.username ?? person.person_id}: ${env.message.toLowerCase()}`);
    await load();
  }

  return (
    <div className="space-y-4">
      {failure ? (
        <Alert tone="danger" title={failure.title}>
          {failure.detail}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card
        title="People"
        description="A person with no role is refused everything once the gate enforces. Deny overrides beat the role; grant overrides add to it."
      >
        <div className="flex gap-2 p-4">
          <input
            className="field-input"
            placeholder="Search by id or username"
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
          <div className="flex items-center gap-3 p-6 text-ink-500">
            <Spinner /> Loading accounts…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No accounts match" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>DU role</Th>
                <Th>Role here</Th>
                <Th>Effective permissions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.person_id}>
                  <Td>
                    <span className="font-medium">{u.username ?? "—"}</span>
                    <br />
                    <code className="text-xs text-ink-500">{u.person_id}</code>
                    {u.status !== "active" ? (
                      <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] text-rose-700">
                        {u.status}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-xs text-ink-500">{u.du_base_role ?? "—"}</span>
                  </Td>
                  <Td>
                    <select
                      className="field-input"
                      value={u.role ?? ""}
                      disabled={busy === u.person_id}
                      onChange={(e) => void assign(u, e.target.value)}
                    >
                      <option value="">(no role)</option>
                      {roles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    {u.effective.length === 0 ? (
                      <span className="text-xs text-ink-400">nothing</span>
                    ) : (
                      <span className="text-xs text-ink-600">
                        {u.effective.join(", ")}
                      </span>
                    )}
                    {u.overrides.length ? (
                      <span className="mt-1 block text-[11px] text-amber-700">
                        {u.overrides
                          .map((o) => `${o.effect}: ${o.permission}`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <p className="px-4 pb-4 text-xs text-ink-500">
          {rows.length} of {total} account{total === 1 ? "" : "s"}
        </p>
      </Card>
    </div>
  );
}
