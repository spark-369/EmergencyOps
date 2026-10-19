import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { api } from "@/lib/store/api";
import uiReducer, { authReducer } from "@/lib/store/ui-slice";

const rootReducer = combineReducers({
  [api.reducerPath]: api.reducer,
  ui: uiReducer,
  auth: authReducer,
});

/**
 * Returns a fresh store. `StoreProvider` memoises one instance per browser
 * session, while tests/SSR get isolated state on every call.
 */
export const makeStore = () =>
  configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
