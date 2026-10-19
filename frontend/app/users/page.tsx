"use client";

import { useState } from "react";
import type { AuthUser, Role, UserRequest } from "@/lib/types";
import { ROLES } from "@/lib/types";
import {
  useCreateUserMutation,
  useDeleteUserMutation,
  useGetUserByIdQuery,
  useListUsersQuery,
  useUpdateUserMutation,
} from "@/lib/store/api";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { updateUser as updateCachedUser } from "@/lib/store/ui-slice";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { useRegistry } from "@/lib/use-registry";
import type { RegistryFilter } from "@/lib/use-registry";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import {
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonStats,
  SkeletonTable,
} from "@/components/ui/layout";
import type { Column } from "@/components/ui/table";
import {
  RegistryFilterSelect,
  RegistryPager,
  RegistrySearch,
  RegistryTable,
  RegistryToolbar,
} from "@/components/ui/registry";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { humanize, formatNumber } from "@/lib/format";
import { ROLE_HINTS } from "@/lib/navigation";

const EMPTY_FORM: UserRequest = {
  username: "",
  password: "",
  displayName: "",
  role: "VIEWER",
  enabled: true,
};

/**
 * Mirrors the Bean Validation rules on `UserRequest`, so a bad form is rejected
 * in the dialog instead of after a 400 round-trip.
 */
function validateCreate(values: UserRequest): Record<string, string> {
  const errors: Record<string, string> = {};
  const username = values.username.trim();
  if (!username) errors.username = "Username is required";
  else if (username.length < 3 || username.length > 100)
    errors.username = "Username must be between 3 and 100 characters";
  else if (!/^[A-Za-z0-9._-]+$/.test(username))
    errors.username =
      "Only letters, digits, dot, underscore and hyphen are allowed";

  if (!values.displayName.trim()) errors.displayName = "Display name is required";
  else if (values.displayName.trim().length > 150)
    errors.displayName = "Display name must be at most 150 characters";

  if (values.password.length < 8)
    errors.password = "Password must be between 8 and 200 characters";
  return errors;
}

/** Mirrors `UserUpdateRequest`: every field is optional, but a password is checked when present. */
function validateEdit(values: { displayName: string; password: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (values.displayName.trim().length > 150)
    errors.displayName = "Display name must be at most 150 characters";
  if (values.password !== "" && values.password.length < 8)
    errors.password = "Password must be at least 8 characters";
  return errors;
}

function UsersView() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((state) => state.auth.user);
  const { data, isLoading, isError, error, refetch } = useListUsersQuery();
  const run = useMutationToast();

  const [createUser, createState] = useCreateUserMutation();
  const [updateUser, updateState] = useUpdateUserMutation();
  const [deleteUser, deleteState] = useDeleteUserMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AuthUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);

  const [form, setForm] = useState<UserRequest>(EMPTY_FORM);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState({
    displayName: "",
    password: "",
    role: "VIEWER" as Role,
    enabled: true,
  });

  // `GET /users/{id}` — opens one account by primary key, independent of the list.
  const [lookupId, setLookupId] = useState("");
  const [lookupTarget, setLookupTarget] = useState("");
  const byId = useGetUserByIdQuery(Number(lookupTarget), {
    skip: lookupTarget === "" || Number.isNaN(Number(lookupTarget)),
  });

  const users = data ?? [];

  /*
   * Role tallies for the headline figures.
   *
   * `enabled` is separate from the role counts on purpose: a disabled admin
   * cannot manage anything, so "Administrators" must not overstate the number of
   * people who can actually reach this screen.
   */
  const enabledCount = users.filter((user) => user.enabled).length;
  const adminCount = users.filter((user) => user.role === "ADMIN" && user.enabled).length;
  const operationalCount = users.filter(
    (user) => user.enabled && (user.role === "DISPATCHER" || user.role === "FIELD_OPERATOR"),
  ).length;
  const viewerCount = users.filter((user) => user.enabled && user.role === "VIEWER").length;

  /** True when the dialog is editing the account that is currently signed in. */
  const isEditingSelf = editTarget !== null && editTarget.id === currentUser?.id;


  /*
   * Filters are declared once, outside the hook, because they are pure
   * predicates over a row. The hook owns the *selected values*; this array only
   * describes what can be selected.
   */
  const registryFilters: RegistryFilter[] = [
    {
      key: "role",
      label: "All roles",
      options: ROLES.map((role) => ({ value: role, label: humanize(role) })),
      match: (row, value) => (row as AuthUser).role === value,
    },
    {
      key: "enabled",
      label: "Any status",
      options: [
        { value: "enabled", label: "Enabled" },
        { value: "disabled", label: "Disabled" },
      ],
      match: (row, value) =>
        value === "enabled" ? (row as AuthUser).enabled : !(row as AuthUser).enabled,
    },
  ];

  const registry = useRegistry<AuthUser>({
    rows: users,
    searchFields: (row) => [row.displayName, row.username, humanize(row.role)],
    filters: registryFilters,
    sortValues: {
      user: (row) => row.displayName || row.username,
      role: (row) => row.role,
      enabled: (row) => (row.enabled ? 1 : 0),
    },
    initialSort: { key: "user", direction: "asc" },
  });

  const submitCreate = async () => {
    const validationErrors = validateCreate(form);
    setCreateErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const result = await run(
      createUser,
      { ...form, username: form.username.trim(), displayName: form.displayName.trim() },
      { method: "POST", successTitle: "User created", successDescription: form.username },
    );
    if (result.ok) {
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setCreateErrors({});
    }
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    const validationErrors = validateEdit(editForm);
    setEditErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const result = await run(
      updateUser,
      {
        id: editTarget.id,
        body: {
          displayName: editForm.displayName.trim() || undefined,
          password: editForm.password || undefined,
          role: editForm.role,
          /*
           * Self-disable is refused here as well as in the control: disabling your
           * own account signs you out at the next token refresh, and there is no
           * in-app way back. Sending `enabled: true` keeps the update valid while
           * making the intent explicit rather than silently dropping the field.
           */
          enabled: isEditingSelf ? true : editForm.enabled,
        },
      },
      { method: "PATCH", successTitle: "User updated", successDescription: editTarget.username },
    );
    if (result.ok) {
      // Keep the shell in sync when an admin edits their own profile.
      if (currentUser && result.data && result.data.id === currentUser.id) {
        dispatch(updateCachedUser(result.data));
      }
      setEditTarget(null);
      setEditErrors({});
    }
  };

  const columns: Column<AuthUser>[] = [
    {
      key: "user",
      header: "User",
      render: (row) => {
        const isSelf = row.id === currentUser?.id;
        return (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-950">
              {row.displayName}
              {/*
                Marking the signed-in account matters: it explains why Edit/Delete
                behave differently on this row, and it is the row an admin is most
                likely to change by accident.
              */}
              {isSelf && (
                <span className="rounded bg-teal-400/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-teal-300 uppercase ring-1 ring-teal-400/30 ring-inset">
                  You
                </span>
              )}
            </p>
            <p className="truncate font-mono text-[11px] text-slate-500">@{row.username}</p>
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge
          label={humanize(row.role)}
          tone={row.role === "ADMIN" ? "violet" : "info"}
          title={ROLE_HINTS[row.role]}
        />
      ),
    },
    {
      key: "enabled",
      header: "Status",
      // Reuses the shared status tones so the palette stays consistent.
      render: (row) => <StatusBadge value={row.enabled ? "OPERATIONAL" : "OFFLINE"} />,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => {
        const isSelf = row.id === currentUser?.id;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="secondary"
              title={isSelf ? "Edit your own profile" : `Edit @${row.username}`}
              onClick={() => {
                setEditTarget(row);
                setEditErrors({});
                setEditForm({
                  displayName: row.displayName,
                  password: "",
                  role: row.role,
                  enabled: row.enabled,
                });
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              disabled={isSelf}
              title={isSelf ? "You cannot delete your own account" : `Delete @${row.username}`}
              onClick={() => setDeleteTarget(row)}
            >
              Delete
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users & access"
        description="Accounts, roles and access control. Role changes take effect at the user's next sign-in."
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            New user
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Accounts"
          value={formatNumber(users.length)}
          hint={
            users.length === 0
              ? "No accounts yet"
              : `${formatNumber(enabledCount)} enabled · ${formatNumber(users.length - enabledCount)} disabled`
          }
          tone="teal"
        />
        <StatCard
          label="Administrators"
          value={formatNumber(adminCount)}
          hint={
            adminCount <= 1
              ? "Only one — full control rests on a single account"
              : "Full access to every domain"
          }
          tone={adminCount <= 1 ? "amber" : "violet"}
        />
        <StatCard
          label="Operational"
          value={formatNumber(operationalCount)}
          hint="Dispatchers and field operators"
          tone="sky"
        />
        <StatCard
          label="Read-only"
          value={formatNumber(viewerCount)}
          hint="Viewers — cannot change anything"
          tone="slate"
        />
      </div>

      {/*
        Single-admin warning.
        Losing the last administrator locks account management with no in-app
        recovery, so the risk is stated while there is still time to act on it.
        The backend refuses to delete the last enabled admin, which makes this a
        "add a second one" prompt rather than an error.
      */}
      {adminCount === 1 && users.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200"
        >
          <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <span>
            <strong className="font-semibold">One administrator.</strong> If that account is lost or
            disabled, nobody can manage users. Create a second administrator.
          </span>
        </div>
      )}

      <Card>
        <CardHeader
          title="Accounts"
          description={`${formatNumber(users.length)} account${users.length === 1 ? "" : "s"} · role changes take effect at the user's next sign-in`}
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => refetch()}
              loading={isLoading}
            >
              Refresh
            </Button>
          }
        />
        <RegistryToolbar
          trailing={
            <>
              {registry.isFiltered && (
                <Button size="sm" variant="ghost" onClick={registry.clearFilters}>
                  Clear
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Field label="Open by id">
                  <Input
                    className="w-24"
                    type="number"
                    placeholder="1"
                    value={lookupId}
                    onChange={(event) => setLookupId(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setLookupTarget(lookupId.trim());
                    }}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setLookupTarget(lookupId.trim())}
                  disabled={lookupId === "" || Number.isNaN(Number(lookupId))}
                >
                  Open
                </Button>
              </div>
            </>
          }
        >
          <RegistrySearch
            value={registry.query}
            onChange={registry.setQuery}
            placeholder="Search name, username or role"
          />
          {registryFilters.map((filter) => (
            <RegistryFilterSelect
              key={filter.key}
              filter={filter}
              value={registry.values[filter.key] ?? ""}
              onChange={(value) => registry.setFilter(filter.key, value)}
            />
          ))}
        </RegistryToolbar>

        {(byId.isError || (byId.data && lookupTarget !== "")) && (
          <div className="border-b border-border-subtle px-4 py-3">
            {byId.isError ? (
              <ErrorState
                message={getErrorMessage(byId.error, "User not found")}
                onRetry={() => byId.refetch()}
              />
            ) : byId.data ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500">#{byId.data.id}</span>
                <span className="font-medium">{byId.data.displayName}</span>
                <span className="font-mono text-xs text-slate-500">@{byId.data.username}</span>
                <Badge label={humanize(byId.data.role)} tone="info" />
                <StatusBadge value={byId.data.enabled ? "OPERATIONAL" : "OFFLINE"} />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    setLookupTarget("");
                    setLookupId("");
                  }}
                >
                  Close
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {isError ? (
          <CardBody>
            <ErrorState
              message={getErrorMessage(error, "Unable to load users")}
              onRetry={() => refetch()}
            />
          </CardBody>
        ) : (
          <>
            <RegistryTable
              columns={columns}
              rows={registry.pageRows}
              loading={isLoading}
              rowKey={(row) => row.id}
              sort={registry.sort}
              onToggleSort={registry.toggleSort}
              sortableKeys={["user", "role", "enabled"]}
              emptyTitle={
                registry.isFiltered ? "No accounts match those filters" : "No users yet"
              }
              emptyDescription={
                registry.isFiltered
                  ? "Try a different search term, or clear the filters to see every account."
                  : "Create the first account to let operators sign in."
              }
              emptyAction={
                registry.isFiltered ? undefined : (
                  <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
                    New user
                  </Button>
                )
              }
            />
            <RegistryPager
              page={registry.page}
              pageCount={registry.pageCount}
              total={registry.total}
              size={registry.size}
              onPage={registry.setPage}
              onSize={registry.setSize}
              noun="account"
            />
          </>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New user"
        description="The password is hashed on the server and never returned."
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createState.isLoading}
              disabled={
                form.username.trim() === "" ||
                form.password.length < 8 ||
                form.displayName.trim() === ""
              }
              onClick={submitCreate}
            >
              Create user
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Username"
            required
            error={createErrors.username}
            hint="Letters, digits, dot, underscore, hyphen"
          >
            <Input
              value={form.username}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, username: event.target.value }))
              }
              placeholder="dispatcher.one"
            />
          </Field>
          <Field label="Display name" required error={createErrors.displayName}>
            <Input
              value={form.displayName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
              placeholder="Dana Ops"
            />
          </Field>
          <Field label="Password" required error={createErrors.password} hint="At least 8 characters">
            <Input
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, password: event.target.value }))
              }
              autoComplete="new-password"
            />
          </Field>
          <Field label="Role" required hint={ROLE_HINTS[form.role]}>
            <Select
              value={form.role}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, role: event.target.value as Role }))
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {humanize(role)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`Edit ${editTarget?.displayName ?? editTarget?.username ?? ""}`}
        description="Leave the password blank to keep the current one."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={updateState.isLoading} onClick={submitEdit}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name" error={editErrors.displayName}>
            <Input
              value={editForm.displayName}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
            />
          </Field>
          <Field label="Role" hint={ROLE_HINTS[editForm.role]}>
            <Select
              value={editForm.role}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, role: event.target.value as Role }))
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {humanize(role)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="New password"
            error={editErrors.password}
            hint="Leave blank to keep the current password"
          >
            <Input
              type="password"
              value={editForm.password}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, password: event.target.value }))
              }
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Account enabled"
            hint={
              isEditingSelf ? "You cannot disable your own account" : undefined
            }
          >
            <Select
              value={editForm.enabled ? "true" : "false"}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, enabled: event.target.value === "true" }))
              }
              /*
               * Self-disable is blocked in the UI: an admin who disables their own
               * account is signed out at the next refresh with no way back in
               * unless another enabled admin exists. Demoting your own role is
               * allowed — that is reversible by another admin, and the backend
               * protects against removing the last one.
               */
              disabled={isEditingSelf}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete user"
        message={
          <>
            Permanently delete <span className="font-medium">{deleteTarget?.displayName}</span>{" "}
            (<span className="font-mono">@{deleteTarget?.username}</span>)? Their sessions are
            revoked immediately. The last enabled administrator cannot be deleted.
          </>
        }
        confirmLabel="Delete user"
        loading={deleteState.isLoading}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const result = await run(deleteUser, deleteTarget.id, {
            method: "DELETE",
            successTitle: "User deleted",
            successDescription: `@${deleteTarget.username} removed.`,
          });
          if (result.ok) setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default function UsersPage() {
  return (
    <ClientOnly
      fallback={
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Administration"
            title="Users & access"
            description="Accounts, roles and access control. Role changes take effect at the user's next sign-in."
          />
          <SkeletonStats count={4} />
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="mt-2 h-2.5 w-52" />
            </div>
            <SkeletonTable rows={5} />
          </div>
        </div>
      }
    >
      <UsersView />
    </ClientOnly>
  );
}