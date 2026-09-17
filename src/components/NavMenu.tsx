import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { NavItem } from "../lib/roles";

/**
 * One dropdown in the header.
 *
 * A menu is a container, not a destination: there is no route behind the
 * button, so it is a `<button>` and not a `<NavLink>`, and the guard table
 * (`lib/roles.ts`) never sees it.
 *
 * The three behaviours a menu has to get right, and each is a bug if it is
 * missing: Escape closes it and puts focus back on the button, a click outside
 * closes it, and choosing an item closes it — otherwise the panel hangs over
 * the page you just navigated to.
 */
export function NavMenu({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  // Highlight the menu when the page you are on lives inside it, so an admin
  // three screens deep can still see where they are.
  const holdsCurrent = items.some((item) => item.to === pathname);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
          holdsCurrent || open
            ? "bg-brand-50 text-brand-700"
            : "text-ink-500 hover:bg-slate-100 hover:text-ink-900",
        ].join(" ")}
      >
        {label}
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`size-4 transition ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M6 8l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-1 min-w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                [
                  "block rounded-lg px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-ink-700 hover:bg-slate-100 hover:text-ink-900",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}
