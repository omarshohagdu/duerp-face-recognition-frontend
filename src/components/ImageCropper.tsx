import { useEffect, useRef, useState } from "react";
import {
  guideSelection,
  MIN_SELECTION,
  type Selection,
} from "../lib/image";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Spinner";

/** Which grip is being dragged. `move` is the box body. */
type Grip = "move" | "nw" | "ne" | "sw" | "se";

interface Drag {
  grip: Grip;
  /** Pointer position at drag start, in fractions of the image. */
  originX: number;
  originY: number;
  /** The selection as it was when the drag started. */
  start: Selection;
}

interface Props {
  /** The full captured frame. Not modified — the crop is a new blob. */
  src: string;
  /** Natural aspect ratio, so the box can be laid out before the image paints. */
  onConfirm: (selection: Selection) => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Drag a box over the captured photo; only what is inside it gets uploaded.
 *
 * The selection is kept in image fractions, never in screen pixels — see
 * `Selection` in lib/image. Every pointer position is converted to a fraction
 * on the way in, so the box survives a viewport resize mid-drag and means the
 * same thing on a phone and a kiosk.
 *
 * Pointer events (not mouse + touch pairs) so one code path covers finger,
 * stylus and mouse; `setPointerCapture` keeps the drag alive when the finger
 * leaves the image, which is the normal way to drag a box to the very edge.
 */
export function ImageCropper({
  src,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel = "Retake",
  busy = false,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Drag | null>(null);

  // Null until the image reports its size — the default box depends on the
  // aspect ratio, so guessing one first would make the box jump on load.
  const [selection, setSelection] = useState<Selection | null>(null);

  /** Pointer position as a fraction of the rendered image box. */
  function pointToFraction(e: React.PointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function startDrag(e: React.PointerEvent, grip: Grip) {
    if (busy || !selection) return;
    const point = pointToFraction(e);
    if (!point) return;
    // Stop a grip drag from also being read as a body drag.
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      grip,
      originX: point.x,
      originY: point.y,
      start: selection,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointToFraction(e);
    if (!point) return;

    const dx = point.x - drag.originX;
    const dy = point.y - drag.originY;
    const s = drag.start;

    if (drag.grip === "move") {
      // Moving never resizes: clamp the ORIGIN against the box size, so
      // dragging past an edge parks the box flush instead of shrinking it.
      setSelection({
        ...s,
        x: clamp(s.x + dx, 0, 1 - s.width),
        y: clamp(s.y + dy, 0, 1 - s.height),
      });
      return;
    }

    // Resizing: the opposite corner is the anchor and stays put. Each edge is
    // clamped so the box keeps at least MIN_SELECTION and never leaves the
    // image — which also stops a corner being dragged through its own anchor
    // and inverting the box.
    const right = s.x + s.width;
    const bottom = s.y + s.height;
    const west = drag.grip === "nw" || drag.grip === "sw";
    const north = drag.grip === "nw" || drag.grip === "ne";

    let { x, y, width, height } = s;

    if (west) {
      x = clamp(s.x + dx, 0, right - MIN_SELECTION);
      width = right - x;
    } else {
      width = clamp(s.width + dx, MIN_SELECTION, 1 - s.x);
    }

    if (north) {
      y = clamp(s.y + dy, 0, bottom - MIN_SELECTION);
      height = bottom - y;
    } else {
      height = clamp(s.height + dy, MIN_SELECTION, 1 - s.y);
    }

    setSelection({ x, y, width, height });
  }

  // No explicit releasePointerCapture: this fires on the frame, which is never
  // the element that captured, and the browser drops the capture on pointerup
  // and pointercancel anyway.
  function endDrag() {
    dragRef.current = null;
  }

  // A cached image can be complete before this effect runs, in which case the
  // `load` event has already fired and would never arrive.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const size = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setSelection(guideSelection(img.naturalWidth / img.naturalHeight));
      }
    };
    if (img.complete) size();
    else img.addEventListener("load", size, { once: true });
    return () => img.removeEventListener("load", size);
  }, [src]);

  const box = selection && {
    left: `${selection.x * 100}%`,
    top: `${selection.y * 100}%`,
    width: `${selection.width * 100}%`,
    height: `${selection.height * 100}%`,
  };

  const grips: { grip: Grip; className: string; cursor: string }[] = [
    { grip: "nw", className: "-top-1.5 -left-1.5", cursor: "nwse-resize" },
    { grip: "ne", className: "-top-1.5 -right-1.5", cursor: "nesw-resize" },
    { grip: "sw", className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
    { grip: "se", className: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
  ];

  return (
    <div>
      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-xl bg-ink-900 select-none"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* `object-contain`: the whole captured frame has to be croppable, so
            nothing may be hidden by the container the way the live preview
            hides it with object-cover. */}
        <img
          ref={imgRef}
          src={src}
          alt="The photo you just took, ready to crop"
          className="block max-h-[60vh] w-full object-contain"
          draggable={false}
        />

        {box && (
          <>
            {/* Dim everything outside the box, so what will be uploaded is the
                bright part. Four panes rather than a giant box-shadow — a
                shadow that size is a repaint on every pointer move. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: box.top }} />
              <div
                className="absolute inset-x-0 bottom-0 bg-black/55"
                style={{ top: `calc(${box.top} + ${box.height})` }}
              />
              <div
                className="absolute left-0 bg-black/55"
                style={{ top: box.top, height: box.height, width: box.left }}
              />
              <div
                className="absolute right-0 bg-black/55"
                style={{ top: box.top, height: box.height, left: `calc(${box.left} + ${box.width})` }}
              />
            </div>

            <div
              role="group"
              aria-label="Crop area"
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              // touchAction none, or a finger drag scrolls the page instead of
              // moving the box and the crop step is unusable on a phone.
              style={{ ...box, touchAction: "none" }}
              onPointerDown={(e) => startDrag(e, "move")}
            >
              {grips.map(({ grip, className, cursor }) => (
                <span
                  key={grip}
                  // Hit area is bigger than the dot: a 12px target is unusable
                  // with a finger, and this screen is used on phones.
                  className={`absolute size-6 ${className} -m-1.5 flex items-center justify-center`}
                  style={{ cursor, touchAction: "none" }}
                  onPointerDown={(e) => startDrag(e, grip)}
                >
                  <span className="size-3 rounded-full border border-ink-900/40 bg-white" />
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="mt-3 text-sm text-ink-500">
        Drag the box over your face, or pull a corner to resize it. Only what is
        inside the box is uploaded.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          disabled={busy || !selection}
          onClick={() => selection && onConfirm(selection)}
        >
          {busy ? <Spinner /> : null}
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="lg" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
