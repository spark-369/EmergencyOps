"use client";

import { useState } from "react";
import { useChangePasswordMutation } from "@/lib/store/api";
import { getErrorMessage } from "@/lib/use-api-notify";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";

/**
 * Self-service password change.
 *
 * The backend revokes every refresh token on success — including the caller's own
 * — so the dialog reports that the user must sign in again rather than pretending
 * the session continues. That is intentional: a password change should end any
 * session opened with the old password.
 */
export function PasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [changePassword, { isLoading }] = useChangePasswordMutation();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setDone(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("The new password must be at least 8 characters.");
      return;
    }

    try {
      await changePassword({ currentPassword, newPassword }).unwrap();
      setDone(true);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to change the password"));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      description="POST /api/v1/auth/change-password — all other sessions are signed out."
      footer={
        done ? (
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={isLoading}
              disabled={
                currentPassword === "" ||
                newPassword === "" ||
                confirmPassword === ""
              }
              onClick={submit}
            >
              Change password
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
          Password changed. Every session has been signed out — sign in again with
          your new password.
        </p>
      ) : (
        <div className="grid gap-3">
          {error && <ErrorState message={error} />}

          <Field label="Current password" required>
            <Input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password" required hint="At least 8 characters">
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password" required>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}