import { useEffect, useState, type ReactNode } from "react";
import { useCamera } from "../hooks/useCamera";
import { useSecureContext } from "../hooks/useSecureContext";
import {
  ACCEPTED_INPUT_TYPES,
  cropToJpeg,
  fileToJpeg,
  type Selection,
} from "../lib/image";
import { ImageCropper } from "./ImageCropper";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Spinner";

interface Props {
  onCapture: (blob: Blob) => void;
  /** Disabled while a submit is in flight, or while an employee has no GPS fix. */
  disabled?: boolean;
  disabledReason?: ReactNode;
  captureLabel?: string;
  /**
   * Label on the crop step's confirm button — the one that actually hands the
   * photo over. On a screen that submits immediately this is the real verb
   * ("Mark attendance"), not the shutter's.
   */
  confirmLabel?: string;
  /** Offer the file picker too. Off for verify — the photo must be live. */
  allowUpload?: boolean;
  enabled?: boolean;
}

export function CameraCapture({
  onCapture,
  disabled = false,
  disabledReason,
  captureLabel = "Take photo",
  confirmLabel = "Use photo",
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

  // The frame waiting to be cropped. Nothing is handed to `onCapture` until
  // the crop is confirmed, so the caller only ever sees the selected area.
  const [pending, setPending] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);

  // The preview URL is only valid until it is revoked, so it is revoked exactly
  // once — when it is replaced or when the component goes away. Leaking these
  // pins the whole frame in memory for the life of the tab.
  useEffect(() => {
    if (!pending) return;
    return () => URL.revokeObjectURL(pending);
  }, [pending]);

  function beginCrop(blob: Blob) {
    setPendingBlob(blob);
    setPending(URL.createObjectURL(blob));
  }

  function discardCrop() {
    setPending(null);
    setPendingBlob(null);
  }

  async function confirmCrop(selection: Selection) {
    if (!pendingBlob || busy) return;
    setBusy(true);
    try {
      onCapture(await cropToJpeg(pendingBlob, selection));
      setAnnouncement("Photo cropped and added.");
      discardCrop();
    } catch (err) {
      setPickError(
        err instanceof Error ? err.message : "That photo couldn't be cropped.",
      );
    } finally {
      setBusy(false);
    }
  }

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
        beginCrop(blob);
        setAnnouncement("Photo captured. Choose the area to keep.");
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
      // It then gets the same crop step — a picked photo is framed by whoever
      // took it, so it needs cropping more than a live capture does.
      beginCrop(await fileToJpeg(file));
      setAnnouncement("Photo added. Choose the area to keep.");
    } catch (err) {
      setPickError(
        err instanceof Error ? err.message : "That photo couldn't be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  // The crop step replaces the camera rather than sitting beside it: they are
  // two stages of one action, and showing both invites a second capture that
  // would throw the first away silently.
  if (pending) {
    return (
      <div>
        <ImageCropper
          src={pending}
          onConfirm={(selection) => void confirmCrop(selection)}
          onCancel={discardCrop}
          confirmLabel={confirmLabel}
          busy={busy}
        />

        <div aria-live="polite" className="sr-only-live">
          {announcement}
        </div>

        {pickError && (
          <Alert tone="danger" className="mt-3">
            {pickError}
          </Alert>
        )}
      </div>
    );
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
