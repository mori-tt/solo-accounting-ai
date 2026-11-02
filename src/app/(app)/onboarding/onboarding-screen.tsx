"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/auth-provider";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createBusiness,
  updateBusinessSettings,
} from "@/lib/actions/businesses";
import {
  getOpeningBalances,
  saveOpeningBalances,
} from "@/lib/actions/opening-balances";
import { callApi } from "@/lib/api-client";
import type { OpeningBalance, TaxMode } from "@/lib/accounting/types";
import { fiscalPeriodBounds, fiscalPeriodOf } from "@/lib/accounting/dates";
import { getAccountOptions } from "@/lib/accounts";
import { OPENING_BALANCE_ACCOUNT_OPTIONS } from "@/lib/opening-balance-accounts";
import {
  businessSchema,
  openingBalancesSchema,
  parseForm,
  type BusinessInput,
} from "@/lib/validation/schemas";
import { formatDateJP, todayDateString } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  formIssuesMessage,
} from "@/components/ui";

const STEP_LABELS = [
  "事業情報",
  "会計年度",
  "期首残高",
  "勘定科目",
  "完了",
] as const;

const TAX_MODE_LABELS: Record<string, string> = {
  exempt: "免税事業者",
  simple: "簡易課税",
  standard: "本則課税",
};

const ACCOUNT_KIND_LABELS = {
  income: "収入の科目",
  expense: "経費の科目",
  any: "その他",
} as const;

/** 事業情報ステップで先行検証する項目(開始月は次ステップで検証) */
const businessInfoSchema = businessSchema.pick({
  name: true,
  taxMode: true,
});

const presetCodes = new Set(
  OPENING_BALANCE_ACCOUNT_OPTIONS.map((o) => o.code),
);

/**
 * 初回セットアップウィザード。
 * 事業情報 → 会計年度 → 期首残高 → 勘定科目確認 → 完了 の順に既存の
 * Server Action を呼び分けるだけのガイド。保存は各ステップの「次へ」で行う。
 */
export function OnboardingScreen() {
  useBrowserOnly();
  const router = useRouter();
  const { business, businessId, reloadBusinesses } = useApp();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // null = 未編集(既存事業の値を初期値として表示)
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [taxModeDraft, setTaxModeDraft] = useState<TaxMode | null>(null);
  const [startMonthDraft, setStartMonthDraft] = useState<string | null>(null);
  const name = nameDraft ?? business?.name ?? "";
  const taxMode = taxModeDraft ?? business?.taxMode ?? "exempt";
  const startMonthText =
    startMonthDraft ?? String(business?.fiscalYearStartMonth ?? 1);

  // ウィザード内で最後に保存した事業。新規作成後に context 反映前でも
  // 保存先を特定でき、戻る→次への再実行で二重作成しないために持つ
  const [savedBusiness, setSavedBusiness] = useState<{
    id: string;
    input: BusinessInput;
  } | null>(null);
  const effectiveBusinessId = businessId ?? savedBusiness?.id ?? null;

  const [storedBalances, setStoredBalances] = useState<
    OpeningBalance[] | null
  >(null);
  const [amountDrafts, setAmountDrafts] = useState<Record<
    string,
    string
  > | null>(null);
  const [savedBalanceCount, setSavedBalanceCount] = useState<number | null>(
    null,
  );

  const startMonthNum = Number(startMonthText);
  const validStartMonth =
    Number.isInteger(startMonthNum) &&
    startMonthNum >= 1 &&
    startMonthNum <= 12;
  const fiscalYear = validStartMonth
    ? fiscalPeriodOf(todayDateString(), startMonthNum).fiscalYear
    : null;
  const bounds =
    fiscalYear !== null
      ? fiscalPeriodBounds(fiscalYear, startMonthNum)
      : null;

  /**
   * 事業情報+開始月を保存する。既存事業は差分があるときのみ更新し、
   * 事業なしなら新規作成する。保存先のIDと開始月を返す(失敗時 null)。
   */
  const saveBusiness = async (): Promise<{
    id: string;
    startMonth: number;
  } | null> => {
    const parsed = parseForm(businessSchema, {
      name,
      fiscalYearStartMonth: startMonthNum,
      taxMode,
    });
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return null;
    }
    const id = effectiveBusinessId;
    const baseline =
      savedBusiness && savedBusiness.id === id
        ? savedBusiness.input
        : business
          ? {
              name: business.name,
              fiscalYearStartMonth: business.fiscalYearStartMonth,
              taxMode: business.taxMode,
            }
          : null;
    const unchanged =
      baseline !== null &&
      baseline.name === parsed.data.name &&
      baseline.fiscalYearStartMonth === parsed.data.fiscalYearStartMonth &&
      baseline.taxMode === parsed.data.taxMode;
    if (id !== null) {
      if (!unchanged) {
        await callApi(() => updateBusinessSettings(id, parsed.data));
        setSavedBusiness({ id, input: parsed.data });
        reloadBusinesses();
      }
      return { id, startMonth: parsed.data.fiscalYearStartMonth };
    }
    const created = await callApi(() =>
      createBusiness({ ...parsed.data, idempotencyKey: crypto.randomUUID() }),
    );
    setSavedBusiness({ id: created.id, input: parsed.data });
    reloadBusinesses();
    return { id: created.id, startMonth: parsed.data.fiscalYearStartMonth };
  };

  const toFiscalYearStep = () => {
    const parsed = parseForm(businessInfoSchema, { name, taxMode });
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    setStep(1);
  };

  /** 事業を保存してから期首残高ステップへ。プリセット科目の既存値を読み込む */
  const toBalancesStep = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await saveBusiness();
      if (!saved) return;
      const stored = await callApi(() => getOpeningBalances(saved.id));
      const fy = fiscalPeriodOf(todayDateString(), saved.startMonth)
        .fiscalYear;
      const drafts: Record<string, string> = {};
      for (const o of OPENING_BALANCE_ACCOUNT_OPTIONS) {
        const found = stored.find(
          (b) => b.fiscalYear === fy && b.accountCode === o.code,
        );
        drafts[o.code] = found ? String(found.amount) : "";
      }
      setStoredBalances(stored);
      setAmountDrafts(drafts);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 期首残高を保存する。saveOpeningBalances は配列全体を置き換えるため、
   * 当年度のプリセット科目だけ入力値で入れ替え、他のレコードは維持する。
   * 変更がなければ Server Action は呼ばない。
   */
  const saveBalances = async () => {
    if (
      effectiveBusinessId === null ||
      storedBalances === null ||
      amountDrafts === null ||
      fiscalYear === null
    ) {
      return;
    }
    const entries: OpeningBalance[] = [];
    for (const o of OPENING_BALANCE_ACCOUNT_OPTIONS) {
      const text = (amountDrafts[o.code] ?? "").trim();
      if (text === "") continue;
      const amount = Number(text);
      if (!Number.isInteger(amount)) {
        setError(`${o.label}の金額は円単位の整数で入力してください`);
        return;
      }
      entries.push({ fiscalYear, accountCode: o.code, amount });
    }
    const kept = storedBalances.filter(
      (b) => !(b.fiscalYear === fiscalYear && presetCodes.has(b.accountCode)),
    );
    const parsed = parseForm(openingBalancesSchema, [...kept, ...entries]);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    const removed = storedBalances.length - kept.length;
    if (entries.length === 0 && removed === 0) {
      setSavedBalanceCount(0);
      setError(undefined);
      setStep(3);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await callApi(() =>
        saveOpeningBalances(effectiveBusinessId, parsed.data),
      );
      setSavedBalanceCount(entries.length);
      setStep(3);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "期首残高の保存に失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  const accountOptions = getAccountOptions(business);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="セットアップウィザード"
        description="事業の初期設定を順番に行います"
      />

      {business && business.role !== "owner" ? (
        <Alert tone="warning">
          セットアップはオーナーのみ実行できます
        </Alert>
      ) : businessId !== null && !business ? (
        <LoadingBlock />
      ) : (
        <>
          <ol className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {STEP_LABELS.map((label, i) => (
              <li
                key={label}
                className={
                  i === step
                    ? "font-semibold text-indigo-600 dark:text-indigo-400"
                    : i < step
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-zinc-400 dark:text-zinc-500"
                }
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>

          {step === 0 && (
            <Card>
              <h2 className="text-sm font-semibold">事業情報</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                経理データは事業ごとに管理されます
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  toFiscalYearStep();
                }}
                noValidate
                className="mt-4 flex flex-col gap-3"
              >
                <Field label="事業名">
                  <TextInput
                    value={name}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="例: 山田太郎(個人事業)"
                    required
                  />
                </Field>
                <Field label="消費税の課税方式">
                  <Select
                    value={taxMode}
                    onChange={(e) =>
                      setTaxModeDraft(e.target.value as TaxMode)
                    }
                  >
                    <option value="exempt">免税事業者</option>
                    <option value="simple">簡易課税</option>
                    <option value="standard">本則課税</option>
                  </Select>
                </Field>
                {error && <Alert tone="error">{error}</Alert>}
                <div>
                  <Button type="submit">次へ</Button>
                </div>
              </form>
            </Card>
          )}

          {step === 1 && (
            <Card>
              <h2 className="text-sm font-semibold">会計年度の開始月</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void toBalancesStep();
                }}
                noValidate
                className="mt-4 flex flex-col gap-3"
              >
                <Field
                  label="開始月"
                  hint={
                    bounds
                      ? `当年度の期間: ${formatDateJP(bounds.startDate)} 〜 ${formatDateJP(bounds.endDate)}`
                      : "個人事業主は通常1月(暦年)"
                  }
                >
                  <NumberInput
                    className="w-32"
                    value={startMonthText}
                    min={1}
                    max={12}
                    step={1}
                    onChange={(e) => setStartMonthDraft(e.target.value)}
                    required
                  />
                </Field>
                {error && <Alert tone="error">{error}</Alert>}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setStep(0)}
                  >
                    戻る
                  </Button>
                  <Button type="submit" loading={busy}>
                    {effectiveBusinessId === null
                      ? "事業を作成して次へ"
                      : "保存して次へ"}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {step === 2 && (
            <Card>
              <h2 className="text-sm font-semibold">
                {fiscalYear}年度の期首残高
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                期首時点の資産残高を登録します。未入力の科目は登録されません
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {OPENING_BALANCE_ACCOUNT_OPTIONS.map((o) => (
                  <Field key={o.code} label={`${o.label}(円)`}>
                    <NumberInput
                      className="w-48 text-right"
                      step={1}
                      value={amountDrafts?.[o.code] ?? ""}
                      onChange={(e) =>
                        setAmountDrafts({
                          ...(amountDrafts ?? {}),
                          [o.code]: e.target.value,
                        })
                      }
                      placeholder="0"
                    />
                  </Field>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                借方残高を正・貸方残高を負の整数で入力します
              </p>
              {error && (
                <Alert tone="error" className="mt-3">
                  {error}
                </Alert>
              )}
              <div className="mt-4 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  戻る
                </Button>
                <Button onClick={() => void saveBalances()} loading={busy}>
                  保存して次へ
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setSavedBalanceCount(null);
                    setError(undefined);
                    setStep(3);
                  }}
                >
                  後で設定する
                </Button>
              </div>
            </Card>
          )}

          {step === 3 && (
            <Card>
              <h2 className="text-sm font-semibold">勘定科目の確認</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                取引の登録で使う科目一覧です。必要に応じてカスタム科目を追加できます
              </p>
              {(["income", "expense", "any"] as const).map((kind) => (
                <div key={kind} className="mt-3">
                  <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {ACCOUNT_KIND_LABELS[kind]}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {accountOptions
                      .filter((a) => a.kind === kind)
                      .map((a) => (
                        <Badge
                          key={a.code}
                          tone={a.disabled ? "gray" : "indigo"}
                        >
                          {a.label}
                        </Badge>
                      ))}
                  </div>
                </div>
              ))}
              <div className="mt-4 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(2)}
                >
                  戻る
                </Button>
                <Button onClick={() => setStep(4)}>次へ</Button>
                <Link
                  href="/accounts"
                  className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  勘定科目画面でカスタム科目を追加
                </Link>
              </div>
            </Card>
          )}

          {step === 4 && (
            <Card>
              <h2 className="text-sm font-semibold">
                セットアップが完了しました
              </h2>
              <dl className="mt-3 flex flex-col gap-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-28 text-zinc-500">事業名</dt>
                  <dd>{name}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-zinc-500">課税方式</dt>
                  <dd>{TAX_MODE_LABELS[taxMode]}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-zinc-500">年度開始月</dt>
                  <dd>{startMonthNum}月</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-zinc-500">期首残高</dt>
                  <dd>
                    {savedBalanceCount === null
                      ? "スキップ(期首残高画面で後から設定できます)"
                      : savedBalanceCount === 0
                        ? "登録なし"
                        : `${savedBalanceCount}件登録`}
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <Button onClick={() => router.push("/dashboard")}>
                  ダッシュボードへ
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
