"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppDispatch } from "@/lib/store/hooks";
import { signIn } from "@/lib/store/ui-slice";
import { useLoginMutation, useRegistrationStatusQuery } from "@/lib/store/api";
import { getErrorMessage } from "@/lib/use-api-notify";
import { isSafeNextPath } from "@/lib/auth/session";
import { API_BASE_URL } from "@/lib/axios";
import { ClientOnly } from "@/components/providers/client-only";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Button, LinkButton } from "@/components/ui/button";
import { ErrorState, Field, Input } from "@/components/ui/layout";

/**
 * Sign-in screen.
 *
 * `useSearchParams` requires a Suspense boundary in the App Router, hence the
 * split: `LoginScreen` reads the query string, `LoginPage` provides the boundary.
 */
function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const [login, { isLoading }] = useLoginMutation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Drives the first-run link. Safe here because LoginPage mounts this subtree
  // behind <ClientOnly>, so the hook never runs during prerender.
  const { data: registration } = useRegistrationStatusQuery();
  const justRegistered = searchParams.get("registered") === "1";

  /**
   * Post-login destination.
   *
   * Only same-origin absolute paths are followed (an absolute URL would be an
   * open redirect). A `next` that points back at the sign-in or setup screens is
   * discarded as well: bouncing to `/login` after a successful sign-in looks
   * like a failed login, and it is exactly the shape the old guard loop produced.
   */
  const nextPath = (() => {
    const raw = searchParams.get("next");
    // `isSafeNextPath` is a type predicate, so `raw` narrows to `string` here.
    if (!isSafeNextPath(raw)) return "/";
    const isAuthScreen =
      raw === "/login" ||
      raw.startsWith("/login?") ||
      raw === "/register" ||
      raw.startsWith("/register?");
    return isAuthScreen ? "/" : raw;
  })();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const tokens = await login({ username: username.trim(), password }).unwrap();
      dispatch(
        signIn({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          user: tokens.user,
        }),
      );
      router.replace(nextPath);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to sign in"));
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Use the credentials issued by your administrator."
      footer={
        <p className="text-center text-[11px] text-slate-500">
          Session tokens are issued by{" "}
          <code className="font-mono text-slate-600">{API_BASE_URL}</code>.
        </p>
      }
    >
      {error && <ErrorState message={error} />}

      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" required>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            required
            placeholder="operator"
          />
        </Field>

        <Field label="Password" required>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          loading={isLoading}
          disabled={username.trim() === "" || password === ""}
          className="w-full"
        >
          Sign in
        </Button>
      </form>

      {justRegistered && (
        <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
          Administrator created. Sign in with the credentials you just chose.
        </p>
      )}

      {/*
        Always rendered, not gated on `registrationOpen`. The status query can fail
        (backend down) or lag, and hiding the only path to first-run setup behind a
        successful probe leaves a brand-new deployment with no way in. The server
        still refuses registration once an account exists, and the register page
        reports that clearly.
      */}
      <div className="border-t border-border-subtle pt-4">
        <LinkButton href="/register" variant="secondary" className="w-full">
          Create the first administrator
        </LinkButton>
        {registration && !registration.registrationOpen && (
          <p className="mt-2 text-center text-[11px] text-slate-500">
            Setup already completed — ask an administrator for an account.
          </p>
        )}
      </div>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      {/*
        ClientOnly is required, not cosmetic: LoginScreen now calls
        `useRegistrationStatusQuery`, and RTK Query's `useQuery` seeds state with
        `Date.now()` on first render, which Next.js rejects during prerender.
      */}
      <ClientOnly>
        <LoginScreen />
      </ClientOnly>
    </Suspense>
  );
}