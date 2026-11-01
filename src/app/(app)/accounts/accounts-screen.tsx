"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { useAccounts } from "@/lib/hooks/use-accounts";
import {
  listUsedAccountCodes,
  saveCustomAccounts,
} from "@/lib/actions/accounts";
import { callApi } from "@/lib/api-client";
import type { CustomAccount } from "@/lib/accounting/types";
import {
  customAccountItemSchema,
  parseForm,
  type CustomAccountInput,
} from "@/lib/validation/schemas";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  issuesByField,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";

const KIND_LABELS: Record<CustomAccount["kind"], string> = {
  income: "収入",
  expense: "支出",
};

const MAX_CUSTOM_ACCOUNTS = 50;

interface AccountFormState {
  code: string;
  label: string;
  kind: CustomAccount["kind"];
  parentCode: string;
}

const EMPTY_FORM: AccountFormState = {
  code: "",
  label: "",
  kind: "expense",
  parentCode: "",
};

export function AccountsScreen() {
  useBrowserOnly();
  const { businessId, business, reloadBusinesses } = useApp();
  const canEdit = business?.role !== "viewer";
  const customAccounts = business?.customAccounts ?? [];
  const { options, label } = useAccounts();

  const {
    data: usedCodes,
    initialLoading,
    error: loadError,
    reload,
  } = useApiData(
    () => callApi(() => listUsedAccountCodes(businessId ?? "")),
    [businessId],
  );
  const used = useMemo(() => new Set(usedCodes ?? []), [usedCodes]);

  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomAccount | null>(null);

  const save = async (next: CustomAccountInput[]): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await callApi(() => saveCustomAccounts(businessId ?? "", next));
      reloadBusinesses();
      reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resetForm = () => {
    setEditingCode(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(customAccountItemSchema, {
      code: form.code,
      label: form.label,
      kind: form.kind,
      parentCode: form.parentCode || undefined,
    });
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    const input = parsed.data;
    const errors: Record<string, string> = {};
    // code は標準科目・他カスタム科目とも重複不可(編集時は自身を除く)
    const duplicate = options.some(
      (a) => a.code === input.code && a.code !== editingCode,
    );
    if (duplicate) {
      errors.code = "この科目コードはすでに使われています";
    }
    if (
      input.parentCode !== undefined &&
      input.parentCode !== "" &&
      input.parentCode === input.code
    ) {
      errors.parentCode = "親科目に自分自身は指定できません";
    }
    if (!editingCode && customAccounts.length >= MAX_CUSTOM_ACCOUNTS) {
      errors._form = `カスタム科目は${MAX_CUSTOM_ACCOUNTS}件までです`;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    const next: CustomAccountInput[] = editingCode
      ? customAccounts.map((c) =>
          c.code === editingCode
            ? {
                code: c.code,
                label: input.label,
                kind: input.kind,
                parentCode: input.parentCode || undefined,
                disabled: c.disabled,
              }
            : c,
        )
      : [
          ...customAccounts,
          {
            code: input.code,
            label: input.label,
            kind: input.kind,
            parentCode: input.parentCode || undefined,
          },
        ];
    if (await save(next)) resetForm();
  };

  const toggleDisabled = (account: CustomAccount) =>
    save(
      customAccounts.map((c) =>
        c.code === account.code ? { ...c, disabled: !c.disabled } : c,
      ),
    );

  const doDelete = (account: CustomAccount) =>
    save(customAccounts.filter((c) => c.code !== account.code));

  const parentChoices = options.filter(
    (a) => !a.disabled && a.code !== form.code,
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="勘定科目・補助科目"
        description="事業独自の科目を登録すると取引入力やAI提案・CSV取込で使えるようになります"
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold">
          カスタム科目({customAccounts.length}/{MAX_CUSTOM_ACCOUNTS})
        </h2>
        {loadError ? (
          <Alert tone="error">{loadError}</Alert>
        ) : initialLoading ? (
          <LoadingBlock />
        ) : customAccounts.length === 0 ? (
          <EmptyState
            title="カスタム科目はまだありません"
            description={
              canEdit ? "下のフォームから追加できます" : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>コード</th>
                  <th>科目名</th>
                  <th>種別</th>
                  <th>親科目</th>
                  <th>状態</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {customAccounts.map((a) => (
                  <tr key={a.code}>
                    <td className="font-mono text-xs">{a.code}</td>
                    <td>{a.label}</td>
                    <td>{KIND_LABELS[a.kind]}</td>
                    <td className="text-xs">
                      {a.parentCode ? (
                        <>
                          {label(a.parentCode)}
                          <span className="ml-1 text-zinc-400">
                            ({a.parentCode})
                          </span>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {a.disabled && <Badge tone="gray">無効</Badge>}
                      {used.has(a.code) && (
                        <span className={a.disabled ? "ml-1" : ""}>
                          <Badge tone="sky">使用中</Badge>
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditingCode(a.code);
                              setForm({
                                code: a.code,
                                label: a.label,
                                kind: a.kind,
                                parentCode: a.parentCode ?? "",
                              });
                              setFieldErrors({});
                            }}
                            disabled={busy}
                          >
                            編集
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => void toggleDisabled(a)}
                            disabled={busy}
                          >
                            {a.disabled ? "有効化" : "無効化"}
                          </Button>
                          {!used.has(a.code) && (
                            <Button
                              variant="danger"
                              onClick={() => setDeleteTarget(a)}
                              disabled={busy}
                            >
                              削除
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {customAccounts.some((a) => used.has(a.code)) && (
          <p className="mt-2 text-xs text-zinc-400">
            取引で使用中の科目は削除できません。選択肢から外すには無効化してください。
          </p>
        )}
      </Card>

      {canEdit && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">
            {editingCode ? `科目の編集(${editingCode})` : "科目の追加"}
          </h2>
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="科目コード"
                hint={
                  editingCode
                    ? "コードは変更できません"
                    : "英数字と_のみ・事業内で一意"
                }
                error={fieldErrors.code}
              >
                <TextInput
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="例: software_fee"
                  disabled={editingCode !== null}
                  required
                />
              </Field>
              <Field label="科目名" error={fieldErrors.label}>
                <TextInput
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="例: ソフトウェア利用料"
                  required
                />
              </Field>
              <Field label="種別" error={fieldErrors.kind}>
                <Select
                  value={form.kind}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      kind: e.target.value as CustomAccount["kind"],
                    })
                  }
                >
                  <option value="expense">支出</option>
                  <option value="income">収入</option>
                </Select>
              </Field>
              <Field
                label="親科目(補助科目の場合・任意)"
                error={fieldErrors.parentCode}
              >
                <Select
                  value={form.parentCode}
                  onChange={(e) =>
                    setForm({ ...form, parentCode: e.target.value })
                  }
                >
                  <option value="">なし</option>
                  {parentChoices.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.label}({a.code})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {fieldErrors._form && (
              <Alert tone="error">{fieldErrors._form}</Alert>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>
                {editingCode ? "変更を保存" : "追加する"}
              </Button>
              {editingCode && (
                <Button type="button" variant="secondary" onClick={resetForm}>
                  キャンセル
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">標準科目(変更不可)</h2>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>コード</th>
                <th>科目名</th>
                <th>種別</th>
              </tr>
            </thead>
            <tbody>
              {options
                .filter(
                  (a) => !customAccounts.some((c) => c.code === a.code),
                )
                .map((a) => (
                  <tr key={a.code}>
                    <td className="font-mono text-xs">{a.code}</td>
                    <td>{a.label}</td>
                    <td>
                      {a.kind === "any"
                        ? "共通"
                        : KIND_LABELS[a.kind as CustomAccount["kind"]]}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="カスタム科目の削除"
        message={`「${deleteTarget?.label}(${deleteTarget?.code})」を削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        loading={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void doDelete(target);
        }}
      />
    </div>
  );
}
