import type { AxiosResponse } from "axios";

/**
 * What a failed call means, and what the screen may offer the user about it.
 *
 * The distinction that matters is `retryable`: UI_FLOW draws a hard line
 * between "try again" failures (the AI platform is down, the face didn't
 * match, you're too far away) and dead ends the person in front of the camera
 * cannot act on (IP not allow-listed, no office assigned, admin key missing).
 * Offering "Try again" on the second kind sends someone into a loop.
 */
export type FailureKind =
  | "network" // transport failed; nothing reached the server
  | "not-recognized" // 200, matched:false — no enrolled person matched
  | "wrong-person" // 200, matched:false — 1:1 guard rejected
  | "out-of-area" // 403 with a building + distance to show
  | "not-your-face" // 401 token mismatch — NOT session expiry
  | "session" // 401 token expired/missing — re-login
  | "setup" // device/app/network config: route to IT
  | "support" // data problem: route to HR/support
  | "too-large" // 413
  | "client-bug" // 400s that a correct client cannot produce
  | "unavailable" // 502/500 from the AI platform — retryable
  | "unknown";

export interface Failure {
  kind: FailureKind;
  /** User-facing copy. Backend `message` values are diagnostic — never shown raw (§9). */
  title: string;
  detail?: string;
  retryable: boolean;
  /** The raw backend message, kept for client-side logs and support tickets (§9). */
  raw?: string;
  status?: number;
}

const has = (haystack: string | undefined, needle: string) =>
  (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

/** Extract the backend `message` wherever the shape puts it. */
export function messageOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "string") return b.error;
  return undefined;
}

/** A thrown axios error with no `response` means the request never landed. */
export function networkFailure(): Failure {
  return {
    kind: "network",
    title: "No connection",
    detail:
      "We couldn't reach the attendance service. Check your connection and try again.",
    retryable: true,
  };
}

/**
 * Failures shared by every endpoint: the two ExtAuthMiddleware rejections and
 * ordinary session expiry. Returns undefined when the response is not one of
 * them, so each screen can then apply its own table.
 */
function classifyCommon(status: number, raw?: string): Failure | undefined {
  // Both are a device/deployment problem. There is nothing the person in front
  // of the camera can do about either, so neither is a user error (§2.1).
  if (has(raw, "Invalid App ID or Password")) {
    return {
      kind: "setup",
      status,
      raw,
      title: "This device isn't set up",
      detail: "Something's wrong with this device's setup. Contact IT.",
      retryable: false,
    };
  }
  if (has(raw, "IP address not allowed")) {
    return {
      kind: "setup",
      status,
      raw,
      title: "This device isn't allowed yet",
      detail:
        "This network hasn't been approved for attendance. Contact IT to add it.",
      retryable: false,
    };
  }

  if (status === 401) {
    // `token mismatch` is NOT session expiry — it means the face recognized
    // was someone else's. Treating it as expiry logs the user out for a
    // recoverable failure (§8.1 hazard 3), so it is handled per-screen.
    if (has(raw, "token mismatch")) return undefined;
    return {
      kind: "session",
      status,
      raw,
      title: "Your session has expired",
      detail: "Please sign in again.",
      retryable: false,
    };
  }

  if (status === 413) {
    return {
      kind: "too-large",
      status,
      raw,
      title: "Photo is too large",
      detail: "Take the photo again — it will be resized before upload.",
      retryable: true,
    };
  }

  return undefined;
}

/** Enroll-specific mapping (§3.4). */
export function classifyEnroll(res: AxiosResponse): Failure {
  const raw = messageOf(res.data);
  const common = classifyCommon(res.status, raw);
  if (common) return common;

  if (res.status === 401 && has(raw, "token mismatch")) {
    return {
      kind: "not-your-face",
      status: res.status,
      raw,
      title: "You can only enroll your own face",
      detail: "This account can only register the face of the person signed in.",
      retryable: false,
    };
  }

  if (res.status === 400) {
    if (has(raw, "`id` is required")) {
      return {
        kind: "client-bug",
        status: res.status,
        raw,
        title: "We couldn't identify your account",
        detail: "Please sign out and sign in again.",
        retryable: false,
      };
    }
    if (has(raw, "id_type could not be determined")) {
      return {
        kind: "client-bug",
        status: res.status,
        raw,
        title: "We couldn't tell if you're staff or a student",
        detail: "This is an app problem — please report it to IT.",
        retryable: false,
      };
    }
  }

  // The one to design for properly: the expected outcome whenever the AI
  // platform is down, and fully recoverable. Nothing was saved, so there is no
  // partial state to clean up before retrying (§3.4).
  if (res.status === 502 || has(raw, "nothing was saved")) {
    return {
      kind: "unavailable",
      status: res.status,
      raw,
      title: "We couldn't set up your face right now",
      detail: "Nothing was saved — please try again in a moment.",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    status: res.status,
    raw,
    title: "Something went wrong",
    detail: "We couldn't complete your enrollment. Please try again.",
    retryable: true,
  };
}

/**
 * Verify-specific mapping (§4.3, §4.5).
 *
 * Note the three 403 variants with no `location.building_name`: those are a
 * data problem (no employee row, no office, no mapping), not a user problem.
 * "Try again" cannot fix any of them, so they route to support instead.
 */
export function classifyVerify(res: AxiosResponse): Failure {
  const raw = messageOf(res.data);
  const common = classifyCommon(res.status, raw);
  if (common) return common;

  if (res.status === 401 && has(raw, "token mismatch")) {
    return {
      kind: "not-your-face",
      status: res.status,
      raw,
      title: "That isn't your face",
      detail: "You can only mark attendance for yourself.",
      retryable: false,
    };
  }

  if (has(raw, "No matching enrolled person found")) {
    return {
      kind: "not-recognized",
      status: res.status,
      raw,
      title: "We couldn't recognize your face",
      detail: "Try again in better light, facing the camera directly.",
      retryable: true,
    };
  }

  if (has(raw, "Face did not match the requested person")) {
    return {
      kind: "wrong-person",
      status: res.status,
      raw,
      title: "That doesn't look like you",
      detail: "Please try again, facing the camera directly.",
      retryable: true,
    };
  }

  if (res.status === 403) {
    if (has(raw, "Employee not found")) {
      return {
        kind: "support",
        status: res.status,
        raw,
        title: "We couldn't find your staff record",
        detail: "Your employee record is missing. Contact HR.",
        retryable: false,
      };
    }
    if (has(raw, "no office assigned")) {
      return {
        kind: "support",
        status: res.status,
        raw,
        title: "Your office isn't set up for attendance yet",
        detail: "Contact HR to have your office assigned.",
        retryable: false,
      };
    }
    if (has(raw, "No building mapping found")) {
      return {
        kind: "support",
        status: res.status,
        raw,
        title: "Your office has no check-in location yet",
        detail:
          "No building has been mapped to your office. Contact your administrator.",
        retryable: false,
      };
    }
    // Everything else on a 403 is the geo-fence: the caller renders the
    // distance/building/radius from `location`, which is far more actionable
    // than "location failed" (§4.3).
    return {
      kind: "out-of-area",
      status: res.status,
      raw,
      title: "You're not at a mapped building",
      retryable: true,
    };
  }

  if (res.status === 400 && has(raw, "location is required")) {
    return {
      kind: "client-bug",
      status: res.status,
      raw,
      title: "We don't have your location yet",
      detail: "Wait for your location to be found, then try again.",
      retryable: true,
    };
  }

  if (res.status === 400) {
    return {
      kind: "client-bug",
      status: res.status,
      raw,
      title: "We couldn't send your photo",
      detail: "This is an app problem — please report it to IT.",
      retryable: true,
    };
  }

  if (has(raw, "Could not determine id_type") || has(raw, "id_type")) {
    return {
      kind: "support",
      status: res.status,
      raw,
      title: "Your record needs attention",
      detail: "We couldn't tell whether you're staff or a student. Contact HR.",
      retryable: false,
    };
  }

  if (has(raw, "Face recognition failed") || res.status >= 500) {
    return {
      kind: "unavailable",
      status: res.status,
      raw,
      title: "The face service isn't responding",
      detail: "This is temporary — please try again in a moment.",
      retryable: true,
    };
  }

  if (has(raw, "Person is not enrolled")) {
    return {
      kind: "not-recognized",
      status: res.status,
      raw,
      title: "You're not enrolled yet",
      detail: "Set up your face before marking attendance.",
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    status: res.status,
    raw,
    title: "Something went wrong",
    detail: "We couldn't check your face. Please try again.",
    retryable: true,
  };
}

/** Admin screens (enrolled list, reports) — no camera, no geo-fence (§6.5). */
export function classifyAdmin(res: AxiosResponse): Failure {
  const raw = messageOf(res.data);
  const common = classifyCommon(res.status, raw);
  if (common) return common;

  if (res.status === 400) {
    return {
      kind: "client-bug",
      status: res.status,
      raw,
      title: "That request wasn't valid",
      detail: raw,
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    status: res.status,
    raw,
    title: "Couldn't load",
    detail: "Something went wrong fetching this. Please try again.",
    retryable: true,
  };
}

/**
 * Mapping-save (§7.6). Two different 403s are reachable from this screen and
 * they need different copy: the IP allow-list one is a device/network problem,
 * the admin-key one is a credentials problem — and the bearer token is fine in
 * the second case, so the user must NOT be sent to re-login.
 */
export function classifyMapping(res: AxiosResponse): Failure {
  const raw = messageOf(res.data);

  if (res.status === 503 || has(raw, "Admin operations are not configured")) {
    return {
      kind: "setup",
      status: res.status,
      raw,
      title: "Geo-fence editing isn't enabled on this server",
      detail: "WOW_ADMIN_KEY is not configured. Contact IT.",
      retryable: false,
    };
  }
  if (has(raw, "X-Admin-Key")) {
    return {
      kind: "setup",
      status: res.status,
      raw,
      title: "You don't have permission to change geo-fences",
      detail: "The admin key is missing or wrong. Check the key and try again.",
      retryable: true,
    };
  }

  const common = classifyCommon(res.status, raw);
  if (common) return common;

  if (res.status === 400) {
    return {
      kind: "client-bug",
      status: res.status,
      raw,
      title: "The mapping wasn't saved",
      detail: raw,
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    status: res.status,
    raw,
    title: "The mapping wasn't saved",
    detail: "Something went wrong. Please try again.",
    retryable: true,
  };
}

/**
 * Render the out-of-area 403 with real numbers: "You're about 410 m from Arts
 * Building — you need to be within 50 m". The user can act on that; they
 * cannot act on "location failed" (§4.3).
 */
export function outOfAreaDetail(loc?: {
  building_name?: string;
  distance_m?: number;
  radius_m?: number;
} | null): string {
  if (!loc || loc.distance_m == null || !loc.building_name) {
    return "You need to be inside one of your office's mapped buildings to check in.";
  }
  const distance =
    loc.distance_m >= 1000
      ? `${(loc.distance_m / 1000).toFixed(1)} km`
      : `${Math.round(loc.distance_m / 10) * 10} m`;
  const radius = loc.radius_m != null ? `${Math.round(loc.radius_m)} m` : null;
  return radius
    ? `You're about ${distance} from ${loc.building_name} — you need to be within ${radius}.`
    : `You're about ${distance} from ${loc.building_name}.`;
}
