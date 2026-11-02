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
  buildSupportMail,
  getMailSender,
  SUPPORT_CATEGORIES,
  SUPPORT_EMAIL,
  type SupportCategory,
} from "@/lib/mail";
import {
  businessSchema,
  memberInviteSchema,
  parseForm,
} from "@/lib/validation/schemas";
import type { MemberRole, TaxMode } from "@/lib/accounting/types";
import {
  BILLING_FEATURES,
  businessPlanOf,
  BUSINESS_PLANS,
  FEATURE_LABELS,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
} from "@/lib/billing";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  issuesByField,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  Textarea,
  TextInput,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { APP_VERSION } from "@/lib/version";

const TAX_MODE_LABELS: Record<TaxMode, string> = {
  exempt: "免税事業者",
  simple: "簡易課税",
  standard: "本則課税",
  special20: "2割特例(インボイス移行措置)",
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
  const [registrationNumber, setRegistrationNumber] = useState(
    business?.invoiceRegistrationNumber ?? "",
  );
  const [issuerName, setIssuerName] = useState(business?.issuerName ?? "");
  const [issuerAddress, setIssuerAddress] = useState(
    business?.issuerAddress ?? "",
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(businessSchema, {
      name,
      fiscalYearStartMonth: Number(startMonth),
      taxMode,
      invoiceRegistrationNumber: registrationNumber,
      issuerName,
      issuerAddress,
    });
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
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
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="事業名" error={fieldErrors.name}>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field
              label="会計年度の開始月"
              error={fieldErrors.fiscalYearStartMonth}
            >
              <NumberInput
                value={startMonth}
                min={1}
                max={12}
                step={1}
                onChange={(e) => setStartMonth(e.target.value)}
                required
              />
            </Field>
            <Field label="消費税の課税方式" error={fieldErrors.taxMode}>
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
          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="mb-2 text-xs font-medium text-zinc-500">
              適格請求書(インボイス)発行情報
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field
                label="登録番号"
                error={fieldErrors.invoiceRegistrationNumber}
                hint="Tに続く13桁。未登録の場合は空欄"
              >
                <TextInput
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="T1234567890123"
                />
              </Field>
              <Field
                label="発行者名"
                error={fieldErrors.issuerName}
                hint="空欄の場合は事業名を表示"
              >
                <TextInput
                  value={issuerName}
                  onChange={(e) => setIssuerName(e.target.value)}
                  placeholder="例: 山田太郎商店"
                />
              </Field>
              <Field label="発行者住所" error={fieldErrors.issuerAddress}>
                <TextInput
                  value={issuerAddress}
                  onChange={(e) => setIssuerAddress(e.target.value)}
                  placeholder="例: 東京都渋谷区1-2-3"
                />
              </Field>
            </div>
          </div>
          {fieldErrors._form && (
            <Alert tone="error">{fieldErrors._form}</Alert>
          )}
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
          <div>
            <dt className="text-xs text-zinc-500">インボイス登録番号</dt>
            <dd>{business?.invoiceRegistrationNumber ?? "未登録"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">発行者名</dt>
            <dd>{business?.issuerName || business?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">発行者住所</dt>
            <dd>{business?.issuerAddress || "-"}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

/**
 * 料金プランの表示セクション。
 * 現行プランと機能比較(PLAN_ENTITLEMENTSから組み立て)を表示するのみで、
 * プラン変更はまだ行えない。決済プロバイダ(Stripe等)との接続時は
 * このカードの「プランを変更」が課金ポータルへの遷移点になる。
 */
function PlanCard() {
  const { business } = useApp();
  // plan未設定(課金導入前データ)はfree扱い。値の正規化はbilling層に集約
  const plan = businessPlanOf(business);

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">プラン</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-zinc-500">現在のプラン</span>
        <Badge tone="indigo">{PLAN_LABELS[plan]}</Badge>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th>機能</th>
              {BUSINESS_PLANS.map((p) => (
                <th key={p}>
                  {PLAN_LABELS[p]}
                  {p === plan && (
                    <span className="ml-1 text-indigo-600 dark:text-indigo-400">
                      (現在)
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BILLING_FEATURES.map((feature) => (
              <tr key={feature}>
                <td>{FEATURE_LABELS[feature]}</td>
                {BUSINESS_PLANS.map((p) => (
                  <td key={p}>
                    {PLAN_ENTITLEMENTS[p][feature] ? (
                      "○"
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="mb-2 text-xs text-zinc-500">
          課金機能は未接続です。決済プロバイダ(Stripe等)との連携後に
          プラン変更・支払い管理をここから行えるようになります。
        </p>
        {/* 課金接続点: 決済プロバイダ導入時はこのボタンを
            チェックアウト/カスタマーポータルへの遷移に置き換え、
            webhook側で Business.plan を更新する */}
        <Button variant="secondary" disabled>
          プランを変更(準備中)
        </Button>
      </div>
    </Card>
  );
}

function MembersCard() {
  const { businessId, business, user } = useApp();
  const isOwner = business?.role === "owner";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
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
        <EmptyState title="メンバーがまだいません" />
      ) : (
        <div className="overflow-x-auto">
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
                        aria-label="ロール変更"
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
        </div>
      )}

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      {isOwner && (
        <form
          onSubmit={invite}
          noValidate
          className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="メンバー招待(メールアドレス)"
              error={fieldErrors.email}
            >
              <TextInput
                type="email"
                className="w-64"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </Field>
            <Field label="ロール" error={fieldErrors.role}>
              <Select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "editor" | "viewer")
                }
              >
                <option value="editor">編集者</option>
                <option value="viewer">閲覧者</option>
              </Select>
            </Field>
            <Button type="submit" loading={busy}>
              招待する
            </Button>
          </div>
          {fieldErrors._form && (
            <Alert tone="error" className="mt-3">
              {fieldErrors._form}
            </Alert>
          )}
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
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
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="事業名" error={fieldErrors.name}>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田太郎商店"
              required
            />
          </Field>
          <Field
            label="会計年度の開始月"
            error={fieldErrors.fiscalYearStartMonth}
          >
            <NumberInput
              value={startMonth}
              min={1}
              max={12}
              step={1}
              onChange={(e) => setStartMonth(e.target.value)}
              required
            />
          </Field>
          <Field label="消費税の課税方式" error={fieldErrors.taxMode}>
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
        {fieldErrors._form && (
          <Alert tone="error">{fieldErrors._form}</Alert>
        )}
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

/**
 * サポート連絡先カード。問い合わせ種別・内容から定型の問い合わせ
 * メールを組み立て、既定のメーラーで下書きを開く(実送信はメーラー任せ)。
 * 個人情報は自動的に本文へ含めない(自動付記はアプリバージョンのみ)。
 */
function SupportCard() {
  const [category, setCategory] = useState<SupportCategory>(
    SUPPORT_CATEGORIES[0],
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const result = await getMailSender().send(
      buildSupportMail({ category, message }),
    );
    if (!result.ok) setError(result.error);
  };

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">サポート・お問い合わせ</h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        不明点・不具合・ご要望はサポート窓口(
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
        >
          {SUPPORT_EMAIL}
        </a>
        )までご連絡ください。下のフォームからも既定のメーラーで
        お問い合わせメールを作成できます。
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field label="お問い合わせ種別">
          <Select
            className="sm:w-72"
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportCategory)}
          >
            {SUPPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="お問い合わせ内容(任意)">
          <Textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="例: ○○画面で△△を実行するとエラーになります"
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <Button type="submit">メーラーでお問い合わせを作成</Button>
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
          <div>
            <dt className="text-xs text-zinc-500">アプリバージョン</dt>
            <dd>v{APP_VERSION}</dd>
          </div>
        </dl>
      </Card>

      <BusinessSettingsCard />
      <PlanCard />
      <MembersCard />
      <NewBusinessCard />
      <SupportCard />
    </div>
  );
}
