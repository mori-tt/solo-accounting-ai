"use client";

import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createTransaction,
  listTransactions,
} from "@/lib/actions/transactions";
import { callApi } from "@/lib/api-client";
import type { TransactionType } from "@/lib/accounting/types";
import {
  findExistingMatches,
  findInFileDuplicatePartners,
  parseBankCsv,
  shiftDate,
  type BankCsvRow,
  type ExistingMatch,
  type ExistingTransactionRef,
} from "@/lib/bank-csv";
import { decodeCsvBytes, type CsvEncoding } from "@/lib/csv";
import { accountOptionsFor } from "@/lib/accounts";
import type { TransactionInput } from "@/lib/validation/schemas";
import {
  Alert,
  Amount,
  Badge,
  Button,
  Card,
  EmptyState,
  FileInput,
  PageHeader,
  Select,
  tableClass,
} from "@/components/ui";

type RowStatus = "idle" | "imported" | "failed";

interface ImportRow {
  rowNumber: number;
  row: BankCsvRow;
  selected: boolean;
  type: TransactionType;
  account: string;
  /** 既定科目の変更に追従するか(行を個別編集するとfalse) */
  accountAuto: boolean;
  status: RowStatus;
  serverError?: string;
  /** 行ごとの冪等キー。再試行で重複登録しないよう確定させておく */
  idempotencyKey: string;
  /** 同金額・近日付の既存取引(重複可能性) */
  matches: ExistingMatch[];
  /** 同一CSV内の重複候補の行番号 */
  dupPartners: number[];
}

const ENCODING_LABEL: Record<CsvEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16",
  "utf-16be": "UTF-16",
  shift_jis: "Shift_JIS",
};

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: "expense", label: "支出" },
  { value: "income", label: "収入" },
  { value: "transfer", label: "振替" },
];

/** 行typeごとの既定科目(取込時・type変更時の初期値) */
const TYPE_DEFAULT_ACCOUNT: Record<TransactionType, string> = {
  expense: "misc_expense",
  income: "misc_income",
  transfer: "transfer",
};

/** 既存取引との重複判定で許容する日付差(±N日) */
const MATCH_DAY_DIFF = 3;

const linkClass =
  "text-indigo-600 hover:underline dark:text-indigo-400";

/** 銀行/カード明細CSV → 候補一覧 → 選択して一括登録(editor以上のみ) */
export function BankImportScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [fileLabel, setFileLabel] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [columnMode, setColumnMode] = useState<"split" | "single">();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [matchWarning, setMatchWarning] = useState<string>();
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [importFinished, setImportFinished] = useState(false);
  const [defaultAccounts, setDefaultAccounts] = useState<
    Record<"income" | "expense", string>
  >({ expense: "misc_expense", income: "misc_income" });

  const loadFile = async (file: File) => {
    setImportFinished(false);
    setMatchWarning(undefined);
    setLoadingFile(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { text, encoding } = decodeCsvBytes(bytes);
      const result = parseBankCsv(text);
      setFileLabel(
        encoding === "utf-8"
          ? file.name
          : `${file.name}(${ENCODING_LABEL[encoding]}として読込)`,
      );
      setFileError(result.fileError);
      setColumnMode(result.columnMode);

      // 既存取引との照合は候補の日付範囲±N日分を取得する
      const candidates = result.rows
        .map((r) => r.candidate)
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      let existing: ExistingTransactionRef[] = [];
      if (candidates.length > 0 && businessId) {
        const dates = candidates.map((c) => c.date).sort();
        const range = {
          startDate: shiftDate(dates[0], -MATCH_DAY_DIFF),
          endDate: shiftDate(dates[dates.length - 1], MATCH_DAY_DIFF),
        };
        try {
          const txs = await callApi(() =>
            listTransactions(businessId, range),
          );
          existing = txs.map((t) => ({
            id: t.id,
            date: t.date,
            amount: t.amount,
          }));
        } catch {
          setMatchWarning(
            "既存取引の取得に失敗したため、重複チェックはファイル内のみです",
          );
        }
      }

      const dupMap = findInFileDuplicatePartners(result.rows);
      setRows(
        result.rows.map((r) => {
          const matches = r.candidate
            ? findExistingMatches(r.candidate, existing, MATCH_DAY_DIFF)
            : [];
          const dupPartners = dupMap.get(r.rowNumber) ?? [];
          const flagged = matches.length > 0 || dupPartners.length > 0;
          const type: TransactionType = r.candidate?.type ?? "expense";
          return {
            rowNumber: r.rowNumber,
            row: r,
            // 重複可能性のある行は誤登録防止のため選択外にしておく
            selected: r.candidate !== undefined && !flagged,
            type,
            account: TYPE_DEFAULT_ACCOUNT[type],
            accountAuto: true,
            status: "idle" as const,
            idempotencyKey: crypto.randomUUID(),
            matches,
            dupPartners,
          };
        }),
      );
    } catch {
      setFileLabel(file.name);
      setFileError("ファイルの読み込みに失敗しました");
      setColumnMode(undefined);
      setRows([]);
    } finally {
      setLoadingFile(false);
    }
  };

  const updateRow = (rowNumber: number, patch: Partial<ImportRow>) =>
    setRows((current) =>
      current.map((r) =>
        r.rowNumber === rowNumber ? { ...r, ...patch } : r,
      ),
    );

  const defaultAccountFor = (type: TransactionType) =>
    type === "transfer" ? "transfer" : defaultAccounts[type];

  const changeDefaultAccount = (kind: "income" | "expense", code: string) => {
    setDefaultAccounts((d) => ({ ...d, [kind]: code }));
    setRows((current) =>
      current.map((r) =>
        r.accountAuto && r.type === kind ? { ...r, account: code } : r,
      ),
    );
  };

  // 登録対象 = 候補化できていて選択中・科目が選ばれている行
  const registrable = rows.filter(
    (r) =>
      r.selected &&
      r.row.candidate !== undefined &&
      r.account !== "" &&
      r.status !== "imported",
  );
  const selectable = rows.filter(
    (r) => r.row.candidate !== undefined && r.status !== "imported",
  );
  const allSelected =
    selectable.length > 0 && selectable.every((r) => r.selected);

  const toggleAll = (checked: boolean) =>
    setRows((current) =>
      current.map((r) =>
        r.row.candidate !== undefined && r.status !== "imported"
          ? { ...r, selected: checked }
          : r,
      ),
    );

  const register = async () => {
    if (registrable.length === 0 || !businessId) return;
    setImporting(true);
    setProgress({ done: 0, total: registrable.length });
    let succeeded = 0;
    for (const row of registrable) {
      const c = row.row.candidate as NonNullable<
        BankCsvRow["candidate"]
      >;
      const input: TransactionInput = {
        type: row.type,
        date: c.date,
        amount: c.amount,
        account: row.account,
        description: c.description || undefined,
      };
      try {
        await callApi(() =>
          createTransaction(businessId, {
            ...input,
            idempotencyKey: row.idempotencyKey,
          }),
        );
        succeeded++;
        updateRow(row.rowNumber, {
          status: "imported",
          serverError: undefined,
          selected: false,
        });
      } catch (e) {
        updateRow(row.rowNumber, {
          status: "failed",
          serverError: e instanceof Error ? e.message : "登録に失敗しました",
        });
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }
    setImporting(false);
    if (succeeded > 0) setImportFinished(true);
  };

  const counts = {
    candidates: rows.filter((r) => r.row.candidate !== undefined).length,
    flagged: rows.filter(
      (r) => r.matches.length > 0 || r.dupPartners.length > 0,
    ).length,
    errors: rows.filter((r) => r.row.errors.length > 0).length,
    skipped: rows.filter((r) => r.row.skippedReason !== undefined).length,
    imported: rows.filter((r) => r.status === "imported").length,
  };

  if (business && !canEdit) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="明細CSVインポート" />
        <EmptyState
          title="この機能は編集権限のあるユーザーのみ利用できます"
          description="閲覧専用(viewer)ユーザーは明細の取込を行えません"
          action={
            <Link href="/transactions" className={linkClass}>
              取引一覧へ戻る
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="明細CSVインポート"
        description="銀行・カードの明細CSV(日付/摘要/出金額/入金額/残高)から取引を一括登録します。すべて下書きとして登録されます"
        actions={
          <Link href="/transactions" className={linkClass}>
            取引一覧へ戻る
          </Link>
        }
      />

      <Card className="mb-4">
        <h2 className="text-sm font-semibold">CSVファイルを選択</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          日付・摘要・金額(出金額/入金額または金額)の列名を持つヘッダー行を自動認識します。
          出金は支出・入金は収入として推定し、行ごとに変更できます。
        </p>
        <div className="mt-3">
          <FileInput
            accept=".csv,text/csv"
            disabled={importing || loadingFile}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
            }}
          />
        </div>
        {fileLabel && (
          <p className="mt-2 text-xs text-zinc-500">{fileLabel}</p>
        )}
        {columnMode && (
          <p className="mt-1 text-xs text-zinc-400">
            {columnMode === "split"
              ? "出金/入金の別列を検出しました"
              : "単一の金額列を検出しました(全行を支出として取り込みます)"}
          </p>
        )}
        {fileError && (
          <Alert tone="error" className="mt-2">
            {fileError}
          </Alert>
        )}
        {matchWarning && (
          <Alert tone="warning" className="mt-2">
            {matchWarning}
          </Alert>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="mb-4 overflow-x-auto p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              全{rows.length}行: 候補 {counts.candidates}件(選択{" "}
              {registrable.length}件) / 重複の可能性 {counts.flagged}件 /
              エラー {counts.errors}件 / 対象外 {counts.skipped}件
              {counts.imported > 0 && ` / 登録済み ${counts.imported}件`}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
              <label className="text-zinc-500">支出の既定科目</label>
              <Select
                className="w-36"
                value={defaultAccounts.expense}
                onChange={(e) =>
                  changeDefaultAccount("expense", e.target.value)
                }
                disabled={importing}
              >
                {accountOptionsFor("expense").map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </Select>
              <label className="text-zinc-500">収入の既定科目</label>
              <Select
                className="w-36"
                value={defaultAccounts.income}
                onChange={(e) =>
                  changeDefaultAccount("income", e.target.value)
                }
                disabled={importing}
              >
                {accountOptionsFor("income").map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <table className={tableClass}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    disabled={selectable.length === 0 || importing}
                    aria-label="すべて選択"
                  />
                </th>
                <th>行</th>
                <th>日付</th>
                <th>摘要</th>
                <th>種別(推定)</th>
                <th className="text-right">金額</th>
                <th>勘定科目</th>
                <th>マッチング</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = r.row.candidate;
                const disabled = c === undefined || r.status === "imported";
                const accountValid = accountOptionsFor(r.type).some(
                  (a) => a.code === r.account,
                );
                return (
                  <tr key={r.rowNumber}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) =>
                          updateRow(r.rowNumber, {
                            selected: e.target.checked,
                          })
                        }
                        disabled={disabled || importing}
                        aria-label={`${r.rowNumber}行目を選択`}
                      />
                    </td>
                    <td className="whitespace-nowrap">{r.rowNumber}</td>
                    <td className="whitespace-nowrap">
                      {c?.date ?? r.row.values.date}
                    </td>
                    <td className="max-w-48 truncate">
                      {r.row.values.description}
                    </td>
                    <td>
                      {c ? (
                        <Select
                          className="w-24"
                          value={r.type}
                          onChange={(e) => {
                            const type = e.target.value as TransactionType;
                            updateRow(r.rowNumber, {
                              type,
                              account: defaultAccountFor(type),
                              accountAuto: true,
                            });
                          }}
                          disabled={r.status === "imported" || importing}
                          aria-label={`${r.rowNumber}行目の種別`}
                        >
                          {TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {c ? <Amount value={c.amount} /> : "—"}
                    </td>
                    <td>
                      {c ? (
                        <Select
                          className="w-40"
                          value={r.account}
                          onChange={(e) =>
                            updateRow(r.rowNumber, {
                              account: e.target.value,
                              accountAuto: false,
                            })
                          }
                          disabled={r.status === "imported" || importing}
                          aria-label={`${r.rowNumber}行目の勘定科目`}
                          aria-invalid={r.account === "" || !accountValid}
                        >
                          <option value="">選択してください</option>
                          {accountOptionsFor(r.type).map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.label}
                            </option>
                          ))}
                          {r.account !== "" &&
                            !accountValid && (
                              <option value={r.account}>{r.account}</option>
                            )}
                        </Select>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        {r.matches.length > 0 && (
                          <span title={r.matches
                            .map(
                              (m) =>
                                `${m.transaction.date} ¥${m.transaction.amount.toLocaleString()}`,
                            )
                            .join(" / ")}
                          >
                            <Badge tone="amber">
                              重複の可能性(既存{r.matches.length}件)
                            </Badge>
                          </span>
                        )}
                        {r.dupPartners.length > 0 && (
                          <Badge tone="sky">
                            ファイル内重複({r.dupPartners.join("・")}行目)
                          </Badge>
                        )}
                        {r.matches.length === 0 &&
                          r.dupPartners.length === 0 &&
                          c && <span className="text-xs text-zinc-300">—</span>}
                      </div>
                    </td>
                    <td>
                      {r.status === "imported" ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          登録済み
                        </span>
                      ) : r.status === "failed" ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {r.serverError}
                        </span>
                      ) : r.row.errors.length > 0 ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {r.row.errors.join(" / ")}
                        </span>
                      ) : r.row.skippedReason ? (
                        <span className="text-xs text-zinc-400">
                          対象外: {r.row.skippedReason}
                        </span>
                      ) : r.account === "" ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          科目を選択してください
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">登録可</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button
              onClick={() => void register()}
              loading={importing}
              disabled={registrable.length === 0}
            >
              {importing
                ? `登録中 ${progress.done}/${progress.total}`
                : `選択中の${registrable.length}件を登録`}
            </Button>
            <span className="text-xs text-zinc-500">
              重複の可能性がある行は選択外になっています。登録する場合は個別に選択してください
            </span>
          </div>
          {importFinished && (
            <div className="px-4 pb-3">
              <Alert tone="info">
                登録が完了しました。下書きとして登録されているため、{" "}
                <Link href="/transactions" className="underline">
                  取引一覧
                </Link>{" "}
                で内容を確認して確定してください
              </Alert>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
