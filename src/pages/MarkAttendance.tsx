import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CameraCapture } from "../components/CameraCapture";
import { ManualVerifyForm } from "../components/ManualVerifyForm";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { useAuth } from "../hooks/useAuth";
import { useGeolocation } from "../hooks/useGeolocation";
import { useSecureContext } from "../hooks/useSecureContext";
import {
  classifyVerify,
  networkFailure,
  outOfAreaDetail,
  type Failure,
} from "../lib/errors";
import { timeOnly } from "../lib/format";
import type { VerifyLocation, VerifyResponse } from "../types/attendance";
import * as api from "./attendanceApi";

type Stage = "capture" | "submitting" | "marked" | "failed";

/**
 * The camera is the primary path, but it cannot run everywhere: a desktop with
 * no camera, or any non-secure origin, refuses `getUserMedia` outright
 * (§8.2). Manual upload is the fallback, and also the way to test recognition
 * against known sample images.
 */
type Mode = "camera" | "manual";

const MODE_STORAGE_KEY = "duerp_mark_mode";

interface Marked {
  at: string;
  building?: string;
}

export function MarkAttendance() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { secure } = useSecureContext();

  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(MODE_STORAGE_KEY) as Mode | null) ?? "camera",
  );
  const [stage, setStage] = useState<Stage>("capture");
  const [marked, setMarked] = useState<Marked | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [location, setLocation] = useState<VerifyLocation | null>(null);
  const [attempts, setAttempts] = useState(0);

  // Students are recorded WITHOUT a location check — no student location data
  // exists yet — so a student must never be blocked on GPS (§2.4).
  const needsLocation = Boolean(session && !session.isStudent);
  const geo = useGeolocation({ enabled: needsLocation && secure });

  // The gate fails closed: no coordinates means no attendance. `coords` stays
  // null until a real (non-0,0) fix arrives, and that is what keeps the button
  // disabled rather than submitting a placeholder the server will reject.
  const locationReady = !needsLocation || geo.coords !== null;

  if (!session) return null;

  async function submit(image: Blob) {
    setStage("submitting");
    setFailure(null);
    setLocation(null);

    try {
      const res = await api.verify({
        image,
        // 1:1 guard. The session already knows who this is, so narrowing turns
        // a silent mis-identification into an explicit "that doesn't look like
        // you" — a far better failure than marking the wrong person present
        // (§4.2).
        personId: session!.personId,
        deviceInfo: api.deviceInfoField(geo.coords),
      });

      const body = res.data as VerifyResponse;
      setLocation(body?.location ?? null);

      // §1 again: a 200 is not a success. `matched: false` arrives as 200 with
      // `success: false` and is the single most common real-world outcome.
      if (body?.success === true) {
        setMarked({
          at: body.data?.matched_at ?? new Date().toISOString(),
          building: body.location?.building_name,
        });
        setAttempts(0);
        setStage("marked");
      } else {
        setFailure(classifyVerify(res));
        setAttempts((n) => n + 1);
        setStage("failed");
      }
    } catch {
      setFailure(networkFailure());
      setStage("failed");
    }
  }

  function retry() {
    setStage("capture");
    setFailure(null);
    setLocation(null);
  }

  // --- B4 · Submitting ------------------------------------------------------
  if (stage === "submitting") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Spinner className="mx-auto size-10 text-brand-600" />
        <h1 className="mt-6 text-xl font-semibold">Checking your face…</h1>
        <p className="mt-2 text-sm text-ink-500">
          This takes a few seconds. Please don't close this page.
        </p>
      </div>
    );
  }

  // --- B5 · Marked ----------------------------------------------------------
  // Name the building the check-in registered at, straight from
  // `location.building_name` — don't make them guess where it landed (§4.3).
  if (stage === "marked" && marked) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
          ✓
        </span>
        <h1 className="mt-6 text-2xl font-semibold">Attendance marked</h1>
        <p className="mt-2 text-ink-500">
          {timeOnly(marked.at)}
          {marked.building ? ` · ${marked.building}` : ""}
        </p>
        <Button className="mt-8" variant="secondary" onClick={retry}>
          Done
        </Button>
      </div>
    );
  }

  // --- B5 · Failure screens -------------------------------------------------
  if (stage === "failed" && failure) {
    const outOfArea = failure.kind === "out-of-area";

    return (
      <div className="mx-auto max-w-md py-12">
        <Alert
          tone={failure.kind === "not-your-face" ? "danger" : "warning"}
          title={failure.title}
          actions={
            <>
              {failure.retryable && <Button onClick={retry}>Try again</Button>}
              {/* A secondary route to re-enroll, for the face that keeps
                  failing to match (§4.3). */}
              {(failure.kind === "not-recognized" ||
                failure.kind === "wrong-person") && (
                <Button variant="secondary" onClick={() => navigate("/face-setup")}>
                  Set up my face again
                </Button>
              )}
              {failure.kind === "session" && (
                <Button onClick={() => navigate("/login")}>Sign in again</Button>
              )}
            </>
          }
        >
          {outOfArea ? outOfAreaDetail(location) : failure.detail}
        </Alert>

        {outOfArea && location?.distance_m != null && (
          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-sm">
            <div className="bg-white p-3">
              <dt className="text-xs text-ink-500">Nearest building</dt>
              <dd className="mt-0.5 font-medium">
                {location.building_name ?? "—"}
              </dd>
            </div>
            <div className="bg-white p-3">
              <dt className="text-xs text-ink-500">Your distance</dt>
              <dd className="mt-0.5 font-medium">
                {Math.round(location.distance_m)} m
                {location.radius_m != null && (
                  <span className="ml-1 font-normal text-ink-500">
                    (limit {Math.round(location.radius_m)} m)
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}

        {/* Open question §12.1: unlimited retries on a face that won't match is
            frustrating. Surface the alternative after a few failures rather
            than looping silently. */}
        {attempts >= 3 &&
          (failure.kind === "not-recognized" ||
            failure.kind === "wrong-person") && (
            <Alert tone="neutral" className="mt-4">
              Still not working? Re-enrolling your face usually fixes repeated
              mismatches. If it doesn't, contact your administrator.
            </Alert>
          )}

        {failure.raw && (
          <p className="mt-4 text-center font-mono text-xs text-ink-400">
            {failure.raw}
          </p>
        )}
      </div>
    );
  }

  // --- B1/B2/B3 · Entry, location gate, capture -----------------------------
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Mark attendance"
        description={
          mode === "camera"
            ? "Take one photo — it's submitted straight away."
            : "Upload photos instead of using the camera."
        }
      />

      <div
        role="tablist"
        aria-label="Capture method"
        className="mb-4 inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5"
      >
        {(
          [
            ["camera", "Camera"],
            ["manual", "Manual upload"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              localStorage.setItem(MODE_STORAGE_KEY, value);
            }}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-medium transition",
              mode === value
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-900",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        {/* B2 · Location gate. Employees only, and only while there's no fix.
            It gates the CAMERA button — in manual mode the operator writes
            device_info themselves, so blocking the form there would leave them
            no way to supply coordinates at all (§2.4, §4.3). */}
        {mode === "camera" && needsLocation && !locationReady && (
          <div className="mb-5">
            {geo.status === "denied" ? (
              <Alert tone="danger" title="Location access is blocked">
                Attendance check-ins are tied to your office's building, so we
                need your location. Allow location access for this site in your
                browser settings, then reload this page.
              </Alert>
            ) : geo.status === "error" ? (
              <Alert tone="warning" title="We can't get your location">
                {geo.error}
              </Alert>
            ) : (
              <Alert tone="neutral">
                <span className="flex items-center gap-2">
                  <Spinner className="size-4" /> Getting your location…
                </span>
              </Alert>
            )}
          </div>
        )}

        {mode === "camera" && needsLocation && locationReady && geo.coords && (
          <p className="mb-4 text-xs text-ink-500">
            Location found (accurate to about {Math.round(geo.coords.accuracy)}{" "}
            m).
          </p>
        )}

        {mode === "camera" ? (
          <CameraCapture
            onCapture={(blob) => void submit(blob)}
            disabled={!locationReady}
            disabledReason={null}
            captureLabel="Take photo"
            // B3: still a single shot that submits without a separate review
            // screen — the crop step IS the review, and confirming it is what
            // marks attendance, so the verb belongs on that button rather than
            // on the shutter (§4.3). The photo must be live, so no file picker
            // on this path.
            confirmLabel="Mark attendance"
            allowUpload={false}
          />
        ) : (
          <ManualVerifyForm
            coords={geo.coords}
            needsLocation={needsLocation}
            onMarked={(at, building) => {
              setMarked({ at, building });
              setAttempts(0);
              setStage("marked");
            }}
          />
        )}
      </Card>
    </div>
  );
}
