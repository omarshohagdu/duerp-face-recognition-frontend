import { useCallback, useEffect, useRef, useState } from "react";
import { captureVideoFrame } from "../lib/image";

export type CameraStatus = "idle" | "starting" | "ready" | "denied" | "error";

interface Options {
  /** Skip acquiring the stream (e.g. while a result screen is showing). */
  enabled?: boolean;
}

/**
 * Owns the camera stream lifecycle.
 *
 * The cleanup is not optional: without stopping every track the camera light
 * stays on after navigating away (UI_FLOW §8.3), which on a shared or personal
 * device reads as the app still watching. `cancelled` covers the case where the
 * component unmounts while getUserMedia is still resolving — otherwise the
 * stream arrives after teardown and is never stopped at all.
 */
export function useCamera({ enabled = true }: Options = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("starting");
    setError(null);

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: 1280, height: 720 },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setError("Camera access was blocked.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("error");
          setError("No camera was found on this device.");
        } else {
          setStatus("error");
          setError("The camera couldn't be started.");
        }
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== "ready") return null;
    return captureVideoFrame(video, true);
  }, [status]);

  return { videoRef, status, error, capture };
}
