/**
 * Image capture and re-encoding.
 *
 * THE HEIC TRAP (UI_FLOW §2.3), the single most common integration bug on this
 * API: Android and iOS both capture HEIC by default. The server accepts HEIC
 * but cannot decode it to shrink it, so an oversized HEIC is forwarded to the
 * AI platform as-is and fails *there* — surfacing as a confusing downstream
 * error rather than a clean "too large".
 *
 * A canvas re-encode sidesteps it entirely: `toBlob(..., "image/jpeg")` always
 * emits JPEG whatever went in. So every image on its way to the API — camera
 * frame or picked file alike — goes through `canvasToJpeg` below. Nothing
 * uploads a file's original bytes.
 */

/** Longest edge, in px. ~1600 keeps enough detail for recognition (§2.3). */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export const ACCEPTED_INPUT_TYPES = "image/jpeg,image/png,image/webp,image/bmp";

function scaledSize(width: number, height: number) {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { width, height };
  const scale = MAX_EDGE / longest;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode the image")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/**
 * Draw a video frame to a canvas and encode it as JPEG.
 * At 1280x720 / q0.85 a frame is ~150-250 KB, comfortably inside the 5 MB
 * ceiling (§8.3).
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  mirrored: boolean,
): Promise<Blob> {
  const { width, height } = scaledSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read from the camera");

  if (mirrored) {
    // The preview is mirrored so it behaves like a mirror for the user, but
    // the *upload* must not be — flip back so the face reaches the platform
    // the way round it actually is.
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  return toJpegBlob(canvas);
}

/**
 * Re-encode a picked file as JPEG. Used for the "upload a photo" path so it
 * gets the same HEIC-proofing and downscaling as a camera capture (§8.3).
 *
 * Browsers cannot decode HEIC, so a HEIC pick fails here rather than uploading
 * bytes the server cannot shrink — a clear local error instead of a confusing
 * downstream one.
 */
export async function fileToJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(
          new Error(
            "This photo format isn't supported here. Take a photo with the camera instead.",
          ),
        );
      el.src = url;
    });

    const { width, height } = scaledSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the image");
    ctx.drawImage(img, 0, 0, width, height);
    return await toJpegBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Capture {
  id: string;
  blob: Blob;
  /** Object URL for the thumbnail. Revoke it when the capture is discarded. */
  url: string;
}

export function toCapture(blob: Blob): Capture {
  return {
    id: crypto.randomUUID(),
    blob,
    url: URL.createObjectURL(blob),
  };
}

export function releaseCapture(capture: Capture) {
  URL.revokeObjectURL(capture.url);
}

/** Swap the extension for .jpg when a file has been re-encoded (a.png -> a.jpg). */
export function jpegName(name: string): string {
  return `${name.replace(/\.[^./\\]+$/, "")}.jpg`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
