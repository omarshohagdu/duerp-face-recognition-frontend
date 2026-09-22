import type { AxiosResponse } from "axios";
import attendanceApi from "./attendance";

/**
 * The role-administration API (`/ext-api/access/*`).
 *
 * Backed by `attendance.admin_*` in the service's own database — NOT the ERP's
 * `/access-roles` screen, which writes `ictcell` and no longer reaches the
 * gate this service enforces. See the backend's `docs/access_control.md` §2.1.
 *
 * Two things to know before wiring a screen to this:
 *
 *  1. **These endpoints enforce.** Unlike the rest of the access layer, which
 *     is in audit mode, they refuse without `admin.roles.manage` /
 *     `admin.users.manage` from day one — they are the API that hands out
 *     permissions. A 403 here is the real answer, not a rollout artefact.
 *  2. **`permissions` on save is the WHOLE set.** A key left out is a
 *     revocation: that is what unticking a box means. Never send a partial
 *     list.
 *
 * `attendanceApi` reads the body on every status (`validateStatus: () => true`),
 * so these return the envelope and let the caller branch on `status`.
 */

export interface Envelope<T> {
  status: "success" | "error";
  message: string;
  code?: string;
  data: T;
}

export interface Role {
  id: number;
  key: string;
  name: string;
  /** Came from the ERP; its key is fixed because duerp-api joins on it. */
  is_system: boolean;
  /**
   * Assignable? `false` = retired.
   *
   * Narrow on purpose (see the backend's `sql/008`): retiring stops NEW
   * assignments and leaves everybody already holding the role exactly as they
   * were. It is housekeeping, never a bulk revocation — `status` and deny
   * overrides are what take access away, one person at a time.
   */
  is_active: boolean;
  members: number;
  permissions: string[];
}

export interface Resource {
  id: number;
  key: string;
  name: string;
  category: string;
  /** Which endpoints this key opens — shown so a key is not a guess. */
  endpoints: string[];
}

export interface Override {
  permission: string;
  effect: "grant" | "deny";
}

export interface AccountRow {
  person_id: number;
  username: string | null;
  du_base_role: string | null;
  role: string | null;
  role_name: string | null;
  status: string;
  overrides: Override[];
  /** Role grants + grant overrides − deny overrides: what they actually hold. */
  effective: string[];
}

/**
 * Read a response as this API's envelope — or report what actually arrived.
 * See the note in `api/settings.ts`: a cast turns a plain-text or HTML error
 * into an envelope whose `status` is undefined, and the screen shows nothing.
 */
function envelope<T>(res: AxiosResponse): Envelope<T> {
  const { status, data } = res;

  if (data && typeof data === "object" && typeof (data as { status?: unknown }).status === "string") {
    return data as Envelope<T>;
  }

  const raw = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return {
    status: "error",
    code: `http_${status}`,
    message: `HTTP ${status} — ${raw && raw !== "null" ? raw.slice(0, 300) : "(empty response body)"}`,
    data: undefined as T,
  };
}

async function post<T>(url: string, body?: unknown): Promise<Envelope<T>> {
  return envelope<T>(await attendanceApi.post(url, body));
}

export const listRoles = () => post<{ roles: Role[] }>("/ext-api/access/roles");

export const listResources = () =>
  post<{ resources: Resource[] }>("/ext-api/access/resources");

export const saveRole = (key: string, name: string, permissions: string[]) =>
  post<{ key: string; created: boolean }>("/ext-api/access/role-save", {
    key,
    name,
    permissions,
  });

export const deleteRole = (key: string) =>
  post<Record<string, never>>("/ext-api/access/role-delete", { key });

export const listUsers = (search: string, limit = 25, offset = 0) =>
  post<{ total: number; limit: number; offset: number; users: AccountRow[] }>(
    `/ext-api/access/users?search=${encodeURIComponent(search)}&limit=${limit}&offset=${offset}`,
  );

/** Retire (`false`) or restore (`true`) a role. Refuses to retire `admin`. */
export const setRoleActive = (key: string, is_active: boolean) =>
  post<{ key: string; is_active: boolean }>("/ext-api/access/role-active", {
    key,
    is_active,
  });

/** `role: null` clears it — "no role", which is denied everything once the gate enforces. */
export const setUserRole = (person_id: number, role: string | null) =>
  post<{ from: string | null; to: string | null }>("/ext-api/access/user-role", {
    person_id,
    role,
  });

export const setUserOverride = (
  person_id: number,
  permission: string,
  effect: "grant" | "deny" | "clear",
) =>
  post<{ effect: "grant" | "deny" | null }>("/ext-api/access/user-override", {
    person_id,
    permission,
    effect,
  });

/**
 * The kill switch: `active` | `inactive`.
 *
 * Tokens live ~730 hours and there is no revocation list, so this is what
 * makes "stop that person now" possible — the next request is refused whatever
 * their token says. Refuses to deactivate the last active admin.
 */
export const setUserStatus = (person_id: number, status: "active" | "inactive") =>
  post<{ person_id: number; status: string }>("/ext-api/access/user-status", {
    person_id,
    status,
  });

/**
 * Delete an account outright. IRREVERSIBLE.
 *
 * Their permission overrides go with it. Nothing recreates `app_users` rows —
 * they arrive by import — so the person does not get a fresh account by
 * signing in again. Deactivating denies them just as completely and keeps the
 * history, which is why the screen offers that first. Refuses self-deletion
 * and the last active admin.
 */
export const deleteUser = (person_id: number) =>
  post<{ person_id: number; overrides_removed: number }>(
    "/ext-api/access/user-delete",
    { person_id },
  );
