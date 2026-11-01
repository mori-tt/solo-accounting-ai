"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { clearSession } from "@/lib/api-client";
import {
  listMyBusinesses,
  type MyBusiness,
} from "@/lib/actions/businesses";

const BUSINESS_STORAGE_KEY = "sai.currentBusinessId";

export type AuthStatus = "loading" | "signed_out" | "signed_in";

interface AppContextValue {
  user: User | null;
  status: AuthStatus;
  /** セッションCookieの同期が済んだか */
  sessionReady: boolean;
  businesses: MyBusiness[];
  businessesLoading: boolean;
  businessId: string | null;
  business: MyBusiness | undefined;
  selectBusiness: (id: string) => void;
  reloadBusinesses: () => void;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [sessionReady, setSessionReady] = useState(false);
  // undefined = 未取得(ローディング)。ログイン後の初回取得完了まで undefined。
  const [businesses, setBusinesses] = useState<MyBusiness[] | undefined>();
  const [businessNonce, setBusinessNonce] = useState(0);
  const [businessId, setBusinessId] = useState<string | null>(null);

  // Firebase Auth の状態を監視し、セッションCookieと同期する
  useEffect(() => {
    const auth = getFirebaseAuth();
    return onIdTokenChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setStatus("signed_out");
        setSessionReady(false);
        setBusinesses(undefined);
        setBusinessId(null);
        void clearSession();
        return;
      }
      void nextUser
        .getIdToken()
        .then((idToken) =>
          fetch("/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idToken }),
          }),
        )
        .catch(() => undefined)
        .finally(() => {
          setSessionReady(true);
          setStatus("signed_in");
        });
    });
  }, []);

  // ログイン中は所属事業を読み込み、現在の事業を決める
  useEffect(() => {
    if (status !== "signed_in" || !sessionReady) return;
    let cancelled = false;
    listMyBusinesses().then((res) => {
      if (cancelled) return;
      const list = res.ok ? res.data : [];
      setBusinesses(list);
      setBusinessId((current) => {
        const stored =
          current ??
          (typeof window !== "undefined"
            ? window.localStorage.getItem(BUSINESS_STORAGE_KEY)
            : null);
        if (stored && list.some((b) => b.id === stored)) return stored;
        return list[0]?.id ?? null;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [status, sessionReady, businessNonce]);

  const selectBusiness = useCallback((id: string) => {
    setBusinessId(id);
    try {
      window.localStorage.setItem(BUSINESS_STORAGE_KEY, id);
    } catch {
      // private mode 等では保存しないだけ
    }
  }, []);

  const reloadBusinesses = useCallback(() => {
    setBusinessNonce((n) => n + 1);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
    await clearSession();
  }, []);

  const value = useMemo<AppContextValue>(() => {
    const list = businesses ?? [];
    return {
      user,
      status,
      sessionReady,
      businesses: list,
      businessesLoading:
        status === "signed_in" && sessionReady && businesses === undefined,
      businessId,
      business: list.find((b) => b.id === businessId),
      selectBusiness,
      reloadBusinesses,
      signOut,
    };
  }, [
    user,
    status,
    sessionReady,
    businesses,
    businessId,
    selectBusiness,
    reloadBusinesses,
    signOut,
  ]);

  return <AppContext value={value}>{children}</AppContext>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
