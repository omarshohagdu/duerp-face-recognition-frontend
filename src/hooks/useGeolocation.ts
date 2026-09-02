import { useEffect, useState } from "react";

export interface Coords {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type GeoStatus = "idle" | "locating" | "ready" | "denied" | "error";

interface Options {
  /** Students are recorded without a location check, so don't ask them (§2.4). */
  enabled?: boolean;
}

/**
 * Watches for a real GPS fix.
 *
 * Two things drive the shape of this hook:
 *
 *  - `getCurrentPosition` is one-shot and often returns a stale, low-accuracy
 *    fix first, so this uses `watchPosition` and keeps refining (§8.4).
 *  - **0,0 is rejected by the server as "no fix", not as a location** (§2.4).
 *    A phone that hasn't acquired GPS commonly reports 0,0 — which is in the
 *    Gulf of Guinea. So 0,0 is skipped here and `coords` stays null, which is
 *    what keeps the capture button disabled rather than submitting a
 *    placeholder that the geo-fence will reject.
 */
export function useGeolocation({ enabled = true }: Options = {}) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("error");
      setError("This device can't report its location.");
      return;
    }

    setStatus("locating");
    setError(null);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (latitude === 0 && longitude === 0) return; // no fix yet
        setCoords({ latitude, longitude, accuracy });
        setStatus("ready");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
          setError("Location access was blocked.");
        } else if (err.code === err.TIMEOUT) {
          setStatus("error");
          setError("We couldn't get a location fix. Try moving near a window.");
        } else {
          setStatus("error");
          setError("Your location isn't available right now.");
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { coords, status, error };
}
