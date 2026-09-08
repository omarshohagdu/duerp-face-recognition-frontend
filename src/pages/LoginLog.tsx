import { LogViewer } from "../components/LogViewer";

/**
 * `uploads/login` — one file per sign-in attempt, successful or not.
 *
 * `route:` is `login` on every file here, so the Call column is dropped. The id
 * is the one column worth explaining: a successful sign-in is filed under the
 * person id the token was issued for, but an attempt that never got that far
 * (wrong password, DU unreachable) is filed under the submitted username, which
 * is exactly what makes failed attempts findable.
 */
export function LoginLog() {
  return (
    <LogViewer
      source="login"
      title="Login log"
      description="Every sign-in attempt, as the server recorded it."
      idLabel="ID or username"
      idPlaceholder="202011100701"
      showRoute={false}
      emptyTitle="No sign-ins logged yet"
      emptyDetail="A file appears here for every attempt, including failed ones."
    />
  );
}
