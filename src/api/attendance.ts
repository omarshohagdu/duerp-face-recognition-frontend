import axios from "axios";

/**
 * A dedicated axios instance for the attendance service.
 *
 * UI_FLOW §8.1 lists four ways a shared duerp-api client breaks these calls.
 * All four are avoided here, and each one is a trap worth not re-introducing:
 *
 *  1. baseURL points at :8083, not duerp-api's :8080.
 *  2. NO default Content-Type. axios infers it per request — multipart *with a
 *     boundary* for FormData, JSON for a plain object. That is exactly what
 *     enroll/verify and mapping-save respectively need. A hardcoded
 *     "application/json" here means no boundary and a body that never parses.
 *     Do not "helpfully" add one back.
 *  3. NO global 401 -> logout interceptor. This API returns 401 for
 *     `token mismatch`, i.e. "that isn't your face" — a recoverable, retryable
 *     outcome, not session expiry. Logging the user out there turns a retry
 *     into a forced re-login that looks like a random logout bug in the field.
 *     Each screen decides what a 401 means; see `classifyError`.
 *  4. X-App-Id / X-App-Password ride on every call. They are the only headers
 *     this client adds; the per-request `X-Admin-Key` the admin screens used to
 *     send has been removed along with the server check behind it.
 */
const attendanceApi = axios.create({
  baseURL: import.meta.env.VITE_ATTENDANCE_END_POINT,
  headers: {
    "X-App-Id": import.meta.env.VITE_EXT_APP_ID,
    "X-App-Password": import.meta.env.VITE_EXT_APP_PASSWORD,
  },
  // The service allows 30s for the AI platform round-trip. A client timeout
  // under that shows a failure for a call that actually succeeded, and on
  // verify that means a recorded attendance the user is told did not happen
  // (UI_FLOW §10).
  timeout: 45_000,
  // Read the body on every status. `success` lives in the body of 4xx/5xx
  // responses too, and §1 says the body is what decides.
  validateStatus: () => true,
});

export const TOKEN_STORAGE_KEY = "duerp_attendance_token";

attendanceApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

export default attendanceApi;
