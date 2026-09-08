import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CameraCapture } from "../components/CameraCapture";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { useAuth } from "../hooks/useAuth";
import { classifyEnroll, networkFailure, type Failure } from "../lib/errors";
import { fullDateTime, relativeTime } from "../lib/format";
import { formatBytes, releaseCapture, toCapture, type Capture } from "../lib/image";
import * as api from "./attendanceApi";
import type { CheckEnrolledResponse, EnrollResponse } from "../types/attendance";

/** A2 asks for consent before A3 opens the camera; A4 is the last look before upload. */
type Stage = "entry" | "consent" | "capture" | "review" | "submitting" | "result";

const MIN_PHOTOS = 2;
const MAX_PHOTOS = 3;

interface EnrolledState {
  enrolled: boolean;
  enrolledAt?: string;
  imageCount?: number;
  version?: number;
}

export function EnrollFace() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>("entry");
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState<EnrolledState | null>(null);
  const [statusFailure, setStatusFailure] = useState<Failure | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<EnrollResponse | null>(null);

  // Every object URL must be revoked on unmount, but the cleanup must not
  // re-run (and re-revoke live thumbnails) each time the array changes — so the
  // latest captures are mirrored into a ref and released once, at teardown.
  const capturesRef = useRef<Capture[]>([]);
  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);
  useEffect(() => () => capturesRef.current.forEach(releaseCapture), []);

  /**
   * A1 calls `check` first so the screen OPENS in the right state rather than
   * guessing (§3.2). Note "not enrolled" comes back as 200 with
   * `success: false` and `enrolled: false` — a legitimate answer, not an error.
   *
   * Anything that is NOT that answer (a 401, a transport failure) means the
   * status is simply unknown. Rendering "you haven't registered a face yet" in
   * that case would be guessing — and guessing wrong invites the user into a
   * flow that is about to fail the same way. So an unknown status says so.
   */
  const refreshStatus = useCallback(async () => {
    if (!session) return;
    setChecking(true);
    setStatusFailure(null);
    try {
      const res = await api.checkEnrolled(session.personId);
      const body = res.data as CheckEnrolledResponse;

      if (typeof body?.enrolled === "boolean") {
        setExisting(
          body.enrolled
            ? {
                enrolled: true,
                enrolledAt: body.data?.enrolled_at,
                imageCount: body.data?.image_count,
                version: body.data?.version,
              }
            : { enrolled: false },
        );
      } else {
        setExisting(null);
        setStatusFailure(classifyEnroll(res));
      }
    } catch {
      setExisting(null);
      setStatusFailure(networkFailure());
    } finally {
      setChecking(false);
    }
  }, [session]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  function addCapture(blob: Blob) {
    setCaptures((prev) =>
      prev.length >= MAX_PHOTOS ? prev : [...prev, toCapture(blob)],
    );
  }

  function removeCapture(id: string) {
    setCaptures((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target) releaseCapture(target);
      return prev.filter((c) => c.id !== id);
    });
  }

  function restart() {
    captures.forEach(releaseCapture);
    setCaptures([]);
    setFailure(null);
    setResult(null);
    setProgress(0);
    setStage("entry");
    void refreshStatus();
  }

  async function submit() {
    if (!session || captures.length === 0) return;
    setStage("submitting");
    setFailure(null);
    setProgress(0);

    try {
      const res = await api.enroll({
        personId: session.personId,
        images: captures.map((c) => c.blob),
        name: session.displayName,
        idTypeHeader: session.isStudent ? "Student" : undefined,
        deviceInfo: api.deviceInfoField(),
        onProgress: setProgress,
      });

      // §1: the status code classifies a failure but never confirms success.
      // `success` in the body is what decides.
      if (res.data?.success === true) {
        setResult(res.data);
        setStage("result");
      } else {
        setFailure(classifyEnroll(res));
        setStage("result");
      }
    } catch {
      setFailure(networkFailure());
      setStage("result");
    }
  }

  if (!session) return null;

  // --- A5 · Submitting ------------------------------------------------------
  // Blocking and non-cancellable, with an honest label: this does a network
  // round-trip PLUS an AI platform round-trip and can take several seconds
  // (§3.2). A bare spinner reads as a hang.
  if (stage === "submitting") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Spinner className="mx-auto size-10 text-brand-600" />
        <h1 className="mt-6 text-xl font-semibold">Enrolling your face…</h1>
        <p className="mt-2 text-sm text-ink-500">
          This takes a few seconds. Please don't close this page.
        </p>
        {progress > 0 && progress < 100 && (
          <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // --- A6 · Result ----------------------------------------------------------
  if (stage === "result") {
    if (failure) {
      return (
        <div className="mx-auto max-w-md py-12">
          <Alert
            tone={failure.kind === "unavailable" ? "warning" : "danger"}
            title={failure.title}
            actions={
              <>
                {failure.retryable && (
                  <Button onClick={() => void submit()}>Try again</Button>
                )}
                <Button variant="secondary" onClick={restart}>
                  Start over
                </Button>
              </>
            }
          >
            {failure.detail}
          </Alert>
          {failure.raw && (
            <p className="mt-3 text-center font-mono text-xs text-ink-400">
              {failure.raw}
            </p>
          )}
        </div>
      );
    }

    const data = result?.success ? result.data : undefined;
    // "Face updated" rather than "Enrolled" — the user knows the difference
    // between a first setup and a replacement (§3.2).
    const reenrolled = data?.is_reenrollment;

    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
          ✓
        </span>
        <h1 className="mt-6 text-xl font-semibold">
          {reenrolled ? "Face updated" : "Face enrolled"}
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          {session.displayName} — {data?.enrolled_image_count ?? captures.length}{" "}
          {(data?.enrolled_image_count ?? captures.length) === 1
            ? "photo"
            : "photos"}{" "}
          registered.
        </p>
        <div className="mt-8 flex flex-col gap-2">
          <Button size="lg" onClick={() => navigate("/attendance/mark")}>
            Mark attendance
          </Button>
          <Button variant="ghost" onClick={restart}>
            Back to face setup
          </Button>
        </div>
      </div>
    );
  }

  // --- A4 · Review ----------------------------------------------------------
  // The last chance before upload. Without it users routinely submit a blurred
  // first frame (§3.2).
  if (stage === "review") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Check your photos"
          description="Retake anything blurred, dark, or partly out of frame."
        />
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {captures.map((capture, i) => (
              <figure key={capture.id}>
                <img
                  src={capture.url}
                  alt={`Captured photo ${i + 1}`}
                  className="aspect-[3/4] w-full rounded-lg border border-slate-200 object-cover"
                />
                <figcaption className="mt-2 flex items-center justify-between text-xs text-ink-500">
                  <span>{formatBytes(capture.blob.size)}</span>
                  <button
                    type="button"
                    className="font-medium text-brand-700 hover:underline"
                    onClick={() => {
                      removeCapture(capture.id);
                      setStage("capture");
                    }}
                  >
                    Retake
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>

          {existing?.enrolled && (
            <Alert tone="warning" className="mt-6">
              This replaces your existing photos. Your past attendance is kept.
            </Alert>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => void submit()}>
              Submit {captures.length}{" "}
              {captures.length === 1 ? "photo" : "photos"}
            </Button>
            {captures.length < MAX_PHOTOS && (
              <Button variant="secondary" onClick={() => setStage("capture")}>
                Add another
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // --- A3 · Capture ---------------------------------------------------------
  if (stage === "capture") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Take your photos"
          description={`Capture ${MIN_PHOTOS}–${MAX_PHOTOS} photos from slightly different angles — more angles measurably improve recognition later.`}
        />
        <Card>
          <CameraCapture
            onCapture={addCapture}
            disabled={captures.length >= MAX_PHOTOS}
            disabledReason={
              <Alert tone="neutral">
                That's {MAX_PHOTOS} photos — enough. Review them to finish.
              </Alert>
            }
            captureLabel={
              captures.length === 0 ? "Take photo" : "Take another photo"
            }
            // Enrolment collects several photos, so confirming a crop adds one
            // to the strip rather than finishing anything.
            confirmLabel="Add photo"
            allowUpload
          />

          {captures.length > 0 && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="mb-3 text-sm font-medium text-ink-700">
                {captures.length} of {MAX_PHOTOS} captured
              </p>
              <div className="flex flex-wrap gap-3">
                {captures.map((capture, i) => (
                  <div key={capture.id} className="relative">
                    <img
                      src={capture.url}
                      alt={`Captured photo ${i + 1}`}
                      className="size-20 rounded-lg border border-slate-200 object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => removeCapture(capture.id)}
                      className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-ink-900 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <Button
                className="mt-5"
                size="lg"
                onClick={() => setStage("review")}
                disabled={captures.length < MIN_PHOTOS}
              >
                {captures.length < MIN_PHOTOS
                  ? `Take ${MIN_PHOTOS - captures.length} more`
                  : "Review photos"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // --- A2 · Explainer + consent --------------------------------------------
  // This is biometric capture, so it is said plainly, on its own screen, with
  // one Continue — not buried in a terms link (§3.2).
  if (stage === "consent") {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Before you set up your face" />
        <Card>
          <ul className="space-y-3 text-sm text-ink-700">
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-brand-600">
                •
              </span>
              <span>
                Your photos are stored by the university and sent to a face
                recognition service.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-brand-600">
                •
              </span>
              <span>
                Enrolling is what lets you mark attendance with the camera
                instead of signing in manually.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-brand-600">
                •
              </span>
              <span>
                You can re-enroll at any time. A new enrollment replaces your
                existing photos; your past attendance is kept.
              </span>
            </li>
          </ul>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => setStage("capture")}>
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setStage("entry")}>
              Cancel
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // --- A1 · Entry -----------------------------------------------------------
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Face setup"
        description="Register your face so you can mark attendance with the camera."
      />

      <Card>
        {checking ? (
          <div className="flex items-center gap-3 text-sm text-ink-500">
            <Spinner /> Checking your enrollment…
          </div>
        ) : existing?.enrolled ? (
          <>
            <Alert tone="success" title="Your face is registered">
              {existing.imageCount ?? 0}{" "}
              {existing.imageCount === 1 ? "photo" : "photos"} on file
              {existing.enrolledAt && (
                <>
                  , enrolled{" "}
                  <time
                    dateTime={existing.enrolledAt}
                    title={fullDateTime(existing.enrolledAt)}
                  >
                    {relativeTime(existing.enrolledAt)}
                  </time>
                </>
              )}
              {existing.version && existing.version > 1
                ? ` · updated ${existing.version - 1} ${existing.version - 1 === 1 ? "time" : "times"}`
                : ""}
              .
            </Alert>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => setStage("consent")}>
                Re-enroll
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate("/attendance/mark")}
              >
                Mark attendance
              </Button>
            </div>
            <p className="mt-4 text-xs text-ink-500">
              Re-enrolling replaces your existing photos with the new ones.
            </p>
          </>
        ) : statusFailure ? (
          <>
            <Alert
              tone="warning"
              title="We couldn't check your enrollment"
              actions={
                <Button variant="secondary" onClick={() => void refreshStatus()}>
                  Check again
                </Button>
              }
            >
              {statusFailure.detail} You can still try setting up your face.
            </Alert>
            <Button
              className="mt-6"
              size="lg"
              onClick={() => setStage("consent")}
            >
              Set up face
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-700">
              You haven't registered a face yet. It takes about a minute and{" "}
              {MIN_PHOTOS}–{MAX_PHOTOS} photos.
            </p>
            <Button
              className="mt-6"
              size="lg"
              onClick={() => setStage("consent")}
            >
              Set up face
            </Button>
          </>
        )}

        {/* §2.2: identity comes from the token, never from a form field — so
            this is shown, never offered as an input. */}
        <dl className="mt-6 border-t border-slate-200 pt-5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Enrolling as</dt>
            <dd className="text-right">
              <span className="font-medium">{session.displayName}</span>
              <span className="ml-2 font-mono text-xs text-ink-500">
                {session.personId}
              </span>
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
