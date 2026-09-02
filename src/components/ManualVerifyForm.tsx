import { useEffect, useRef, useState } from "react";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Spinner";
import type { Coords } from "../hooks/useGeolocation";
import { classifyVerify, networkFailure, outOfAreaDetail, type Failure } from "../lib/errors";
import { fileToJpeg, formatBytes, jpegName } from "../lib/image";
import type { VerifyLocation, VerifyResponse } from "../types/attendance";
import * as api from "../pages/attendanceApi";

/**
 * Manual upload alternative to the live camera on /attendance/mark.
 *
 * It exists for the cases the camera flow cannot serve: a desktop with no
 * camera, a non-secure origin where `getUserMedia` is refused outright
 * (UI_FLOW §8.2), and testing recognition against known sample images. It
 * exposes the three fields the endpoint actually takes — `id`, `device_info`
 * and the image — as editable inputs rather than deriving them.
 *
 * WHY ONE REQUEST PER IMAGE: the server parses the multipart body assigning
 * `live_image = filepath` for every `image`/`images`/`file`/`photo` part it
 * meets, so a request carrying several images keeps only the LAST one. The
 * earlier ones are written to disk and then ignored — never sent to
 * /recognize. Posting them all in one request would therefore look like it
 * checked every photo while actually checking one.
 *
 * So a multi-image run is a SEQUENCE of verify calls, and it stops at the
 * first success: the endpoint is not idempotent, and continuing past a match
 * would record a second attendance row for the same person (§10).
 */

interface Props {
  coords: Coords | null;
  /** Employees are geo-fenced; students are recorded without a location check. */
  needsLocation: boolean;
  onMarked: (at: string, building?: string) => void;
}

interface Picked {
  id: string;
  file: File;
  url: string;
}

type Outcome =
  | { state: "pending" }
  | { state: "running" }
  | { state: "success"; message: string }
  | { state: "failed"; failure: Failure; location: VerifyLocation | null };

export function ManualVerifyForm({ coords, needsLocation, onMarked }: Props) {
  const [deviceInfo, setDeviceInfo] = useState(() =>
    api.deviceInfoTemplate(coords),
  );
  const [deviceInfoTouched, setDeviceInfoTouched] = useState(false);

  const [picked, setPicked] = useState<Picked[]>([]);
  // Re-encoding through a canvas is the safe default: it downscales and always
  // emits JPEG, which is what sidesteps the HEIC trap (§2.3). Turning it off
  // sends the file's original bytes, which is the only way to exercise the
  // server's own handling of HEIC and oversized originals.
  const [reencode, setReencode] = useState(true);
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Keep the prefilled device_info in step with a GPS fix arriving later, but
  // never overwrite what the operator has typed.
  useEffect(() => {
    if (!deviceInfoTouched) setDeviceInfo(api.deviceInfoTemplate(coords));
  }, [coords, deviceInfoTouched]);

  const pickedRef = useRef<Picked[]>([]);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  useEffect(
    () => () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );

  function addFiles(files: FileList | null) {
    if (!files) return;
    setPicked((prev) => [
      ...prev,
      ...Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
    setOutcomes({});
  }

  function removeFile(id: string) {
    setPicked((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function parsedDeviceInfo(): string | null {
    const text = deviceInfo.trim();
    if (!text) return "";
    try {
      // Sent as a JSON *string* in a form field (§2.4) — so it is validated
      // here and re-serialized compactly, never posted as typed.
      return JSON.stringify(JSON.parse(text));
    } catch {
      return null;
    }
  }

  async function run() {
    if (running || picked.length === 0) return;

    const device = parsedDeviceInfo();
    if (device === null) {
      setFormError("device_info must be valid JSON.");
      return;
    }
    setFormError(null);
    setRunning(true);

    const next: Record<string, Outcome> = {};
    picked.forEach((p) => (next[p.id] = { state: "pending" }));
    setOutcomes({ ...next });

    for (const item of picked) {
      next[item.id] = { state: "running" };
      setOutcomes({ ...next });

      try {
        const image = reencode ? await fileToJpeg(item.file) : item.file;
        const res = await api.verify({
          image,
          filename: reencode ? jpegName(item.file.name) : item.file.name,
          // No `id`: this is 1:N identify — attendance is recorded for whoever
          // the platform recognises. The server still refuses to mark anyone
          // but the token holder, so this cannot check someone else in.
          deviceInfo: device,
        });
        const body = res.data as VerifyResponse;

        // §1: the body decides, never the status code.
        if (body?.success === true) {
          next[item.id] = {
            state: "success",
            message: body.message ?? "Attendance marked",
          };
          setOutcomes({ ...next });
          onMarked(
            body.data?.matched_at ?? new Date().toISOString(),
            body.location?.building_name,
          );
          setRunning(false);
          return; // stop at the first success — see the note at the top
        }

        next[item.id] = {
          state: "failed",
          failure: classifyVerify(res),
          location: body?.location ?? null,
        };
      } catch (err) {
        next[item.id] = {
          state: "failed",
          failure:
            err instanceof Error && !("isAxiosError" in err)
              ? {
                  kind: "client-bug",
                  title: "That file couldn't be read",
                  detail: err.message,
                  retryable: false,
                }
              : networkFailure(),
          location: null,
        };
      }
      setOutcomes({ ...next });
    }

    setRunning(false);
  }

  const ran = Object.keys(outcomes).length > 0;

  return (
    <div className="space-y-5">
      <Alert tone="neutral" title="One photo is checked per request">
        Attendance is recorded for whoever the platform recognises in the photo
        — it can only ever be you, since the server refuses to mark anyone but
        the signed-in account present. The endpoint recognises a single face
        per call, so several photos are sent as separate requests, one after
        another, stopping as soon as one is recognised. That way only one
        attendance record is ever created.
      </Alert>

      {/* --- images -------------------------------------------------------- */}
      <div>
        <label className="field-label" htmlFor="manual-images">
          images
        </label>
        <input
          id="manual-images"
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          className="field-input file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 rounded border-slate-400"
            checked={reencode}
            onChange={(e) => setReencode(e.target.checked)}
          />
          <span>
            Re-encode as JPEG before upload
            <span className="block text-xs text-ink-500">
              Recommended. Downscales to 1600 px and always emits JPEG, which
              avoids the HEIC problem. Uncheck to send the original bytes —
              needed to test HEIC or oversized files, and note the browser
              cannot re-encode HEIC at all.
            </span>
          </span>
        </label>

        {picked.length > 0 && (
          <ul className="mt-4 space-y-2">
            {picked.map((item, index) => {
              const outcome = outcomes[item.id];
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <img
                    src={item.url}
                    alt=""
                    className="size-14 shrink-0 rounded-md border border-slate-200 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {index + 1}. {item.file.name}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatBytes(item.file.size)}
                      {item.file.type ? ` · ${item.file.type}` : ""}
                    </p>
                    {outcome && <OutcomeLine outcome={outcome} />}
                  </div>
                  <button
                    type="button"
                    className="text-sm text-ink-500 hover:text-rose-600"
                    aria-label={`Remove ${item.file.name}`}
                    disabled={running}
                    onClick={() => removeFile(item.id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* --- device_info (§2.4) -------------------------------------------- */}
      <div>
        <label className="field-label" htmlFor="device-info">
          device_info (JSON)
        </label>
        <textarea
          id="device-info"
          rows={7}
          spellCheck={false}
          className="field-input font-mono text-xs"
          value={deviceInfo}
          onChange={(e) => {
            setDeviceInfo(e.target.value);
            setDeviceInfoTouched(true);
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!coords}
            onClick={() => {
              setDeviceInfo(api.deviceInfoTemplate(coords));
              setDeviceInfoTouched(false);
            }}
          >
            {coords ? "Reset with my location" : "Waiting for location…"}
          </Button>
        </div>
        <p className="field-hint">
          {needsLocation
            ? "Employees are geo-fenced, so this must carry latitude and longitude — accepted as latitude/lat/device_lat and longitude/long/lng/device_long. 0, 0 is rejected as “no fix”, not as a location."
            : "Students are recorded without a location check, so coordinates are optional here."}
        </p>
      </div>

      {formError && <Alert tone="danger">{formError}</Alert>}

      {ran && !running && (
        <Alert tone="warning" title="No photo was recognised">
          None of these marked attendance. Check the per-photo results above.
        </Alert>
      )}

      <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
        <Button
          size="lg"
          onClick={() => void run()}
          disabled={running || picked.length === 0}
        >
          {running && <Spinner className="size-4" />}
          {running
            ? "Checking…"
            : `Verify ${picked.length || ""} ${picked.length === 1 ? "photo" : "photos"}`.trim()}
        </Button>
        {picked.length > 0 && (
          <Button
            variant="secondary"
            disabled={running}
            onClick={() => {
              picked.forEach((p) => URL.revokeObjectURL(p.url));
              setPicked([]);
              setOutcomes({});
              setFormError(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (outcome.state === "pending") {
    return <p className="mt-1 text-xs text-ink-400">Queued</p>;
  }
  if (outcome.state === "running") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
        <Spinner className="size-3" /> Checking…
      </p>
    );
  }
  if (outcome.state === "success") {
    return (
      <p className="mt-1 text-xs font-medium text-emerald-700">
        ✓ {outcome.message}
      </p>
    );
  }

  const { failure, location } = outcome;
  return (
    <p className="mt-1 text-xs text-amber-700">
      {failure.title}
      {failure.kind === "out-of-area" ? ` — ${outOfAreaDetail(location)}` : ""}
      {failure.raw && (
        <span className="mt-0.5 block font-mono text-ink-400">
          {failure.raw}
        </span>
      )}
    </p>
  );
}
