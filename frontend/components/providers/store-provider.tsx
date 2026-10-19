"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "@/lib/store/store";
import { api } from "@/lib/store/api";

export function StoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);

  if (!storeRef.current) {
    // Deterministic initial state; browser-only values (the persisted JWT
    // session) are applied by <AuthProvider> after mount so the server render and
    // the first client render agree.
    storeRef.current = makeStore();
  }

  useEffect(() => {
    const store = storeRef.current;
    return () => {
      // Fast Refresh safety: drop accumulated RTK Query subscriptions/state.
      store?.dispatch(api.util.resetApiState());
    };
  }, []);

  return <Provider store={storeRef.current}>{children}</Provider>;
}
