import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../hooks/useAuth";
import { tokenExpiry, type DuUser } from "../api/auth";
import { fullDateTime, relativeTime } from "../lib/format";

/**
 * Who you are signed in as, straight from the session.
 *
 * NO NETWORK CALLS. Everything here was already in `user_data` from `POST
 * /login` (`api/auth.ts`), so the screen works offline and cannot fail. There
 * is no "get my profile" endpoint to call anyway.
 *
 * THE TOKEN IS NEVER RENDERED. `Session` carries the bearer token alongside
 * this data, and a screen that dumps the session — however convenient for
 * debugging — puts a working credential on a display someone may be standing
 * behind. Every field below is named explicitly for that reason; do not replace
 * this with a loop over the session object.
 */
export function Profile() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  if (!session) return null;
  const user = session.user ?? {};

  // DU sends the name as `emp_name` on current accounts and `name` on older
  // ones, and both are genuinely null for some staff — in which case the
  // username (an email) is the only human-readable label there is.
  const name =
    text(user.emp_name) ?? text(user.name) ?? session.displayName ?? session.username;

  const photo = photoUrl(user);

  // Read from the token itself rather than stored alongside it, so it cannot
  // drift from what the server will actually enforce.
  const expiresAt = tokenExpiry(session.token);
  const expired = expiresAt !== null && expiresAt.getTime() <= Date.now();
  // The service issues 730 hours (~30 days), so a week's notice is early enough
  // to re-login before a shift rather than during one.
  const expiringSoon =
    expiresAt !== null &&
    !expired &&
    expiresAt.getTime() - Date.now() < 7 * 24 * 3600 * 1000;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Profile"
        description="Your details as DU holds them. Sign in again to pick up any changes."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {photo ? (
            <img
              src={photo}
              alt=""
              className="size-20 rounded-full border border-slate-200 object-cover"
              // A missing photo is normal — `image` is null on most accounts —
              // so drop the element rather than showing a broken-image icon.
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-20 items-center justify-center rounded-full bg-brand-50 text-2xl font-semibold text-brand-700"
            >
              {initials(name)}
            </div>
          )}

          <div className="min-w-0">
            <p className="text-lg font-semibold text-ink-900">{name}</p>
            <p className="font-mono text-sm text-ink-500">{session.personId}</p>
            <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-ink-700 capitalize">
              {text(user.user_role) ?? session.role}
            </span>
          </div>
        </div>
      </Card>

      <Card className="mt-6" title="Account">
        <dl className="divide-y divide-slate-100">
          {/* The id every attendance call is keyed on. Monospaced and first
              because it is the one field support will ask for. */}
          <Row label="Person ID" mono value={session.personId} />
          <Row label="Username" value={session.username} />
          <Row label="Email" value={text(user.email)} />
          <Row label="Mobile" value={text(user.mobile)} />
          <Row
            label={session.isStudent ? "Student ID" : "Employee ID"}
            mono
            value={text(user.emp_id) ?? numeric(user.user_id)}
          />
        </dl>
      </Card>

      <Card className="mt-6" title="Office">
        <dl className="divide-y divide-slate-100">
          <Row label="Office" value={text(user.body_name)} />
          {/* Not cosmetic: `body_code` is what the geo-fence mapping is keyed
              on, so "my check-in is refused" starts by reading this. */}
          <Row label="Office code" mono value={numeric(user.body_code)} />
          <Row
            label="Account status"
            value={
              user.is_active === undefined || user.is_active === null
                ? undefined
                : truthy(user.is_active)
                  ? "Active"
                  : "Inactive"
            }
          />
          <Row label="Member since" value={dateText(user.created_at)} />
        </dl>
      </Card>

      <Card className="mt-6" title="Session">
        {expired ? (
          <Alert tone="danger" className="mb-4" title="Your session has expired">
            Sign in again to mark attendance.
          </Alert>
        ) : expiringSoon ? (
          <Alert tone="warning" className="mb-4" title="Signing out soon">
            You will need to sign in again when this runs out.
          </Alert>
        ) : null}

        <dl className="divide-y divide-slate-100">
          <Row
            label="Signed in until"
            fallback="Unknown — this token carries no expiry we could read"
            value={
              expiresAt
                ? `${fullDateTime(expiresAt.toISOString())} (${relativeTime(expiresAt.toISOString())})`
                : undefined
            }
          />
        </dl>

        {/* Not a countdown to a fixed idle timeout: the token is valid for a
            set period from sign-in and using the app does not extend it. */}
        <p className="mt-3 text-xs text-ink-500">
          Sessions last about 30 days from sign-in. Using the app doesn't extend
          one — when it runs out, sign in again.
        </p>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => navigate("/face-setup")}>
          Face setup
        </Button>
        <Button variant="secondary" onClick={() => navigate("/attendance/my-reports")}>
          My attendance
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            signOut();
            navigate("/login", { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  fallback = "Not on file",
}: {
  label: string;
  value?: string;
  mono?: boolean;
  /** Shown when `value` is absent. "Not on file" is wrong for a field that
      exists but could not be read — say so instead of implying DU has no
      record of it. */
  fallback?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 py-2.5">
      <dt className="w-40 shrink-0 text-sm text-ink-500">{label}</dt>
      <dd
        className={[
          "min-w-0 flex-1 text-sm break-words",
          mono ? "font-mono" : "",
          // An absent field says so rather than rendering a blank row that
          // reads as a loading bug.
          value ? "text-ink-900" : "text-ink-400",
        ].join(" ")}
      >
        {value ?? fallback}
      </dd>
    </div>
  );
}

/** A non-empty string, or undefined. DU sends "" and null interchangeably. */
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function numeric(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
}

/** DU sends `is_active` as 1/0, not true/false. */
function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function dateText(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  // `created_at` is a space-separated timestamp; Safari refuses to parse that.
  const formatted = fullDateTime(raw.replace(" ", "T"));
  return formatted === "—" ? raw : formatted;
}

/**
 * `image_location` is a directory URL and `image` a bare filename; neither is
 * useful alone, and `image` is null on most accounts.
 */
function photoUrl(user: DuUser): string | undefined {
  const file = text(user.image);
  const base = text(user.image_location);
  if (!file || !base) return undefined;
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
}

function initials(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}
