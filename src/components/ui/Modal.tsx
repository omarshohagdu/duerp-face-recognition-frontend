import { useEffect, useId, type ReactNode } from "react";

/**
 * Every modal currently open, oldest first.
 *
 * Escape must close the TOP one only. The log viewer opens a photo on top of a
 * log, and without this both listeners fire on one keypress: the photo closes
 * and takes the log with it, which reads as the app losing your place.
 */
const stack: string[] = [];

type Size = "md" | "lg";

const SIZES: Record<Size, string> = {
  md: "max-w-2xl",
  // Log detail: tables of request/response fields need the width, and on a
  // laptop the md cap wasted most of the screen.
  lg: "w-[min(96vw,80rem)] max-w-none",
};

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: Size;
  children: ReactNode;
}

export function Modal({ open, onClose, title, size = "md", children }: Props) {
  const id = useId();

  useEffect(() => {
    if (!open) return;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1] !== id) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.lastIndexOf(id);
      if (at !== -1) stack.splice(at, 1);
    };
  }, [open, onClose, id]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`max-h-full overflow-auto rounded-xl bg-white p-2 shadow-2xl ${SIZES[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
