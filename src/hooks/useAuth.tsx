import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  loadSession,
  login as apiLogin,
  type Session,
} from "../api/auth";
import { clearAdminKey } from "../lib/adminKey";

interface AuthValue {
  session: Session | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const signIn = useCallback(async (username: string, password: string) => {
    setSession(await apiLogin(username, password));
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    // The admin key outlives the session otherwise: it is module state, not
    // React state, so signing out would leave it primed for whoever signs in
    // next on the same tab.
    clearAdminKey();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, signIn, signOut }),
    [session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
