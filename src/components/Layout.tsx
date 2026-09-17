import { NavLink, Outlet, useNavigate } from "react-router-dom";
import duLogo from "../assets/du-logo.png";
import { useAuth } from "../hooks/useAuth";
import { entriesFor } from "../lib/roles";
import { Button } from "./ui/Button";
import { NavMenu } from "./NavMenu";

export function Layout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  // Same table `RequireRole` guards on, so a link is shown exactly when the
  // route behind it will render (`lib/roles.ts`) — menus only change how those
  // links are arranged, never which of them exist. `session` is non-null here
  // — Layout only renders inside RequireAuth — but the fallback keeps the nav
  // from throwing if that nesting is ever changed.
  const entries = entriesFor(session?.role ?? "member");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          {/* Bundled with the app, NOT hotlinked from the campus host it came
              from: this page is served over https, and a plain-http image is
              mixed content that browsers block — and 10.224.224.101 is not
              reachable from outside the campus network at all. Vite
              fingerprints the file, so replacing the crest busts the cache by
              itself. */}
          <div className="flex items-center gap-2.5">
            <img
              src={duLogo}
              alt="University of Dhaka"
              width={200}
              height={252}
              // Intrinsic size is given above so the header does not jump while
              // the image loads; the height here is what actually renders it.
              className="h-9 w-auto"
            />
            <span className="text-sm font-semibold text-ink-900">
              DU Face Attendance
            </span>
          </div>

          <nav className="-mx-1 flex flex-1 flex-wrap items-center gap-1">
            {entries.map((entry) =>
              entry.kind === "menu" ? (
                <NavMenu key={entry.label} label={entry.label} items={entry.items} />
              ) : (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  className={({ isActive }) =>
                    [
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                      isActive
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-500 hover:bg-slate-100 hover:text-ink-900",
                    ].join(" ")
                  }
                >
                  {entry.label}
                </NavLink>
              ),
            )}
          </nav>

          {session && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-medium text-ink-900">
                  {session.displayName}
                </p>
                <p className="font-mono text-xs text-ink-500">
                  {session.personId}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  signOut();
                  navigate("/login", { replace: true });
                }}
              >
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
