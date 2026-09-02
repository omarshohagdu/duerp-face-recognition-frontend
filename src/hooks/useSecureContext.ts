/**
 * getUserMedia and navigator.geolocation both require a secure context —
 * HTTPS *or* localhost. Chrome and Safari silently refuse on a plain-HTTP LAN
 * address (UI_FLOW §8.2): the camera and GPS screens cannot work there at all.
 *
 * That is browser policy, not a bug to debug, so the screens say so up front
 * rather than letting someone chase a permission prompt that will never appear.
 */
export function useSecureContext() {
  const secure = window.isSecureContext;
  const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia);
  const hasGeolocation = Boolean(navigator.geolocation);

  return {
    secure,
    hasCamera: secure && hasCamera,
    hasGeolocation: secure && hasGeolocation,
    origin: window.location.origin,
  };
}
