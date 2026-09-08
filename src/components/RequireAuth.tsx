import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { canSee, homeFor } from "../lib/roles";

export function RequireAuth() {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/**
 * Second gate: the route exists and you are signed in, but this role does not
 * get this screen (`lib/roles.ts`).
 *
 * It reads the same NAV table the header filters on, so a link that is hidden
 * is also unreachable by typing its URL — the two cannot drift apart. Wrong
 * role redirects to that role's own home rather than rendering a "forbidden"
 * page: there is nothing for the user to do about it, and the screens are
 * hidden from them anyway, so a dead end would only look like a bug.
 *
 * This is navigation, not authorization — the server sees no role at all. See
 * the header comment in `lib/roles.ts` before treating it as a security
 * boundary.
 */
export function RequireRole() {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!canSee(session.role, location.pathname)) {
    return <Navigate to={homeFor(session.role)} replace />;
  }
  return <Outlet />;
}
