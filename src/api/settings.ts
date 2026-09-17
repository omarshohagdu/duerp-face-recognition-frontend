import attendanceApi from "./attendance";

/**
 * Admin settings — the NFC face-verification switch.
 *
 * `GET|PUT /admin-api/settings/nfc-face-verify`. Both need
 * `admin.settings.manage`, and both **enforce it today** rather than in audit
 * mode, so a 403 here is the real answer.
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

export async function getFaceVerify(): Promise<Result<FaceVerifySettings>> {
  const res = await attendanceApi.get("/admin-api/settings/nfc-face-verify");
  return res.data as Result<FaceVerifySettings>;
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
  const res = await attendanceApi.put("/admin-api/settings/nfc-face-verify", body);
  return res.data as Result<{ nfc_face_verify: "ON" | "OFF"; nfc_face_verify_url: string }>;
}
