import { useState, type ReactNode } from "react";
import { useCamera } from "../hooks/useCamera";
import { useSecureContext } from "../hooks/useSecureContext";
import { ACCEPTED_INPUT_TYPES, fileToJpeg } from "../lib/image";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Spinner";

interface Props {
  onCapture: (blob: Blob) => void;
  /** Disabled while a submit is in flight, or while an employee has no GPS fix. */
  disabled?: boolean;
  disabledReason?: ReactNode;
  captureLabel?: string;
  /** Offer the file picker too. Off for verify — the photo must be live. */
  allowUpload?: boolean;
  enabled?: boolean;
}

export function CameraCapture({
  onCapture,
  disabled = false,
  disabledReason,
  captureLabel = "Take photo",
  allowUpload = false,
  enabled = true,
}: Props) {
  const { secure, origin } = useSecureContext();
  const { videoRef, status, error, capture } = useCamera({
    enabled: enabled && secure,
  });
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // Announced to screen readers so capture state has a non-visual path (§11).
  const [announcement, setAnnouncement] = useState("");

  // Not a bug to debug — browser policy. getUserMedia is unavailable outside a
  // secure context, so say so instead of showing a permission prompt that will
  // never appear (§8.2).
  if (!secure) {
    return (
      <Alert tone="danger" title="The camera can't run on this address">
        Browsers only allow camera access over HTTPS or on{" "}
        <code className="rounded bg-white/60 px-1">localhost</code>. This page is
        served from <code className="rounded bg-white/60 px-1">{origin}</code>.
        Open it on localhost, or ask IT to serve it over HTTPS.
      </Alert>
    );
  }

  async function handleCapture() {
    if (disabled || busy) return;
    setBusy(true);
    setAnnouncement("Capturing photo…");
    try {
      const blob = await capture();
      if (blob) {
        onCapture(blob);
        setAnnouncement("Photo captured.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handlePick(file: File | undefined) {
    if (!file) return;
    setPickError(null);
    setBusy(true);
    try {
      // Re-encoded through the same canvas path as a live capture, so a picked
      // file cannot smuggle in HEIC or an oversized original (§2.3, §8.3).
      onCapture(await fileToJpeg(file));
      setAnnouncement("Photo added.");
    } catch (err) {
      setPickError(
        err instanceof Error ? err.message : "That photo couldn't be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-ink-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          // Mirrored preview so it behaves like a mirror; the capture flips it
          // back before upload.
          className="size-full -scale-x-100 object-cover"
        />

        {status === "ready" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-3/4 w-[55%] rounded-[50%] border-2 border-dashed border-white/70" />
          </div>
        )}

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
            <Spinner /> Starting the camera…
          </div>
        )}

        {(status === "denied" || status === "error") && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
            <div>
              <p className="font-medium">{error}</p>
              <p className="mt-2 text-white/70">
                {status === "denied"
                  ? "Allow camera access for this site in your browser settings, then reload."
                  : "Check that no other app is using the camera, then reload."}
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-sm text-ink-500">
        Face the camera, keep your whole face in the guide, remove any mask, and
        make sure the light is on your face rather than behind you.
      </p>

      <div aria-live="polite" className="sr-only-live">
        {announcement}
      </div>

      {disabled && disabledReason && (
        <div className="mt-3">{disabledReason}</div>
      )}

      {pickError && (
        <Alert tone="danger" className="mt-3">
          {pickError}
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          onClick={handleCapture}
          disabled={disabled || busy || status !== "ready"}
        >
          {busy ? <Spinner /> : null}
          {captureLabel}
        </Button>

        {allowUpload && (
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink-900 shadow-sm transition hover:bg-slate-50">
            Upload a photo
            <input
              type="file"
              accept={ACCEPTED_INPUT_TYPES}
              className="sr-only"
              disabled={disabled || busy}
              onChange={(e) => {
                void handlePick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
