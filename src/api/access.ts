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

async function post<T>(url: string, body?: unknown): Promise<Envelope<T>> {
  const res = await attendanceApi.post(url, body);
  return res.data as Envelope<T>;
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
