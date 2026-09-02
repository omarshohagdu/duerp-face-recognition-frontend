import { useEffect, useRef, useState } from "react";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Spinner } from "./ui/Spinner";
import { useAuth } from "../hooks/useAuth";
import { classifyEnroll, networkFailure, type Failure } from "../lib/errors";
import { fileToJpeg, formatBytes, jpegName } from "../lib/image";
import type { EnrollResponse, IdType } from "../types/attendance";
import * as api from "../pages/attendanceApi";

/**
 * Raw enroll form: `id`, `device_info` and multiple `images` posted to
 * POST /ext-api/wow-attendance/enroll.
 *
 * TWO THINGS THAT SEPARATE THIS FROM /face-setup:
 *
 *  - Unlike verify, enroll genuinely takes MANY images in ONE request. The
 *    server pushes every `images` part onto a list and forwards the lot to the
 *    AI platform, and `enrolled_image_count` reflects all of them. (Verify, by
 *    contrast, keeps only the last image part — which is why the manual verify
 *    form has to send one request per photo.)
 *
 *  - `id` is editable here. UI_FLOW §2.2 forbids that on the SELF-SERVICE
 *    journey, and /face-setup still honours it with a read-only id. It is
 *    exposed on this admin screen because the id being enrolled is not always
 *    the token's `sub`: a legacy DU token carries `sub = <user_id>` while
 *    enroll works in terms of the 10-digit `emp_id`, and DU's `user_id` link is
 *    what ties them together.
 *
 *    Editing it CANNOT enroll someone else. The server checks ownership and
 *    answers `401 token mismatch` for any id that is neither the token's `sub`
 *    nor an employee whose DU `user_id` is that `sub`.
 */

type IdTypeChoice = "auto" | IdType;

interface Picked {
  id: string;
  file: File;
  url: string;
}

export function ManualEnrollForm({ onEnrolled }: { onEnrolled?: () => void }) {
  const { session } = useAuth();

  const [idValue, setIdValue] = useState(session?.personId ?? "");
  const [idTypeChoice, setIdTypeChoice] = useState<IdTypeChoice>("auto");
  const [deviceInfo, setDeviceInfo] = useState(() =>
    api.deviceInfoTemplate(null),
  );
  const [picked, setPicked] = useState<Picked[]>([]);
  // Safe default: downscale and always emit JPEG (§2.3). The server can now
  // convert HEIC for enroll via a system tool, but that path is best-effort —
  // re-encoding here removes the dependency entirely.
  const [reencode, setReencode] = useState(true);

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<EnrollResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
    setResult(null);
    setFailure(null);
  }

  function removeFile(id: string) {
    setPicked((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function submit() {
    if (saving || picked.length === 0) return;

    if (!idValue.trim()) {
      setFormError("`id` is required.");
      return;
    }
    let device: string;
    try {
      // Sent as a JSON *string* in a form field (§2.4), so it is validated here
      // and re-serialized compactly rather than posted as typed.
      device = deviceInfo.trim()
        ? JSON.stringify(JSON.parse(deviceInfo))
        : "";
    } catch {
      setFormError("device_info must be valid JSON.");
      return;
    }

    setFormError(null);
    setSaving(true);
    setResult(null);
    setFailure(null);
    setProgress(0);

    try {
      const images = await Promise.all(
        picked.map((p) => (reencode ? fileToJpeg(p.file) : Promise.resolve(p.file))),
      );

      const res = await api.enroll({
        personId: idValue.trim(),
        images,
        idTypeHeader: idTypeChoice === "auto" ? undefined : idTypeChoice,
        deviceInfo: device,
        filenames: picked.map((p) =>
          reencode ? jpegName(p.file.name) : p.file.name,
        ),
        onProgress: setProgress,
      });

      // §1: the body decides, never the status code.
      if (res.data?.success === true) {
        setResult(res.data);
        onEnrolled?.();
      } else {
        setFailure(classifyEnroll(res));
      }
    } catch (err) {
      setFailure(
        err instanceof Error && !("isAxiosError" in err)
          ? {
              kind: "client-bug",
              title: "A file couldn't be read",
              detail: err.message,
              retryable: false,
            }
          : networkFailure(),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <Card
      className="mt-6"
      title="Enroll a face"
      description="Register face images against a person id."
    >
      <div className="space-y-5">
        <Alert tone="warning" title="Each enroll replaces the previous one">
          A person's active enrollment holds <em>only</em> the images in the
          request that created it. Enrolling again retires the previous version
          and keeps just what you upload here — it does not add to what is
          already on file. Past attendance records are kept either way.
        </Alert>

        {/* --- images ------------------------------------------------------ */}
        <div>
          <label className="field-label" htmlFor="enroll-images">
            images
          </label>
          <input
            id="enroll-images"
            type="file"
            multiple
            accept="image/*,.heic,.heif"
            className="field-input file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="field-hint">
            All of these go up in a single request — enroll takes many images,
            and more angles measurably improve later recognition.
          </p>

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
                Recommended. Downscales to 1600 px and always emits JPEG.
                Uncheck to send original bytes — the browser cannot decode HEIC,
                so a HEIC pick only works with this off.
              </span>
            </span>
          </label>

          {picked.length > 0 && (
            <ul className="mt-4 space-y-2">
              {picked.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
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
                  </div>
                  <button
                    type="button"
                    className="text-sm text-ink-500 hover:text-rose-600"
                    aria-label={`Remove ${item.file.name}`}
                    disabled={saving}
                    onClick={() => removeFile(item.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- id ---------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="enroll-id">
              id
            </label>
            <input
              id="enroll-id"
              className="field-input font-mono"
              value={idValue}
              onChange={(e) => setIdValue(e.target.value)}
            />
            <p className="field-hint">
              Must belong to the signed-in account — your own person id (
              <span className="font-mono">{session.personId}</span>) or an
              employee id DU links to it. Anything else is refused as a token
              mismatch; you cannot enroll on someone else's behalf.
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="enroll-id-type">
              X-Id-Type header
            </label>
            <select
              id="enroll-id-type"
              className="field-input"
              value={idTypeChoice}
              onChange={(e) => setIdTypeChoice(e.target.value as IdTypeChoice)}
            >
              <option value="auto">
                Auto — {session.isStudent ? "Student (from my session)" : "omit"}
              </option>
              <option value="Student">Student</option>
              <option value="Employee">Employee</option>
            </select>
            <p className="field-hint">
              A header, not a field — enroll ignores any <code>id_type</code> in
              the body and resolves it from DU. This is only the fallback when
              DU doesn't confirm an employee, which is every student today.
              Omitting it for a student records them as whatever
              WOW_IDTYPE_FALLBACK says.
            </p>
          </div>
        </div>

        {/* --- device_info ------------------------------------------------- */}
        <div>
          <label className="field-label" htmlFor="enroll-device-info">
            device_info (JSON)
          </label>
          <textarea
            id="enroll-device-info"
            rows={6}
            spellCheck={false}
            className="field-input font-mono text-xs"
            value={deviceInfo}
            onChange={(e) => setDeviceInfo(e.target.value)}
          />
          <p className="field-hint">
            Recorded with the enrollment. Enroll has no geo-fence, so
            coordinates are not required here.
          </p>
        </div>

        {formError && <Alert tone="danger">{formError}</Alert>}

        {failure && (
          <Alert
            tone={failure.kind === "unavailable" ? "warning" : "danger"}
            title={failure.title}
            actions={
              failure.retryable && (
                <Button onClick={() => void submit()}>Try again</Button>
              )
            }
          >
            {failure.detail}
            {failure.raw && (
              <span className="mt-1 block font-mono text-xs opacity-70">
                {failure.raw}
              </span>
            )}
          </Alert>
        )}

        {result?.success && <EnrollResult result={result} />}

        <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
          <Button
            size="lg"
            onClick={() => void submit()}
            disabled={saving || picked.length === 0}
          >
            {saving && <Spinner className="size-4" />}
            {saving
              ? "Enrolling…"
              : `Enroll ${picked.length || ""} ${picked.length === 1 ? "image" : "images"}`.trim()}
          </Button>
          {picked.length > 0 && (
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                picked.forEach((p) => URL.revokeObjectURL(p.url));
                setPicked([]);
                setResult(null);
                setFailure(null);
                setFormError(null);
              }}
            >
              Clear
            </Button>
          )}
          {saving && progress > 0 && progress < 100 && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {progress}%
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The response carries the re-enroll lineage, and that is the part an operator
 * most needs to see: `version` and `previous_enrollment_id` are the only signal
 * that this call replaced something rather than added to it.
 */
function EnrollResult({
  result,
}: {
  result: Extract<EnrollResponse, { success: true }>;
}) {
  const d = result.data;
  return (
    <Alert
      tone="success"
      title={result.message ?? "Enrolled successfully"}
    >
      <dl className="mt-2 grid gap-px overflow-hidden rounded-lg border border-emerald-200 bg-emerald-200 text-sm sm:grid-cols-3">
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Person</dt>
          <dd className="mt-0.5 font-mono">{d.id}</dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Resolved id_type</dt>
          <dd className="mt-0.5 font-medium">{d.id_type}</dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Images on file</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {d.enrolled_image_count}
          </dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Version</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{d.version}</dd>
        </div>
        <div className="bg-white p-3 sm:col-span-2">
          <dt className="text-xs text-ink-500">Enrollment id</dt>
          <dd className="mt-0.5 font-mono text-xs break-all">
            {d.enrollment_id}
          </dd>
        </div>
      </dl>

      {d.is_reenrollment && (
        <p className="mt-3">
          This <strong>replaced</strong> version {d.version - 1}. Only the{" "}
          {d.enrolled_image_count}{" "}
          {d.enrolled_image_count === 1 ? "image" : "images"} just uploaded are
          active now; the previous set was retired, not deleted.
          {d.previous_enrollment_id && (
            <span className="mt-1 block font-mono text-xs opacity-70">
              previous_enrollment_id: {d.previous_enrollment_id}
            </span>
          )}
        </p>
      )}

      {/* The DB write only happens after the platform confirms, so a success
          here always means ai_enrolled — but show it, since it is the one field
          that distinguishes a real enrollment from a local-only one. */}
      {!result.ai_enrolled && (
        <p className="mt-3 font-medium">
          Warning: the AI platform did not confirm this enrollment.
        </p>
      )}
    </Alert>
  );
}
