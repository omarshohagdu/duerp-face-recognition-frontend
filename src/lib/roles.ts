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
 * The one real boundary left is enroll/verify, which match the token's `sub`,
 * so an admin cannot mark someone else's attendance by unhiding the screen.
 *
 * EVERYTHING ELSE IS OPEN TO ANY SIGNED-IN USER. The geo-fence write, the two
 * log readers and both attendance reports were gated server-side by a shared
 * `X-Admin-Key`; that check has been removed, so hiding those links from a
 * member now hides only the links — the endpoints answer anyone with a token.
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
 * One thing in the header: a link, or a menu holding several.
 *
 * Grouping is presentation only — `NAV` below is still the flat list every
 * guard reads, so a menu can be reorganised without any chance of quietly
 * opening or closing a route.
 */
export type NavEntry =
  | ({ kind: "link" } & NavItem)
  | { kind: "menu"; label: string; roles: Role[]; items: NavItem[] };

/**
 * The single source of truth for the header nav AND the route guards in
 * `App.tsx`. Keeping one list is what stops a hidden link from staying
 * reachable by typing its URL — the guard reads the same `roles` array the nav
 * filtered on.
 *
 * ORDER IS THE DISPLAY ORDER, and the first entry a role can see is where "/"
 * sends them (`homeFor`). Self-service comes first for that reason: a member
 * lands on check-in, which is the thing they opened the app to do.
 *
 * ADMIN SCREENS ARE IN MENUS because there are now seven of them, and seven
 * flat links wrapped onto two rows is a list nobody reads — the eye stops
 * finding "Geo-fences" among "Login log" and "Access roles". Three menus named
 * after the job — what happened, what was recorded, who may do what — is the
 * organisation the screens already have.
 */
export const NAV_ENTRIES: NavEntry[] = [
  // Self-service. An admin account is an oversight account: it has no face to
  // enroll and no attendance of its own to mark, so these are hidden from it
  // rather than shown and then failing on the token check.
  { kind: "link", to: "/attendance/mark", label: "Mark attendance", roles: ["member"] },
  { kind: "link", to: "/face-setup", label: "Face setup", roles: ["member"] },
  // The member's own history. A SEPARATE route from the admin
  // `/attendance/reports`, not the same one opened up: that page also carries
  // the by-date tab, which lists everyone. See `pages/MyAttendance.tsx`.
  { kind: "link", to: "/attendance/my-reports", label: "My attendance", roles: ["member"] },

  // Oversight, grouped by the question each screen answers.
  {
    kind: "menu",
    label: "Attendance",
    roles: ["admin"],
    items: [
      { to: "/attendance/reports", label: "Attendance reports", roles: ["admin"] },
      { to: "/attendance/enrolled", label: "Enrolled users", roles: ["admin"] },
      { to: "/attendance/buildings", label: "Geo-fences", roles: ["admin"] },
    ],
  },
  {
    kind: "menu",
    label: "Logs",
    roles: ["admin"],
    items: [
      { to: "/logs/attendance", label: "Attendance log", roles: ["admin"] },
      { to: "/logs/login", label: "Login log", roles: ["admin"] },
    ],
  },
  {
    kind: "menu",
    label: "Administration",
    roles: ["admin"],
    items: [
      { to: "/access-roles", label: "Access roles", roles: ["admin"] },
      { to: "/settings/face-verification", label: "Face verification", roles: ["admin"] },
    ],
  },

  // Read-only, and entirely from the session — nothing here calls the API.
  // Member-only for now: an admin account is an oversight login, not a person
  // with an office and a face on file. Add "admin" here if that changes.
  { kind: "link", to: "/profile", label: "Profile", roles: ["member"] },
];

/**
 * Every navigable screen, flattened. What the guards read — a menu is a
 * container, not a destination, so it contributes its children and nothing of
 * its own.
 */
export const NAV: NavItem[] = NAV_ENTRIES.flatMap((entry) =>
  entry.kind === "link"
    ? [{ to: entry.to, label: entry.label, roles: entry.roles }]
    : entry.items,
);

export function navFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

/**
 * The header's version: entries in display order, menus keeping only the items
 * this role may see, and an emptied menu dropped rather than rendered as a
 * button that opens onto nothing.
 */
export function entriesFor(role: Role): NavEntry[] {
  return NAV_ENTRIES.filter((entry) => entry.roles.includes(role)).flatMap<NavEntry>(
    (entry) => {
      if (entry.kind === "link") return [entry];
      const items = entry.items.filter((item) => item.roles.includes(role));
      return items.length ? [{ ...entry, items }] : [];
    },
  );
}

export function canSee(role: Role, path: string): boolean {
  return NAV.some((item) => item.to === path && item.roles.includes(role));
}

/**
 * Where "/" and any unknown URL land. Deliberately derived from `navFor`
 * rather than hardcoded: a member's landing page is check-in, an admin's is
 * whatever their first screen happens to be, and neither breaks when the nav
 * is reordered.
 */
export function homeFor(role: Role): string {
  return navFor(role)[0]?.to ?? "/login";
}
