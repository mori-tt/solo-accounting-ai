"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  getOpeningBalances,
  saveOpeningBalances,
} from "@/lib/actions/opening-balances";
import { callApi } from "@/lib/api-client";
import type { OpeningBalance } from "@/lib/accounting/types";
import { fiscalPeriodBounds, fiscalPeriodOf } from "@/lib/accounting/dates";
import { openingBalancesSchema, parseForm } from "@/lib/validation/schemas";
import {
  OPENING_BALANCE_ACCOUNT_OPTIONS,
  openingAccountLabel,
} from "@/lib/opening-balance-accounts";
import { formatDateJP, todayDateString } from "@/lib/format";
import {
  Alert,
  Amount,
  Button,
  Card,
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

/** プリセット外の科目コード(カスタム科目)を選ぶときの選択値 */
const CUSTOM_CODE = "__custom";

interface RowDraft {
  fiscalYear: number;
  /** プリセット科目コード。CUSTOM_CODE なら customCode を使う */
  preset: string;
  customCode: string;
  amountText: string;
}

function toDraft(b: OpeningBalance): RowDraft {
  const preset = OPENING_BALANCE_ACCOUNT_OPTIONS.some(
    (o) => o.code === b.accountCode,
  )
    ? b.accountCode
    : CUSTOM_CODE;
  return {
    fiscalYear: b.fiscalYear,
    preset,
    customCode: preset === CUSTOM_CODE ? b.accountCode : "",
    amountText: String(b.amount),
  };
}

function rowCode(row: RowDraft): string {
  return row.preset === CUSTOM_CODE ? row.customCode.trim() : row.preset;
}

/** "0.amount: メッセージ" 形式の issue を "1行目.amount: メッセージ" へ整える */
function rowIssuesMessage(issues: string[]): string {
  return issues
    .map((i) => i.replace(/^(\d+)\./, (_, n) => `${Number(n) + 1}行目.`))
    .join(" / ");
}

export function OpeningBalancesScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const isOwner = business?.role === "owner";
  const startMonth = business?.fiscalYearStartMonth ?? 1;

  const [year, setYear] = useState(
    () => fiscalPeriodOf(todayDateString(), startMonth).fiscalYear,
  );
  // null = 未編集(サーバー値をそのまま表示)。編集操作でドラフト化する
  const [drafts, setDrafts] = useState<RowDraft[] | null>(null);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const {
    data,
    initialLoading,
    error: loadError,
    reload,
  } = useApiData(
    () => callApi(() => getOpeningBalances(businessId ?? "")),
    [businessId],
  );

  const rows = drafts ?? (data ?? []).map(toDraft);
  const yearRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.fiscalYear === year);

  const updateRow = (index: number, patch: Partial<RowDraft>) => {
    setDrafts(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(false);
  };
  const addRow = () => {
    setDrafts([
      ...rows,
      {
        fiscalYear: year,
        preset: OPENING_BALANCE_ACCOUNT_OPTIONS[0].code,
        customCode: "",
        amountText: "",
      },
    ]);
    setSaved(false);
  };
  const removeRow = (index: number) => {
    setDrafts(rows.filter((_, i) => i !== index));
    setSaved(false);
  };

  const save = async () => {
    const balances: OpeningBalance[] = rows.map((r) => ({
      fiscalYear: r.fiscalYear,
      accountCode: rowCode(r),
      amount: r.amountText === "" ? NaN : Number(r.amountText),
    }));
    const parsed = parseForm(openingBalancesSchema, balances);
    if (!parsed.success) {
      setError(rowIssuesMessage(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await callApi(() => saveOpeningBalances(businessId ?? "", parsed.data));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const bounds =
    year >= 1 ? fiscalPeriodBounds(year, startMonth) : null;
  const storedRows = (data ?? []).filter((b) => b.fiscalYear === year);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="期首残高"
        description="会計年度ごとの資産科目の繰越残高を登録します。総勘定元帳の繰越行と試算表の残高に反映されます"
      />

      <div className="mb-4">
        <Field
          label="会計年度(開始年)"
          hint={
            bounds
              ? `期間: ${formatDateJP(bounds.startDate)} 〜 ${formatDateJP(bounds.endDate)}`
              : undefined
          }
        >
          <NumberInput
            className="w-32"
            value={String(year)}
            min={1900}
            max={2200}
            step={1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v)) setYear(v);
            }}
          />
        </Field>
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorState onRetry={reload} />
      ) : !isOwner ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{year}年度の期首残高</h2>
          {storedRows.length === 0 ? (
            <EmptyState
              title="期首残高は未登録です"
              description="オーナーが登録するとここに表示されます"
            />
          ) : (
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>勘定科目</th>
                  <th className="text-right">期首残高</th>
                </tr>
              </thead>
              <tbody>
                {storedRows.map((b) => (
                  <tr key={b.accountCode}>
                    <td>{openingAccountLabel(b.accountCode)}</td>
                    <td className="text-right">
                      <Amount value={b.amount} colored />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{year}年度の期首残高</h2>
          {yearRows.length === 0 ? (
            <EmptyState
              title="期首残高は未登録です"
              description="「行を追加」で科目と金額を登録できます"
            />
          ) : (
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>勘定科目</th>
                  <th className="text-right">期首残高(円)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map(({ row, index }) => (
                  <tr key={index}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Select
                          className="w-44"
                          value={row.preset}
                          onChange={(e) =>
                            updateRow(index, { preset: e.target.value })
                          }
                        >
                          {OPENING_BALANCE_ACCOUNT_OPTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.label}
                            </option>
                          ))}
                          <option value={CUSTOM_CODE}>
                            その他(コード入力)
                          </option>
                        </Select>
                        {row.preset === CUSTOM_CODE && (
                          <TextInput
                            className="w-40"
                            value={row.customCode}
                            onChange={(e) =>
                              updateRow(index, {
                                customCode: e.target.value,
                              })
                            }
                            placeholder="科目コード"
                          />
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <NumberInput
                        className="w-40 text-right"
                        value={row.amountText}
                        step={1}
                        onChange={(e) =>
                          updateRow(index, { amountText: e.target.value })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => removeRow(index)}
                        aria-label="行を削除"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="mt-2 text-xs text-zinc-400">
            金額は借方残高を正・貸方残高を負の整数で入力します。締め済み年度の期首残高は変更できません
          </p>
          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}
          {saved && (
            <Alert tone="info" className="mt-3">
              保存しました
            </Alert>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button variant="secondary" onClick={addRow}>
              行を追加
            </Button>
            <Button onClick={() => void save()} loading={busy}>
              保存する
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
