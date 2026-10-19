"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClientOnly } from "@/components/providers/client-only";
import { AuthLayout } from "@/components/layout/auth-layout";
import { useRegisterMutation, useRegistrationStatusQuery } from "@/lib/store/api";
import { getErrorMessage } from "@/lib/use-api-notify";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input } from "@/components/ui/layout";

/**
 * First-run administrator registration.
 *
 * <p>This is not an open signup form. The endpoint behind it only works while the
 * user table is empty and returns 409 afterwards, so the page becomes permanently
 * inert once the system is set up. Every later account is created by an admin on
 * `/users`.
 *
 * <p>Rendered inside `ClientOnly`: the page reads `registration-status` and calls
 * a mutation, and any RTK Query hook initialises state with `Date.now()`, which
 * Next.js rejects during prerender.
 */
function RegisterForm() {
  const router = useRouter();
  const [register, { isLoading }] = useRegisterMutation();

  // Server-side truth: once an account exists this form can never succeed, so it
  // is replaced by an explanation instead of letting the user submit into a 409.
  const { data: registration } = useRegistrationStatusQuery();
  const closed = registration?.registrationOpen === false;

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    try {
      await register({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      }).unwrap();
      // Registration does not return a session, so signing in is a separate step.
      router.replace("/login?registered=1");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create the administrator account"));
    }
  };

  return (
    <AuthLayout
      title={closed ? "Setup already completed" : "Create the administrator"}
      description={
        closed
          ? "An administrator account already exists, so this form is permanently disabled."
          : "This form works once. It creates the first ADMIN account and then closes permanently."
      }
      footer={
        <p className="text-center text-[11px] text-slate-500">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-teal-300 hover:text-teal-200">
            Sign in
          </Link>
        </p>
      }
    >
      {closed ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            Registration is closed. Accounts are created by an administrator from the
            Users screen.
          </p>
          <Link href="/login" className="block">
            <Button variant="primary" className="w-full">
              Go to sign in
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {error && <ErrorState message={error} />}

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username" required hint="Letters, digits, dot, underscore, hyphen">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                placeholder="admin"
              />
            </Field>

            <Field label="Display name" required>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
                placeholder="System Administrator"
              />
            </Field>

            <Field label="Password" required hint="At least 8 characters">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>

            <Field label="Confirm password" required>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              loading={isLoading}
              disabled={
                username.trim() === "" ||
                displayName.trim() === "" ||
                password.length < 8 ||
                confirmPassword === ""
              }
              className="w-full"
            >
              Create administrator
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}

export default function RegisterPage() {
  // No useSearchParams here, so no Suspense boundary is needed. ClientOnly is
  // still required: this page calls useRegistrationStatusQuery, and `useQuery`
  // seeds state with `Date.now()`, which Next.js rejects during prerender.
  return (
    <ClientOnly>
      <RegisterForm />
    </ClientOnly>
  );
}