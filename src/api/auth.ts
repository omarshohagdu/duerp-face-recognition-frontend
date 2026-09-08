import axios from "axios";
import { roleOf, type Role } from "../lib/roles";
import { TOKEN_STORAGE_KEY } from "./attendance";

/**
 * `POST /login` sits OUTSIDE the /ext-api scope, so it takes neither the app
 * credentials nor a bearer token — and it takes JSON, unlike the multipart
 * attendance endpoints. It gets its own bare client for that reason.
 */
const loginClient = axios.create({
  baseURL: import.meta.env.VITE_ATTENDANCE_END_POINT,
  timeout: 30_000,
  validateStatus: () => true,
});

/**
 * The DU user object the login response echoes back under `user_data`.
 *
 * Only the fields the UI actually reads are named; DU sends a couple of dozen
 * (permission strings, audit columns) and the index signature keeps them
 * reachable without pretending this is the full contract. Almost everything is
 * optional and much of it is genuinely null in production — `emp_name`,
 * `mobile` and `image` are all null on real accounts — so nothing here may be
 * rendered without a fallback.
 */
export interface DuUser {
  user_id?: number;
  emp_id?: string | null;
  username?: string;
  user_role?: string;
  /** DU sends the person's name as `emp_name`; `name` is the older spelling. */
  name?: string;
  emp_name?: string | null;
  email?: string | null;
  mobile?: string | null;
  /** Office. `body_code` is what `employees.office` holds and geo-fences key off. */
  body_name?: string | null;
  body_code?: number | string | null;
  /** Profile photo: a bare filename, to be hung off `image_location`. */
  image?: string | null;
  image_location?: string | null;
  is_active?: number | boolean | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface Session {
  token: string;
  username: string;
  /**
   * The person id the attendance API works in terms of — the token's `sub`.
   * Staff carry their 10-digit `emp_id`; students keep their DU `user_id`.
   * Enroll and verify match this against the id in the request, so getting it
   * wrong is a `401 token mismatch` on the user's own face.
   */
  personId: string;
  isStudent: boolean;
  /**
   * Which screens this account gets (`lib/roles.ts`). Derived from DU's
   * `user_role`, and — like everything else in this object — it lives in
   * localStorage where the user can edit it. It decides navigation only; see
   * the warning at the top of `lib/roles.ts`.
   */
  role: Role;
  displayName: string;
  user: DuUser;
}

const SESSION_STORAGE_KEY = "duerp_attendance_session";

/**
 * Mirror the server's own choice of `sub` (routes/auth.rs): students get
 * `user_id`, everyone else gets `emp_id` falling back to `user_id`. Deriving it
 * the same way here is what lets the UI pre-fill `id` correctly — and §2.2 is
 * explicit that the user must never type it.
 */
function personIdOf(user: DuUser): string {
  const isStudent = String(user.user_role ?? "").toLowerCase() === "student";
  if (!isStudent) {
    const emp = String(user.emp_id ?? "").trim();
    if (emp) return emp;
  }
  return String(user.user_id ?? "");
}

export async function login(
  username: string,
  password: string,
): Promise<Session> {
  const res = await loginClient.post("/login", { username, password });

  if (res.status === 401) {
    throw new Error("That username or password wasn't right.");
  }
  if (res.status >= 500) {
    throw new Error("The sign-in service isn't responding. Try again shortly.");
  }
  if (res.status !== 200 || typeof res.data?.token !== "string") {
    throw new Error("Sign-in failed. Please try again.");
  }

  const user: DuUser = res.data.user_data ?? {};
  const session: Session = {
    token: res.data.token,
    username: res.data.username ?? username,
    personId: personIdOf(user),
    isStudent: String(user.user_role ?? "").toLowerCase() === "student",
    role: roleOf(user.user_role),
    displayName:
      (typeof user.name === "string" && user.name) ||
      res.data.username ||
      username,
    user,
  };

  localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw || !token) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (!session.personId) return null;
    // Sessions written before roles existed have no `role`. Re-derive it from
    // the stored DU user rather than forcing everyone to sign in again on
    // deploy — `roleOf` already treats anything unrecognised as a member.
    return session.role ? session : { ...session, role: roleOf(session.user?.user_role) };
  } catch {
    return null;
  }
}

/**
 * When the bearer token stops being accepted, from its own `exp` claim.
 *
 * DECODED, NOT VERIFIED — and that is fine for the only thing it is used for.
 * The signature cannot be checked in a browser (the secret lives on the
 * server), so this answers "what does my token say about itself", which is
 * exactly the question a person asking "when do I get signed out?" means. It is
 * never an authorisation decision: the server re-checks `exp` on every call and
 * a tampered value simply gets a 401 there.
 *
 * `utils/jwt.rs` issues 730 hours (~30 days). Legacy DU tokens carry `exp` too,
 * so they read correctly here as well.
 *
 * Returns null for anything unreadable rather than throwing — a token this
 * cannot parse is still a token the server may well accept, so the UI must say
 * "unknown", never "expired".
 */
export function tokenExpiry(token: string): Date | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    // base64url -> base64: the JWT alphabet swaps +/ for -_ and drops padding.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
      ),
    );

    const exp = (claims as { exp?: unknown } | null)?.exp;
    // `exp` is seconds since the epoch, not milliseconds (RFC 7519 §4.1.4).
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    const at = new Date(exp * 1000);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
}
