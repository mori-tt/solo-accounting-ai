"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createProject,
  listCustomers,
  listProjects,
  updateProject,
} from "@/lib/actions/sales";
import { callApi } from "@/lib/api-client";
import type { Customer, Project, ProjectStatus } from "@/lib/accounting/types";
import { parseForm, projectSchema } from "@/lib/validation/schemas";
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
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "active", label: "進行中" },
  { value: "done", label: "完了" },
  { value: "archived", label: "アーカイブ" },
];

function ProjectForm({
  customers,
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  customers: Customer[];
  initial?: Project;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: {
    customerId: string;
    name: string;
    status?: ProjectStatus;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(
    initial?.status ?? "active",
  );
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (initial) {
      if (!name.trim()) {
        setError("案件名を入力してください");
        return;
      }
      setError(undefined);
      try {
        await onSubmit({ customerId, name, status });
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
      return;
    }
    const parsed = parseForm(projectSchema, { customerId, name });
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="顧客">
          <Select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={!!initial}
            required
          >
            <option value="">選択してください</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="案件名">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: Webサイト制作"
            required
          />
        </Field>
        {initial && (
          <Field label="状態">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
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

export function ProjectsScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const { data, initialLoading, error, reload } = useApiData(async () => {
    const [projects, customers] = await Promise.all([
      callApi(() => listProjects(businessId ?? "")),
      callApi(() => listCustomers(businessId ?? "")),
    ]);
    return { projects, customers };
  }, [businessId]);

  const customerName = (id: string) =>
    data?.customers.find((c) => c.id === id)?.name ?? "-";

  const filtered = (data?.projects ?? []).filter(
    (p) => statusFilter === "" || p.status === statusFilter,
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="案件一覧"
        description="顧客ごとの案件(プロジェクト)を管理します"
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm((v) => !v);
              }}
            >
              {showForm && !editing ? "閉じる" : "案件を登録"}
            </Button>
          ) : undefined
        }
      />

      {(showForm || editing) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editing ? "案件の編集" : "案件の登録"}
          </h2>
          <ProjectForm
            customers={data?.customers ?? []}
            initial={editing ?? undefined}
            busy={busy}
            submitLabel={editing ? "変更を保存" : "登録する"}
            onSubmit={async (input) => {
              setBusy(true);
              try {
                if (editing) {
                  await callApi(() =>
                    updateProject(businessId ?? "", editing.id, {
                      name: input.name,
                      status: input.status ?? "active",
                    }),
                  );
                } else {
                  await callApi(() =>
                    createProject(businessId ?? "", {
                      customerId: input.customerId,
                      name: input.name,
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

      <div className="mb-4">
        <Select
          className="w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="状態で絞り込み"
        >
          <option value="">すべての状態</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            (data?.projects.length ?? 0) > 0
              ? "条件に一致する案件がありません"
              : "案件がまだありません"
          }
          description={
            canEdit
              ? data?.customers.length
                ? "「案件を登録」から追加してください"
                : "先に顧客一覧で顧客を登録してください"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>案件名</th>
                <th>顧客</th>
                <th>状態</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{customerName(p.customerId)}</td>
                  <td>
                    <StatusBadge kind="project" status={p.status} />
                  </td>
                  {canEdit && (
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(p);
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
