import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthUser, Role } from "@/lib/types";
import { readSession, writeSession, type StoredSession } from "@/lib/auth/session";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** HTTP method badge shown in the toast, e.g. "PATCH". */
  method?: string;
  createdAt: number;
}

export interface UiState {
  sidebarCollapsed: boolean;
  /** ⌘K palette visibility; shared so the top bar can open it. */
  paletteOpen: boolean;
  activeRegion: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  toasts: Toast[];
}

const initialState: UiState = {
  sidebarCollapsed: false,
  paletteOpen: false,
  activeRegion: { minLat: 0, maxLat: 100, minLon: 0, maxLon: 100 },
  toasts: [],
};

/** Session state lives in its own slice; it is security-relevant and orthogonal. */
export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number;
  /** True once `hydrate` has run, so guards do not redirect on first paint. */
  initialized: boolean;
}

const initialAuthState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
  initialized: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState: initialAuthState,
  reducers: {
    /** Loads a persisted session after hydration (never during SSR). */
    hydrate(state) {
      const session = readSession();
      state.user = session?.user ?? null;
      state.accessToken = session?.accessToken ?? null;
      state.refreshToken = session?.refreshToken ?? null;
      state.expiresAt = session?.expiresAt ?? 0;
      state.initialized = true;
    },
    signIn(state, action: PayloadAction<StoredSession>) {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.expiresAt = action.payload.expiresAt;
      state.initialized = true;
      writeSession(action.payload);
    },
    signOut(state) {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.expiresAt = 0;
      state.initialized = true;
      writeSession(null);
    },
    /** Keeps the cached profile in sync after an admin changes the role. */
    updateUser(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
      const session = readSession();
      if (session) {
        writeSession({ ...session, user: action.payload });
      }
    },
  },
});

export const { hydrate, signIn, signOut, updateUser } = authSlice.actions;

/** Convenience selector type re-export for consumers that need the role union. */
export type { Role };

/**
 * Persists the sidebar's collapsed state.
 *
 * Without this the rail re-expands on every reload, which is exactly the wrong
 * default for an operator who keeps the console open on a laptop screen all
 * shift. Read/write are guarded because `localStorage` throws in private
 * browsing modes and inside some embedded webviews.
 */
const SIDEBAR_STORAGE_KEY = "eoc.sidebar.collapsed";

export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Preference is cosmetic; failing to persist it must never break the UI.
  }
}

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      writeSidebarCollapsed(state.sidebarCollapsed);
    },
    /** Restores the stored preference once, after hydration. */
    hydrateSidebar(state) {
      state.sidebarCollapsed = readSidebarCollapsed();
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload;
      writeSidebarCollapsed(action.payload);
    },
    setPaletteOpen(state, action: PayloadAction<boolean>) {
      state.paletteOpen = action.payload;
    },
    togglePalette(state) {
      state.paletteOpen = !state.paletteOpen;
    },
    setActiveRegion(state, action: PayloadAction<UiState["activeRegion"]>) {
      state.activeRegion = action.payload;
    },
    pushToast(state, action: PayloadAction<Omit<Toast, "id" | "createdAt">>) {
      state.toasts.push({
        ...action.payload,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      });
      // Keep the stack readable.
      if (state.toasts.length > 4) {
        state.toasts.splice(0, state.toasts.length - 4);
      }
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const {
  toggleSidebar,
  hydrateSidebar,
  setSidebarCollapsed,
  setPaletteOpen,
  togglePalette,
  setActiveRegion,
  pushToast,
  dismissToast,
} = uiSlice.actions;

export default uiSlice.reducer;

/** Reducer for the `auth` slice; registered alongside `ui` in `store.ts`. */
export const authReducer = authSlice.reducer;
