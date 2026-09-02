import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { classifyMapping, networkFailure, type Failure } from "../lib/errors";
import type { MappingSaveResponse } from "../types/attendance";
import * as api from "./attendanceApi";

const DEFAULT_RADIUS = 50;
/** Below this the API warns: consumer GPS drift alone is 3–50 m (§7.4). */
const TIGHT_RADIUS = 20;

interface Form {
  bodyCode: string;
  buildingName: string;
  buildingId: string;
  lat: string;
  long: string;
  radius: string;
  isActive: boolean;
}

const EMPTY: Form = {
  bodyCode: "",
  buildingName: "",
  buildingId: "",
  lat: "",
  long: "",
  radius: String(DEFAULT_RADIUS),
  isActive: true,
};

export function BuildingMapping() {
  const [form, setForm] = useState<Form>(EMPTY);
  // Held in memory for the tab only. It is a shared, long-lived admin secret,
  // so it is never a VITE_ var (that would ship it in the bundle for any end
  // user to read) and never written to localStorage (§7.7, §8.2).
  const [adminKey, setAdminKey] = useState("");
  const [confirmTight, setConfirmTight] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<MappingSaveResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  const radiusNum = Number(form.radius);
  const tight =
    form.radius !== "" && radiusNum > 0 && radiusNum < TIGHT_RADIUS;

  /** Guard client-side what the API would otherwise 400 on (§7.6). */
  function validate(): boolean {
    const next: Partial<Record<keyof Form, string>> = {};

    if (!form.bodyCode.trim()) next.bodyCode = "Required.";
    if (!form.buildingName.trim() && !form.buildingId.trim()) {
      next.buildingName = "Enter a building name, or an existing building ID.";
    }

    const lat = Number(form.lat);
    const long = Number(form.long);
    if (form.lat === "" || Number.isNaN(lat) || lat < -90 || lat > 90) {
      next.lat = "Must be between -90 and 90.";
    }
    if (form.long === "" || Number.isNaN(long) || long < -180 || long > 180) {
      next.long = "Must be between -180 and 180.";
    }
    if (form.radius !== "" && (Number.isNaN(radiusNum) || radiusNum <= 0)) {
      next.radius = "Must be greater than 0.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !validate()) return;
    // A tight fence rejects people who are genuinely inside the building, so it
    // needs confirming rather than silently accepting (§7.4).
    if (tight && !confirmTight) return;

    setSaving(true);
    setResult(null);
    setFailure(null);

    try {
      const res = await api.saveMapping(
        {
          body_code: form.bodyCode.trim(),
          ...(form.buildingId.trim()
            ? { building_id: Number(form.buildingId) }
            : { building_name: form.buildingName.trim() }),
          lat: Number(form.lat),
          long: Number(form.long),
          ...(form.radius !== "" ? { radius: radiusNum } : {}),
          is_active: form.isActive,
        },
        adminKey.trim(),
      );

      if (res.data?.success === true) {
        setResult(res.data);
      } else {
        setFailure(classifyMapping(res));
      }
    } catch {
      setFailure(networkFailure());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Building geo-fences"
        description="Define where an office's staff may check in from."
      />

      {/* §7.1: mapping-save is the only mapping endpoint — no list, no read,
          no delete. The screen is write-only and blind, and says so. Faking a
          table from client-side state would drift from the database the moment
          anyone else edits, and an admin trusting a stale geo-fence table is
          worse off than one who knows they're flying blind. */}
      <Alert tone="neutral" className="mb-6" title="This screen can't show existing mappings">
        The API has no way to read them back — only to save. Check the result
        after each save carefully: it's the only feedback there is. An office
        with no mapping means every employee in it is refused attendance.
      </Alert>

      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="field-label" htmlFor="admin-key">
              Admin key
            </label>
            <input
              id="admin-key"
              type="password"
              className="field-input font-mono"
              value={adminKey}
              autoComplete="off"
              onChange={(e) => setAdminKey(e.target.value)}
            />
            <p className="field-hint">
              Kept in this tab only — never saved to this device or built into
              the app. You'll re-enter it next session.
            </p>
          </div>

          <hr className="border-slate-200" />

          <div>
            {/* §7.3: this is `ictcell.body.body_code` — a numeric-looking
                string like 490010 — NOT `body.body_id` ("OES"). A wrong value
                SAVES SUCCESSFULLY and silently never matches anyone. Nobody
                outside the database calls it a body. */}
            <label className="field-label" htmlFor="body-code">
              Office code
            </label>
            <input
              id="body-code"
              className="field-input font-mono"
              value={form.bodyCode}
              placeholder="490010"
              onChange={(e) => set("bodyCode", e.target.value)}
            />
            {errors.bodyCode ? (
              <p className="mt-1.5 text-xs text-rose-600">{errors.bodyCode}</p>
            ) : (
              <p className="field-hint">
                e.g. 490010. This is the office code staff are assigned to — not
                a short code like "OES". A wrong code saves without error and
                then matches nobody.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="building-name">
                Building name
              </label>
              <input
                id="building-name"
                className="field-input"
                value={form.buildingName}
                placeholder="Arts Building"
                disabled={Boolean(form.buildingId.trim())}
                onChange={(e) => set("buildingName", e.target.value)}
              />
              {errors.buildingName ? (
                <p className="mt-1.5 text-xs text-rose-600">
                  {errors.buildingName}
                </p>
              ) : (
                <p className="field-hint">
                  Matched to an existing building, case-insensitively. A name
                  that doesn't match creates a new building — check the
                  spelling.
                </p>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor="building-id">
                or existing building ID
              </label>
              <input
                id="building-id"
                className="field-input font-mono"
                value={form.buildingId}
                inputMode="numeric"
                placeholder="4"
                onChange={(e) => set("buildingId", e.target.value)}
              />
              <p className="field-hint">
                Wins over the name if both are given. Buildings can't be listed,
                so only use this if you already know the ID.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="lat">
                Latitude
              </label>
              {/* 6 decimal places, so an admin can paste coordinates straight
                  out of a maps app (§7.4). */}
              <input
                id="lat"
                className="field-input font-mono"
                value={form.lat}
                inputMode="decimal"
                placeholder="23.729137"
                onChange={(e) => set("lat", e.target.value)}
              />
              {errors.lat && (
                <p className="mt-1.5 text-xs text-rose-600">{errors.lat}</p>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor="long">
                Longitude
              </label>
              <input
                id="long"
                className="field-input font-mono"
                value={form.long}
                inputMode="decimal"
                placeholder="90.398488"
                onChange={(e) => set("long", e.target.value)}
              />
              {errors.long && (
                <p className="mt-1.5 text-xs text-rose-600">{errors.long}</p>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor="radius">
                Radius (metres)
              </label>
              <input
                id="radius"
                className="field-input"
                value={form.radius}
                inputMode="numeric"
                onChange={(e) => {
                  set("radius", e.target.value);
                  setConfirmTight(false);
                }}
              />
              {errors.radius && (
                <p className="mt-1.5 text-xs text-rose-600">{errors.radius}</p>
              )}
            </div>
          </div>

          {/* Show the radius in context rather than as a bare number (§7.4). */}
          {radiusNum > 0 && !Number.isNaN(radiusNum) && (
            <p className="text-sm text-ink-500">
              Staff may check in within{" "}
              <span className="font-medium text-ink-900">{radiusNum} m</span> of
              this point.
            </p>
          )}

          {tight && (
            <Alert tone="warning" title={`${radiusNum} m is a very tight fence`}>
              GPS drift alone is 3–50 m, so valid check-ins from inside the
              building will be rejected. 50 m is the usual setting.
              <label className="mt-3 flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={confirmTight}
                  onChange={(e) => setConfirmTight(e.target.checked)}
                  className="size-4 rounded border-slate-400"
                />
                Save it anyway
              </label>
            </Alert>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
              className="size-4 rounded border-slate-400"
            />
            <span>
              Active
              <span className="ml-2 text-ink-500">
                — unchecking retires this mapping. It's the nearest thing to a
                delete; mappings can't be removed.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <Button
              type="submit"
              size="lg"
              disabled={saving || !adminKey.trim() || (tight && !confirmTight)}
            >
              {saving && <Spinner className="size-4" />}
              {saving ? "Saving…" : "Save mapping"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setForm(EMPTY);
                setResult(null);
                setFailure(null);
                setErrors({});
                setConfirmTight(false);
              }}
            >
              Clear
            </Button>
          </div>
        </form>
      </Card>

      {failure && (
        <Alert tone="danger" className="mt-6" title={failure.title}>
          {failure.detail}
        </Alert>
      )}

      {result?.success && <MappingResult result={result} />}
    </div>
  );
}

/**
 * §7.5 — with no read endpoint, this response is the ONLY signal the admin
 * ever gets. Render all of it and keep it on screen; a toast would throw away
 * the four fields below, each of which carries information available nowhere
 * else.
 */
function MappingResult({
  result,
}: {
  result: Extract<MappingSaveResponse, { success: true }>;
}) {
  const data = result.data;
  const warnings = result.warnings ?? [];
  const updated = /updated/i.test(result.message ?? "");

  return (
    <Card
      className="mt-6"
      title={
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-700"
          >
            ✓
          </span>
          {/* "Mapping created" vs "Mapping updated" is the only way to learn
              whether this office/building pair already existed — an admin who
              meant to create and sees "updated" has just overwritten someone
              else's fence. */}
          {result.message ?? "Saved"}
        </span>
      }
      description={
        updated
          ? "This office and building were already mapped — the existing fence was overwritten."
          : "A new mapping was created."
      }
    >
      <dl className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-sm sm:grid-cols-3">
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Office code</dt>
          <dd className="mt-0.5 font-mono">{data.body_code}</dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Building</dt>
          <dd className="mt-0.5 font-medium">
            {data.building_name}{" "}
            <span className="font-mono text-xs text-ink-500">
              #{data.building_id}
            </span>
          </dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Staff governed</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {data.employee_count}
          </dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Centre</dt>
          <dd className="mt-0.5 font-mono text-xs">
            {data.lat.toFixed(6)}, {data.long.toFixed(6)}
          </dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Radius</dt>
          <dd className="mt-0.5 font-medium">{data.radius} m</dd>
        </div>
        <div className="bg-white p-3">
          <dt className="text-xs text-ink-500">Status</dt>
          <dd className="mt-0.5 font-medium">
            {data.is_active ? "Active" : "Retired"}
          </dd>
        </div>
      </dl>

      {/* `building_created: true` means the name did NOT match an existing
          building and a new one was made. That is usually a typo, so it is
          called out loudly rather than buried. */}
      {data.building_created && (
        <Alert tone="warning" className="mt-4" title="A new building was created">
          "{data.building_name}" didn't match any existing building, so a new
          one was created. If that was a typo, save again with the correct
          spelling — this one will otherwise sit there unused.
        </Alert>
      )}

      {/* `employee_count: 0` is almost always a wrong office code. */}
      {data.employee_count === 0 && (
        <Alert tone="warning" className="mt-4" title="No staff are governed by this fence">
          No employee is assigned to office{" "}
          <span className="font-mono">{data.body_code}</span>, so this mapping
          will never verify anyone. Check the office code.
        </Alert>
      )}

      {/* Advisory and non-blocking, but always rendered — an empty array is the
          good case. */}
      {warnings.length > 0 && (
        <Alert tone="warning" className="mt-4" title="Saved with warnings">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      <p className="mt-4 text-xs text-ink-500">
        Mapping #{data.mapping_id}. To change it, edit the form above and save
        again — the same office and building will be updated rather than
        duplicated.
      </p>
    </Card>
  );
}
