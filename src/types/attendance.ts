/**
 * Response types for /ext-api/wow-attendance/*.
 *
 * The central rule (UI_FLOW §1): **a 200 does not mean it worked.** Verify
 * returns `200 OK` with `success: false` for its two most common real-world
 * outcomes. So the envelope is a discriminated union on `success` — narrowing
 * on it is what makes the payload reachable, which turns §1 from a discipline
 * into a compiler check.
 */
export type Envelope<T> =
  | ({ success: true; message?: string } & T)
  | ({ success: false; message: string } & Partial<T>);

export type IdType = "Student" | "Employee";

/** Sent as a JSON *string* in a form field, never as an object (§2.4). */
export interface DeviceInfo {
  os?: string;
  device?: string;
  app_version?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

// --- Enroll (§3) -----------------------------------------------------------

export interface EnrollData {
  data: {
    id: string;
    id_type: IdType;
    enrolled_image_count: number;
    enrollment_id: string;
    version: number;
    is_reenrollment: boolean;
    previous_enrollment_id: string | null;
  };
  ai_enrolled: boolean;
}

export type EnrollResponse = Envelope<EnrollData>;

// --- Check enrolled (§5.4) -------------------------------------------------

export interface CheckEnrolledData {
  enrolled: boolean;
  data: {
    id: string;
    id_type?: IdType;
    enrollment_id?: string;
    enrolled_at?: string;
    image_count?: number;
    is_active?: boolean;
    version?: number;
    is_reenrollment?: boolean;
    previous_enrollment_id?: string | null;
  };
}

/**
 * Both outcomes are 200 and `success` mirrors `enrolled`, so "not enrolled"
 * arrives as `success: false`. That is a legitimate answer, not a failure —
 * the check screen must not render it as an error.
 */
export type CheckEnrolledResponse = Envelope<CheckEnrolledData> & {
  enrolled?: boolean;
};

// --- Verify (§4) -----------------------------------------------------------

/**
 * The geo-fence result. Note it sits at the TOP LEVEL of the response, a
 * sibling of `data`, not inside it (§4.3) — and it comes back on the 403 too,
 * which is what makes a useful out-of-area screen possible.
 */
export interface VerifyLocation {
  emp_id?: string;
  emp_name?: string;
  body_code?: string;
  building_id?: number;
  building_name?: string;
  distance_m?: number;
  radius_m?: number;
}

export interface VerifyData {
  matched: boolean;
  data: {
    id: string;
    id_type: IdType;
    attendance_id: string;
    matched_at: string;
    confidence: number;
  };
  location?: VerifyLocation;
}

export type VerifyResponse = Envelope<VerifyData> & {
  matched?: boolean;
  verified?: boolean;
  recognized_identifier?: string;
  live_image?: string;
  location?: VerifyLocation | null;
};

// --- Enrolled list (§5) ----------------------------------------------------

export interface EnrolledRow {
  id: string;
  name: string | null;
  enrollment_id: string;
  enrolled_at: string;
  image_count: number;
  is_active: boolean;
}

export type EnrolledListResponse = Envelope<{
  data: {
    id_type: IdType;
    total: number;
    page: number;
    limit: number;
    list: EnrolledRow[];
  };
}>;

// --- Reports (§6) ----------------------------------------------------------

/**
 * `matched` is always true and `confidence` always 1.0 — both are hardcoded at
 * the call site, and only successful check-ins are ever written (§6.1). They
 * are typed here because they are on the wire, but neither belongs on screen:
 * a "100% match" badge on every row is a number the user will believe.
 */
export interface AttendanceRecord {
  record_id: string;
  id?: string;
  id_type: IdType;
  name?: string | null;
  matched: boolean;
  confidence: number;
  /** A server FILESYSTEM path, not a URL. Run it through `liveImageUrl` (§6.4). */
  live_image: string | null;
  device_info: Record<string, unknown> | null;
  enrollment_id: string;
  created_at: string;
}

export type ReportByDateResponse = Envelope<{
  data: {
    from_date: string;
    to_date: string;
    id_type: IdType | null;
    total: number;
    page: number;
    limit: number;
    list: AttendanceRecord[];
  };
}>;

export type ReportByPersonResponse = Envelope<{
  data: {
    id: string;
    name: string | null;
    from_date: string;
    to_date: string;
    total: number;
    page: number;
    limit: number;
    list: AttendanceRecord[];
  };
}>;

// --- Building mapping (§7) -------------------------------------------------

export interface MappingSaveRequest {
  body_code: string;
  building_id?: number;
  building_name?: string;
  lat: number;
  long: number;
  radius?: number;
  is_active?: boolean;
}

export type MappingSaveResponse = Envelope<{
  data: {
    mapping_id: number;
    body_code: string;
    building_id: number;
    building_name: string;
    building_created: boolean;
    lat: number;
    long: number;
    radius: number;
    is_active: boolean;
    employee_count: number;
  };
}> & { warnings?: string[] };
