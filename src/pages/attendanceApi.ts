import type { AxiosResponse } from "axios";
import attendanceApi from "../api/attendance";
import type {
  CheckEnrolledResponse,
  DeviceInfo,
  EnrolledListResponse,
  EnrollResponse,
  IdType,
  LogFileResponse,
  LogListResponse,
  MappingSaveRequest,
  MappingSaveResponse,
  ReportByDateResponse,
  ReportByPersonResponse,
  VerifyResponse,
} from "../types/attendance";

const BASE = "/ext-api/wow-attendance";

/**
 * `device_info` goes on the FormData as a JSON STRING, not an object (§2.4).
 * Appending the object gives "[object Object]" and the server reads no
 * coordinates at all — which, for an employee, is a hard 400.
 */
export function deviceInfoField(coords?: {
  latitude: number;
  longitude: number;
  accuracy: number;
} | null): string {
  return JSON.stringify(deviceInfoObject(coords));
}

export function deviceInfoObject(coords?: {
  latitude: number;
  longitude: number;
  accuracy: number;
} | null): DeviceInfo {
  const info: DeviceInfo = {
    device: navigator.platform || "browser",
    os: navigator.userAgent,
    app_version: __APP_VERSION__,
  };
  if (coords) {
    info.latitude = coords.latitude;
    info.longitude = coords.longitude;
    info.accuracy = coords.accuracy;
  }
  return info;
}

/** Pretty-printed, for the editable `device_info` field in manual mode. */
export function deviceInfoTemplate(coords?: {
  latitude: number;
  longitude: number;
  accuracy: number;
} | null): string {
  return JSON.stringify(deviceInfoObject(coords), null, 2);
}

// --- Enroll (§3.3) ---------------------------------------------------------

export function enroll(params: {
  personId: string;
  images: Blob[];
  name?: string;
  /**
   * The `X-Id-Type` header, omitted entirely when undefined.
   *
   * DU has no student lookup, so a student cannot be positively identified and
   * falls back to this header. Without it a student is recorded under
   * WOW_IDTYPE_FALLBACK — i.e. silently as an Employee (§2.2). Never send an
   * `id_type` FIELD: enroll resolves it from DU and ignores any in the request.
   */
  idTypeHeader?: IdType;
  deviceInfo: string;
  /** Original filenames, so the server's step log names the real files. */
  filenames?: string[];
  onProgress?: (percent: number) => void;
}): Promise<AxiosResponse<EnrollResponse>> {
  const form = new FormData();
  // Repeat the key once per photo — the server reads `images` as a list and
  // pushes every part, so one request really does enroll all of them.
  params.images.forEach((blob, i) => {
    form.append("images", blob, params.filenames?.[i] ?? `face-${i + 1}.jpg`);
  });
  form.append("device_info", params.deviceInfo);
  if (params.name) form.append("name", params.name);

  return attendanceApi.post(
    `${BASE}/enroll?id=${encodeURIComponent(params.personId)}`,
    form,
    {
      headers: {
        ...(params.idTypeHeader ? { "X-Id-Type": params.idTypeHeader } : {}),
      },
      onUploadProgress: (e) => {
        if (params.onProgress && e.total) {
          params.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    },
  );
}

// --- Verify (§4.4) ---------------------------------------------------------

export function verify(params: {
  image: Blob;
  /**
   * Present = 1:1 guard. Preferred in a signed-in app: it converts a silent
   * mis-identification into an explicit "Face did not match the requested
   * person", which is a far better failure than marking the wrong person
   * present (§4.2).
   */
  personId?: string;
  deviceInfo: string;
  /** Kept from a manual upload so the server's step log names the real file. */
  filename?: string;
  onProgress?: (percent: number) => void;
}): Promise<AxiosResponse<VerifyResponse>> {
  const form = new FormData();
  // The file part, not the base64 text field: base64 inflates the payload by
  // ~33% against the size ceiling (§4.4).
  form.append("image", params.image, params.filename ?? "live.jpg");
  form.append("device_info", params.deviceInfo);

  const query = params.personId
    ? `?id=${encodeURIComponent(params.personId)}`
    : "";

  return attendanceApi.post(`${BASE}/verify${query}`, form, {
    onUploadProgress: (e) => {
      if (params.onProgress && e.total) {
        params.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
}

// --- Query-only endpoints (§5, §6) -----------------------------------------

/**
 * `/check`, `/enrolled` and both `/reports/*` take their parameters in the
 * query string, but they are multipart POSTs — and an EMPTY `FormData`
 * serializes to a body actix-multipart refuses outright, so every one of them
 * answered `400 Multipart error: Multipart stream is incomplete` before the
 * handler ever ran. Repeating the parameters as form fields keeps the body
 * parseable; the query string stays as the documented interface.
 *
 * It also restores pagination on `/enrolled`: `EnrolledListQuery` on the server
 * deserializes ONLY `id_type`, so `page` and `limit` in the query string are
 * dropped and the handler reads them from form fields alone — every page
 * silently came back as page 1 at limit 20.
 *
 * Every caller below sends at least one field, so the body is never empty.
 */
function paramsForm(
  fields: Record<string, string | number | undefined>,
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, String(value));
  }
  return form;
}

// --- Check enrolled (§5.4) -------------------------------------------------

export function checkEnrolled(
  personId: string,
): Promise<AxiosResponse<CheckEnrolledResponse>> {
  return attendanceApi.post(
    `${BASE}/check?person_id=${encodeURIComponent(personId)}`,
    paramsForm({ person_id: personId }),
  );
}

// --- Enrolled list (§5) ----------------------------------------------------

export function enrolledList(params: {
  idType: IdType;
  page: number;
  limit: number;
}): Promise<AxiosResponse<EnrolledListResponse>> {
  const query = new URLSearchParams({
    id_type: params.idType,
    page: String(params.page),
    limit: String(params.limit),
  });
  return attendanceApi.post(
    `${BASE}/enrolled?${query}`,
    paramsForm({
      id_type: params.idType,
      page: params.page,
      limit: params.limit,
    }),
  );
}

// --- Reports (§6) ----------------------------------------------------------

/**
 * Both reports now take the admin key.
 *
 * `by-date` requires it outright — it returns every check-in the university
 * made in the range, and there is no per-person version of that question to
 * fall back to. `by-person` requires it only when `personId` is not the
 * caller's own; the member's "My attendance" screen therefore sends none.
 */
export function reportByDate(params: {
  fromDate: string;
  toDate: string;
  /** undefined = "All". §6.2: All means OMIT the parameter, not send "". */
  idType?: IdType;
  page: number;
  limit: number;
  adminKey: string;
}): Promise<AxiosResponse<ReportByDateResponse>> {
  const query = new URLSearchParams({
    from_date: params.fromDate,
    to_date: params.toDate,
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.idType) query.set("id_type", params.idType);

  return attendanceApi.post(
    `${BASE}/reports/by-date?${query}`,
    paramsForm({
      from_date: params.fromDate,
      to_date: params.toDate,
      // Left undefined for "All" — §6.2 says omit it, never send "".
      id_type: params.idType,
      page: params.page,
      limit: params.limit,
    }),
    { headers: { "X-Admin-Key": params.adminKey } },
  );
}

export function reportByPerson(params: {
  personId: string;
  fromDate: string;
  toDate: string;
  page: number;
  limit: number;
  /** Omitted when asking for your own records — the token already proves it. */
  adminKey?: string;
}): Promise<AxiosResponse<ReportByPersonResponse>> {
  const query = new URLSearchParams({
    person_id: params.personId,
    from_date: params.fromDate,
    to_date: params.toDate,
    page: String(params.page),
    limit: String(params.limit),
  });
  return attendanceApi.post(
    `${BASE}/reports/by-person?${query}`,
    paramsForm({
      person_id: params.personId,
      from_date: params.fromDate,
      to_date: params.toDate,
      page: params.page,
      limit: params.limit,
    }),
    // Sent only when there is one. An empty header would be a wrong key rather
    // than no key, which the server rejects even for your own records.
    params.adminKey
      ? { headers: { "X-Admin-Key": params.adminKey } }
      : undefined,
  );
}

// --- Building mapping (§7.2) -----------------------------------------------

/**
 * The one JSON endpoint in the service. Every other call here is multipart —
 * passing a plain object lets axios infer application/json, which is exactly
 * what this needs and exactly why the client has no default Content-Type
 * (§8.1 hazard 2).
 *
 * `adminKey` is passed in per call rather than read from the environment: it
 * is a shared, long-lived secret and a VITE_ var would ship it in the bundle
 * for any end user to read (§7.7, §8.2).
 */
export function saveMapping(
  body: MappingSaveRequest,
  adminKey: string,
): Promise<AxiosResponse<MappingSaveResponse>> {
  return attendanceApi.post(`${BASE}/mapping-save`, body, {
    headers: { "X-Admin-Key": adminKey },
  });
}

// --- Step logs (admin, §7.7 key) -------------------------------------------

/**
 * The two log readers. Query params only — unlike the older endpoints they
 * have no clients predating the move off form fields, so there is no second
 * copy of each parameter to keep in sync.
 *
 * `adminKey` is passed per call for the same reason as `saveMapping`: it is a
 * shared secret that must not be in the bundle or on disk (`lib/adminKey.ts`).
 */
export type LogSource = "login" | "attendance";

export function logList(params: {
  source: LogSource;
  adminKey: string;
  personId?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  limit: number;
}): Promise<AxiosResponse<LogListResponse>> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  // Omitted rather than sent empty: a blank `from_date` is a 400, and a blank
  // `person_id` would filter on the empty string.
  if (params.personId?.trim()) query.set("person_id", params.personId.trim());
  if (params.fromDate) query.set("from_date", params.fromDate);
  if (params.toDate) query.set("to_date", params.toDate);

  return attendanceApi.post(`${BASE}/logs/${params.source}?${query}`, undefined, {
    headers: { "X-Admin-Key": params.adminKey },
  });
}

export function logFile(params: {
  source: LogSource;
  adminKey: string;
  file: string;
}): Promise<AxiosResponse<LogFileResponse>> {
  const query = new URLSearchParams({ file: params.file });
  return attendanceApi.post(`${BASE}/logs/${params.source}?${query}`, undefined, {
    headers: { "X-Admin-Key": params.adminKey },
  });
}
