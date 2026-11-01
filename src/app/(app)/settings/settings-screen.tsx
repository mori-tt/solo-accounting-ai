"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createBusiness,
  inviteMember,
  listBusinessMembers,
  removeMember,
  updateBusinessSettings,
  updateMemberRole,
} from "@/lib/actions/businesses";
import { callApi } from "@/lib/api-client";
import {
  businessSchema,
  memberInviteSchema,
  parseForm,
} from "@/lib/validation/schemas";
import type { MemberRole, TaxMode } from "@/lib/accounting/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

const TAX_MODE_LABELS: Record<TaxMode, string> = {
  exempt: "免税事業者",
  simple: "簡易課税",
  standard: "本則課税",
};

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "オーナー",
  editor: "編集者",
  viewer: "閲覧者",
};

function BusinessSettingsCard() {
  const { businessId, business, reloadBusinesses } = useApp();
  const isOwner = business?.role === "owner";

  const [name, setName] = useState(business?.name ?? "");
  const [startMonth, setStartMonth] = useState(
    String(business?.fiscalYearStartMonth ?? 1),
  );
  const [taxMode, setTaxMode] = useState<TaxMode>(
    (business?.taxMode as TaxMode) ?? "exempt",
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(businessSchema, {
      name,
      fiscalYearStartMonth: Number(startMonth),
      taxMode,
    });
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
      return;
    }
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await callApi(() =>
        updateBusinessSettings(businessId ?? "", parsed.data),
      );
      setSaved(true);
      reloadBusinesses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">事業情報</h2>
      {isOwner ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="事業名">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="会計年度の開始月">
              <NumberInput
                value={startMonth}
                min={1}
                max={12}
                step={1}
                onChange={(e) => setStartMonth(e.target.value)}
              />
            </Field>
            <Field label="消費税の課税方式">
              <Select
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as TaxMode)}
              >
                {Object.entries(TAX_MODE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          {saved && <Alert tone="info">保存しました</Alert>}
          <div>
            <Button type="submit" loading={busy}>
              保存する
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">事業名</dt>
            <dd>{business?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">会計年度の開始月</dt>
            <dd>{business?.fiscalYearStartMonth}月</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">消費税の課税方式</dt>
            <dd>
              {TAX_MODE_LABELS[(business?.taxMode as TaxMode) ?? "exempt"]}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

function MembersCard() {
  const { businessId, business, user } = useApp();
  const isOwner = business?.role === "owner";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const { data, initialLoading, error: loadError, reload } = useApiData(
    () => callApi(() => listBusinessMembers(businessId ?? "")),
    [businessId],
  );

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(memberInviteSchema, { email, role });
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await callApi(() => inviteMember(businessId ?? "", parsed.data));
      setEmail("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "招待に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (uid: string, next: "editor" | "viewer") => {
    try {
      await callApi(() =>
        updateMemberRole(businessId ?? "", uid, next),
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "変更に失敗しました");
    }
  };

  const doRemove = async (uid: string) => {
    try {
      await callApi(() => removeMember(businessId ?? "", uid));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">メンバー</h2>
      {loadError ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.length === 0 ? (
        <EmptyState title="メンバーがいません" />
      ) : (
        <table className={tableClass}>
          <thead>
            <tr>
              <th>UID</th>
              <th>ロール</th>
              {isOwner && <th></th>}
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.uid}>
                <td className="font-mono text-xs">
                  {m.uid}
                  {m.uid === user?.uid && (
                    <span className="ml-2 text-zinc-400">(あなた)</span>
                  )}
                </td>
                <td>
                  {isOwner && m.role !== "owner" && m.uid !== user?.uid ? (
                    <Select
                      className="w-28"
                      value={m.role}
                      onChange={(e) =>
                        void changeRole(
                          m.uid,
                          e.target.value as "editor" | "viewer",
                        )
                      }
                    >
                      <option value="editor">編集者</option>
                      <option value="viewer">閲覧者</option>
                    </Select>
                  ) : (
                    <StatusBadge kind="role" status={m.role} />
                  )}
                </td>
                {isOwner && (
                  <td>
                    {m.uid !== user?.uid && m.role !== "owner" && (
                      <Button
                        variant="danger"
                        onClick={() => setRemoveTarget(m.uid)}
                      >
                        削除
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isOwner && (
        <form
          onSubmit={invite}
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <Field label="メンバー招待(メールアドレス)">
            <TextInput
              type="email"
              className="w-64"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </Field>
          <Field label="ロール">
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
            >
              <option value="editor">編集者</option>
              <option value="viewer">閲覧者</option>
            </Select>
          </Field>
          <Button type="submit" loading={busy}>
            招待する
          </Button>
          {error && <Alert tone="error">{error}</Alert>}
        </form>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="メンバーの削除"
        message="このメンバーを事業から削除します。この操作は取り消せません。"
        confirmLabel="削除する"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          const uid = removeTarget;
          setRemoveTarget(null);
          if (uid) void doRemove(uid);
        }}
      />
    </Card>
  );
}

function NewBusinessCard() {
  const { reloadBusinesses, selectBusiness } = useApp();
  const [name, setName] = useState("");
  const [startMonth, setStartMonth] = useState("1");
  const [taxMode, setTaxMode] = useState<TaxMode>("exempt");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(businessSchema, {
      name,
      fiscalYearStartMonth: Number(startMonth),
      taxMode,
    });
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const created = await callApi(() =>
        createBusiness({
          ...parsed.data,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      await reloadBusinesses();
      selectBusiness(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">新しい事業を作成</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="事業名">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田太郎商店"
            />
          </Field>
          <Field label="会計年度の開始月">
            <NumberInput
              value={startMonth}
              min={1}
              max={12}
              step={1}
              onChange={(e) => setStartMonth(e.target.value)}
            />
          </Field>
          <Field label="消費税の課税方式">
            <Select
              value={taxMode}
              onChange={(e) => setTaxMode(e.target.value as TaxMode)}
            >
              {Object.entries(TAX_MODE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <Button type="submit" loading={busy}>
            事業を作成する
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function SettingsScreen() {
  useBrowserOnly();
  const { user, business } = useApp();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader title="設定" />

      <Card>
        <h2 className="mb-3 text-sm font-semibold">アカウント</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">メールアドレス</dt>
            <dd>{user?.email ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">現在の事業でのロール</dt>
            <dd>
              {business ? (
                <>
                  {business.name}{" "}
                  <Badge tone="indigo">{ROLE_LABELS[business.role]}</Badge>
                </>
              ) : (
                "-"
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <BusinessSettingsCard />
      <MembersCard />
      <NewBusinessCard />
    </div>
  );
}
