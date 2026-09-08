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
 * Decode a blob into an <img>. Rejects with copy the user can act on: the only
 * realistic failure is a format the browser cannot decode, i.e. HEIC.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
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
    const img = await loadImage(url);
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

/**
 * A crop, as fractions of the image (0-1) rather than pixels.
 *
 * Fractions and not pixels because the selection is dragged on a DISPLAYED
 * image whose size depends on the viewport, while the crop must be applied to
 * the natural-size original. Storing fractions means a resize mid-drag, or a
 * different device, cannot silently move the box.
 */
export interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The capture preview in `CameraCapture`: a 4:3 box showing the camera with
// `object-cover`, and a face guide centred inside it at these proportions.
// Exported so the guide and the crop default cannot drift apart — change the
// overlay and the default box follows.
export const PREVIEW_ASPECT = 4 / 3;
export const GUIDE_WIDTH = 0.55;
export const GUIDE_HEIGHT = 0.75;

/** Smallest crop the UI allows, as a fraction of each edge. */
export const MIN_SELECTION = 0.15;

/**
 * Where the face guide sat, expressed against the FULL captured frame.
 *
 * These differ: the camera is 16:9 but the preview box is 4:3 with
 * `object-cover`, so the user only ever saw a centre slice of the frame. A
 * default box of a flat 55% would therefore sit wider than the oval they framed
 * themselves in. Undoing the cover-crop first puts the default exactly where
 * they were told to put their face, so most captures need no dragging at all.
 */
export function guideSelection(imageAspect: number): Selection {
  const wider = imageAspect > PREVIEW_ASPECT;
  const visibleWidth = wider ? PREVIEW_ASPECT / imageAspect : 1;
  const visibleHeight = wider ? 1 : imageAspect / PREVIEW_ASPECT;

  const width = GUIDE_WIDTH * visibleWidth;
  const height = GUIDE_HEIGHT * visibleHeight;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/**
 * Cut `selection` out of `source` and re-encode it as JPEG.
 *
 * Runs through the same downscale-and-encode path as every other image here, so
 * a crop is still HEIC-proofed and still bounded by MAX_EDGE — a crop of a
 * large photo must not become the one upload that skips those rules (§2.3).
 */
export async function cropToJpeg(
  source: Blob,
  selection: Selection,
): Promise<Blob> {
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);

    // Fractions -> natural pixels, clamped so a box dragged flush to an edge
    // cannot ask for a pixel outside the image (drawImage would letterbox it
    // with transparency, which JPEG then renders black).
    const sx = Math.max(0, Math.round(selection.x * img.naturalWidth));
    const sy = Math.max(0, Math.round(selection.y * img.naturalHeight));
    const sw = Math.max(
      1,
      Math.min(
        img.naturalWidth - sx,
        Math.round(selection.width * img.naturalWidth),
      ),
    );
    const sh = Math.max(
      1,
      Math.min(
        img.naturalHeight - sy,
        Math.round(selection.height * img.naturalHeight),
      ),
    );

    const { width, height } = scaledSize(sw, sh);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the image");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
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
