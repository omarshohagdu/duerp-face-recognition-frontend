import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/Button";

const LINKS = [
  { to: "/attendance/mark", label: "Mark attendance" },
  { to: "/face-setup", label: "Face setup" },
  { to: "/attendance/enrolled", label: "Enrolled" },
  { to: "/attendance/reports", label: "Reports" },
  { to: "/attendance/buildings", label: "Geo-fences" },
];

export function Layout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <span className="text-sm font-semibold text-ink-900">
            DU Face Attendance
          </span>

          <nav className="-mx-1 flex flex-1 flex-wrap items-center gap-1">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  [
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink-500 hover:bg-slate-100 hover:text-ink-900",
                  ].join(" ")
                }
              >
                {link.label}
              </NavLink>
            ))}
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
