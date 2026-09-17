import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { Spinner } from "../components/ui/Spinner";
import * as api from "../api/settings";

/**
 * The NFC face-verification switch.
 *
 * WHAT THIS SWITCH DOES, stated plainly because the screen has to say it too:
 * with it OFF, `save_card_info` writes a card mapping WITHOUT comparing the
 * card photo to the student's selfie. That is the point of having it — a face
 * service outage should not stop the card desk — but it is also exactly how a
 * card gets registered against the wrong person, so the screen warns before
 * the save and the service records who flipped it.
 *
 * STORED vs EFFECTIVE. Until somebody saves here, the service is still reading
 * `NFC_FACE_VERIFY_URL` from its `.env` and ignoring these rows. The API
 * returns both, and this screen shows the difference rather than implying the
 * stored values are live.
 */
export function FaceVerification() {
  const [loaded, setLoaded] = useState<api.FaceVerifySettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<api.Err | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await api.getFaceVerify();
    if (!res.success) return setError(res);
    setError(null);
    setLoaded(res.data);
    setEnabled(res.data.nfc_face_verify === "ON");
    setUrl(res.data.nfc_face_verify_url);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setNotice(null);
    // Send the URL only when it differs, so "flip the switch" stays a flip:
    // the API leaves the stored URL alone when the field is absent.
    const changedUrl = url.trim() !== (loaded?.nfc_face_verify_url ?? "");
    const res = await api.putFaceVerify(
      enabled ? "ON" : "OFF",
      changedUrl ? url.trim() : undefined,
    );
    setSaving(false);
    if (!res.success) return setError(res);
    setError(null);
    setNotice(res.message ?? "Settings updated");
    await load();
  }

  if (!loaded && !error) {
    return (
      <Card>
        <div className="flex items-center gap-3 p-6 text-ink-500">
          <Spinner /> Loading settings…
        </div>
      </Card>
    );
  }

  const effective = loaded?.effective;
  const unmanaged = effective && !effective.managed_here;
  const dirty =
    loaded !== null &&
    (enabled !== (loaded.nfc_face_verify === "ON") ||
      url.trim() !== loaded.nfc_face_verify_url);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Face verification"
        description="Whether registering an NFC card compares the card photo with the student's selfie."
      />

      {error ? (
        <Alert
          tone={error.code === "forbidden" ? "warning" : "danger"}
          title={error.message}
        >
          {error.code === "forbidden"
            ? "Your account does not hold admin.settings.manage."
            : error.data?.host
              ? `Rejected host: ${error.data.host}`
              : null}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {unmanaged ? (
        <Alert tone="info" title="Not managed here yet">
          The service is still using <code>NFC_FACE_VERIFY_URL</code> from its
          environment — currently{" "}
          <code>{effective?.url ?? "(nothing configured)"}</code>, which means
          verification is <strong>{effective?.enabled ? "on" : "off"}</strong>.
          Saving on this screen takes over, and the environment is ignored from
          then on.
        </Alert>
      ) : null}

      <Card title="Setting">
        <div className="space-y-5 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>
              <span className="font-medium">
                Compare the card photo with the selfie before saving
              </span>
              <span className="block text-sm text-ink-500">
                Turning this off lets card registrations through unchecked — the
                same result as a face-service outage, but on purpose. Every save
                made while it is off says so in its log.
              </span>
            </span>
          </label>

          <Field
            label="Face-match service URL"
            hint="https:// anywhere, or http:// to a private address (10.x, 172.16–31.x, 192.168.x, 127.x, localhost)."
            error={error?.code === "invalid_url" ? error.message : undefined}
          >
            {(id) => (
              <input
                id={id}
                // `field-input` is the project's input style (index.css) and is
                // already w-full; `font-mono` matches how every other machine
                // value here is shown — a URL is easier to check character by
                // character in a fixed pitch.
                className="field-input font-mono"
                value={url}
                placeholder="http://10.224.224.101:8089/verify"
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>

          {enabled && !url.trim() ? (
            <Alert tone="warning">
              Verification cannot be turned on without a URL — the service will
              refuse this save with a 422.
            </Alert>
          ) : null}

          {!enabled && loaded?.nfc_face_verify === "ON" ? (
            <Alert tone="warning" title="This turns the check off">
              Card registrations will be written without comparing the two
              photographs until it is turned back on.
            </Alert>
          ) : null}

          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {loaded?.updated_at ? (
              <span className="text-xs text-ink-500">
                Last changed {new Date(loaded.updated_at).toLocaleString()}
                {loaded.updated_by ? ` by ${loaded.updated_by}` : ""}
              </span>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
