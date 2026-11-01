"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createCustomer,
  listCustomers,
  updateCustomer,
} from "@/lib/actions/sales";
import { callApi } from "@/lib/api-client";
import type { Customer } from "@/lib/accounting/types";
import { customerSchema, parseForm } from "@/lib/validation/schemas";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  formIssuesMessage,
  LoadingBlock,
  PageHeader,
  TextInput,
  tableClass,
} from "@/components/ui";

function CustomerForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Customer;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: {
    name: string;
    email?: string;
    address?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(customerSchema, { name, email, address });
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      await onSubmit({
        name: parsed.data.name,
        email: parsed.data.email === "" ? undefined : parsed.data.email,
        address: parsed.data.address || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="顧客名">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 株式会社サンプル"
            required
          />
        </Field>
        <Field label="メールアドレス">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="例: billing@example.co.jp"
          />
        </Field>
        <Field label="住所">
          <TextInput
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="例: 東京都渋谷区..."
          />
        </Field>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

export function CustomersScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => listCustomers(businessId ?? "")),
    [businessId],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="顧客一覧"
        description="請求書の発行先となる顧客を管理します"
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm((v) => !v);
              }}
            >
              {showForm && !editing ? "閉じる" : "顧客を登録"}
            </Button>
          ) : undefined
        }
      />

      {(showForm || editing) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editing ? "顧客の編集" : "顧客の登録"}
          </h2>
          <CustomerForm
            initial={editing ?? undefined}
            busy={busy}
            submitLabel={editing ? "変更を保存" : "登録する"}
            onSubmit={async (input) => {
              setBusy(true);
              try {
                if (editing) {
                  await callApi(() =>
                    updateCustomer(businessId ?? "", editing.id, {
                      name: input.name,
                      email: input.email ?? "",
                      address: input.address ?? "",
                    }),
                  );
                } else {
                  await callApi(() =>
                    createCustomer(businessId ?? "", {
                      name: input.name,
                      email: input.email ?? "",
                      address: input.address ?? "",
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  );
                }
                setEditing(null);
                setShowForm(false);
                reload();
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => {
              setEditing(null);
              setShowForm(false);
            }}
          />
        </Card>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="顧客がまだありません"
          description={
            canEdit ? "「顧客を登録」から追加してください" : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>顧客名</th>
                <th>メールアドレス</th>
                <th>住所</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td className="max-w-48 truncate">{c.email || "-"}</td>
                  <td className="max-w-64 truncate">{c.address || "-"}</td>
                  {canEdit && (
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(c);
                          setShowForm(false);
                        }}
                      >
                        編集
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
