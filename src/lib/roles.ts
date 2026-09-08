/**
 * Who sees which screen.
 *
 * `user_role` arrives in the login response's `user_data` and is stored with
 * the session (`api/auth.ts`). It is worth being explicit about what that can
 * and cannot buy:
 *
 * THIS IS NAVIGATION, NOT AUTHORIZATION. The token carries only `sub` and
 * `exp` (`utils/jwt.rs` — the claim set is shared with duerp-api, so a role
 * claim cannot be added on this side alone), which means the server cannot see
 * a role at all. Anything here is editable in devtools, so hiding a link hides
 * a link and nothing more.
 *
 * The real boundary stays where it already is:
 *   - enroll/verify match the token's `sub`, so an admin cannot mark someone
 *     else's attendance by unhiding the screen;
 *   - the geo-fence and log endpoints require `X-Admin-Key` server-side.
 *
 * So: add a screen here to put it in front of the right people. Never rely on
 * it to keep anyone out of one.
 */

export type Role = "admin" | "member";

/** Everything DU does not call `admin` is an ordinary member — staff, student. */
export function roleOf(userRole: unknown): Role {
  return String(userRole ?? "").trim().toLowerCase() === "admin"
    ? "admin"
    : "member";
}

export interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

/**
 * The single source of truth for both the header nav and the route guards in
 * `App.tsx`. Keeping one list is what stops a hidden link from staying
 * reachable by typing its URL — the guard reads the same `roles` array the nav
 * filtered on.
 */
export const NAV: NavItem[] = [
  // Self-service. An admin account is an oversight account: it has no face to
  // enroll and no attendance of its own to mark, so these two are hidden from
  // it rather than shown and then failing on the token check.
  { to: "/attendance/mark", label: "Mark attendance", roles: ["member"] },
  { to: "/face-setup", label: "Face setup", roles: ["member"] },
  // The member's own history. A SEPARATE route from the admin
  // `/attendance/reports`, not the same one opened up: that page also carries
  // the by-date tab, which lists everyone. See `pages/MyAttendance.tsx`.
  { to: "/attendance/my-reports", label: "My attendance", roles: ["member"] },

  // Oversight.
  { to: "/attendance/enrolled", label: "Enrolled users", roles: ["admin"] },
  { to: "/attendance/reports", label: "Attendance reports", roles: ["admin"] },
  { to: "/attendance/buildings", label: "Geo-fences", roles: ["admin"] },
  { to: "/logs/login", label: "Login log", roles: ["admin"] },
  { to: "/logs/attendance", label: "Attendance log", roles: ["admin"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

export function canSee(role: Role, path: string): boolean {
  return NAV.some((item) => item.to === path && item.roles.includes(role));
}

/**
 * Where "/" and any unknown URL land. Deliberately derived from `navFor` rather
 * than hardcoded: a member's landing page is check-in, an admin's is whatever
 * their first screen happens to be, and neither breaks when NAV is reordered.
 */
export function homeFor(role: Role): string {
  return navFor(role)[0]?.to ?? "/login";
}
