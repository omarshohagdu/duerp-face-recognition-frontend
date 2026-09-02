/**
 * `live_image` is the path the file had ON THE SERVER at the time of capture,
 * and it takes at least four shapes across environments (UI_FLOW §6.4):
 *
 *   /app/uploads/wow_attendance/live/uuid.jpg                    <- container
 *   /var/www/.../duerp-api/uploads/wow_attendance/live/uuid.jpg  <- before the move
 *   /var/www/.../duerp-attendance/uploads/wow_attendance/live/uuid.jpg
 *   ./uploads/wow_attendance/live/uuid.jpg                       <- relative default
 *
 * It is NOT a URL. Take the substring from `/uploads/` onward and prefix the
 * attendance service's public origin.
 */

const ORIGIN = (
  import.meta.env.VITE_ATTENDANCE_UPLOADS_ORIGIN ||
  import.meta.env.VITE_ATTENDANCE_END_POINT ||
  ""
).replace(/\/+$/, "");

export function liveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const at = path.indexOf("/uploads/");
  if (at === -1) return null;

  // Percent-escape each segment. Uploaded names routinely contain spaces
  // ("WhatsApp Image 2026-07-09 at 12.54.26 PM.jpeg"), which break a raw
  // <img src> outright.
  const relative = path
    .slice(at)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${ORIGIN}${relative}`;
}

/**
 * Records written before the 2026-08-19 uploads move point at a folder that no
 * longer holds the file, so some thumbnails WILL 404. That is not a failure of
 * the attendance record — render a placeholder, never a broken-image icon, and
 * never let it read as "this check-in is invalid" (§6.4).
 */
export const MISSING_IMAGE_HINT = "Photo no longer on file";
