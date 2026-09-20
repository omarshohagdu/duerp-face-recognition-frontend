import type { AxiosResponse } from "axios";
import attendanceApi from "./attendance";

/**
 * Admin settings — the NFC face-verification switch.
 *
 * `GET|PUT /ext-api/settings/nfc-face-verify`. Both need
 * `admin.settings.manage`, and both **enforce it today** rather than in audit
 * mode, so a 403 here is the real answer.
 *
 * WHY `/ext-api` AND NOT `/admin-api`, which is what the API documents: the
 * production gateway proxies `/ext-api/` as a prefix and has **no rule for
 * `/admin-api`**, so a browser calling the documented path gets the SPA's own
 * index.html back with a 200. The service answers on both; this is the one
 * that reaches it. Switch back when the gateway rule lands —
 * `docs/DEPLOYMENT.md`, "A path with no proxy rule".
 *
 * `attendanceApi` reads the body on every status, so these hand the envelope
 * back and let the screen branch on `success` — which matters here because a
 * 422 carries the one message the operator needs to act on.
 */

export interface FaceVerifySettings {
  /** What is STORED. May differ from `effective` until somebody saves. */
  nfc_face_verify: "ON" | "OFF";
  nfc_face_verify_url: string;
  updated_by: number | null;
  updated_at: string | null;
  /** What the card-save path is ACTUALLY using right now. */
  effective: {
    enabled: boolean;
    url: string | null;
    /**
     * `false` = nobody has used this screen yet, so `NFC_FACE_VERIFY_URL` in
     * the service's `.env` is still in charge and the stored rows above are
     * being ignored. Saving once takes over.
     */
    managed_here: boolean;
  };
}

export interface Ok<T> {
  success: true;
  message?: string;
  data: T;
}

export interface Err {
  success: false;
  code: string;
  message: string;
  /** `invalid_url` names the host it objected to. */
  data?: { host?: string };
}

export type Result<T> = Ok<T> | Err;

/**
 * Read a response as this API's envelope — or report what actually arrived.
 *
 * NEVER a blind cast. `validateStatus: () => true` means every status lands
 * here, and the body is not always JSON: Actix answers a rejected payload with
 * plain text (`Content type error`), an unregistered method with an empty 404,
 * and a proxy with no rule for the path with an HTML page. Cast any of those
 * and `success` reads `undefined` — falsy, so the screen shows an error box
 * with no message in it. That is how a missing `Content-Type` header stayed
 * invisible for a day.
 */
function envelope<T>(res: AxiosResponse): Result<T> {
  const { status, data } = res;

  if (data && typeof data === "object" && typeof (data as { success?: unknown }).success === "boolean") {
    return data as Result<T>;
  }

  const raw = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return {
    success: false,
    code: `http_${status}`,
    message: `HTTP ${status} — ${raw && raw !== "null" ? raw.slice(0, 300) : "(empty response body)"}`,
  };
}

export async function getFaceVerify(): Promise<Result<FaceVerifySettings>> {
  return envelope<FaceVerifySettings>(
    await attendanceApi.get("/ext-api/settings/nfc-face-verify"),
  );
}

/**
 * Omit `url` to leave the stored one alone — the "just flip the switch" case.
 * Pass `""` to clear it, which then makes ON impossible until one is set again.
 */
export async function putFaceVerify(
  enabled: "ON" | "OFF",
  url?: string,
): Promise<Result<{ nfc_face_verify: "ON" | "OFF"; nfc_face_verify_url: string }>> {
  const body: Record<string, string> = { nfc_face_verify: enabled };
  if (url !== undefined) body.nfc_face_verify_url = url;
  // A plain object, so axios sets `Content-Type: application/json` itself —
  // the header whose absence produced the 400 this helper now surfaces.
  return envelope(await attendanceApi.put("/ext-api/settings/nfc-face-verify", body));
}
