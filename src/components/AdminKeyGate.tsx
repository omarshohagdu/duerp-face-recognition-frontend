import { useState, type ReactNode } from "react";
import { useAdminKey } from "../lib/adminKey";
import type { Failure } from "../lib/errors";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface Props {
  /**
   * What the key unlocks, as a sentence fragment: "read the logs", "run
   * reports". Used only in the prompt copy.
   */
  unlocks: string;
  /**
   * The last failure from the screen's own calls. A key failure re-opens this
   * prompt; anything else is the screen's to render.
   */
  failure?: Failure | null;
  /** Called when a new key is committed, so the screen can clear stale errors. */
  onUnlock?: () => void;
  children: ReactNode;
}

/**
 * Stands in front of any screen whose endpoints require `X-Admin-Key`.
 *
 * WHY IT GATES ON `kind === "admin-key"` AND NOT `"setup"`: the ExtAuthMiddleware
 * failures (bad app credentials, IP not allow-listed) are also `setup`, and
 * re-prompting for the admin key on those would send an admin round a loop
 * typing a key that was never the problem.
 *
 * The key lives in `lib/adminKey.ts` — memory only, shared across the admin
 * screens, cleared on sign-out. Unlock one screen and the others are unlocked
 * too; reload the tab and every one of them asks again.
 */
export function AdminKeyGate({ unlocks, failure, onUnlock, children }: Props) {
  const [adminKey, setAdminKey] = useAdminKey();
  const [draft, setDraft] = useState(adminKey);

  const keyProblem = failure?.kind === "admin-key";
  if (adminKey && !keyProblem) return <>{children}</>;

  return (
    <Card
      title="Admin key required"
      description={`The server asks for the shared admin key to ${unlocks}. It is kept in memory for this tab only — never saved.`}
    >
      {failure && keyProblem && (
        <Alert tone="danger" className="mb-4" title={failure.title}>
          {failure.detail}
        </Alert>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAdminKey(draft.trim());
          onUnlock?.();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="min-w-64 flex-1">
          <label className="field-label" htmlFor="admin-key">
            Admin key
          </label>
          <input
            id="admin-key"
            type="password"
            className="field-input font-mono"
            value={draft}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!draft.trim()}>
          Unlock
        </Button>
      </form>
    </Card>
  );
}
