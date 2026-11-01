"use client";

import { useState } from "react";
import { createTransaction } from "@/lib/actions/transactions";
import { callApi } from "@/lib/api-client";
import { useAccounts } from "@/lib/hooks/use-accounts";
import {
  decodeCsvBytes,
  parseTransactionsCsv,
  TRANSACTION_CSV_HEADER,
  type CsvEncoding,
  type TransactionCsvRow,
} from "@/lib/csv";
import type { TransactionInput } from "@/lib/validation/schemas";
import { Alert, Button, Card, FileInput, tableClass } from "@/components/ui";

type RowStatus = "pending" | "imported" | "failed";

interface ImportRow extends TransactionCsvRow {
  /** 行ごとの冪等キー。再試行で重複登録しないよう確定させておく */
  idempotencyKey: string;
  status: RowStatus;
  serverError?: string;
}

const ENCODING_LABEL: Record<CsvEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16",
  "utf-16be": "UTF-16",
  shift_jis: "Shift_JIS",
};

/** CSVファイル選択→プレビュー→一括登録の取込パネル(editor以上のみ表示) */
export function TransactionCsvImport({
  businessId,
  onImported,
  onClose,
}: {
  businessId: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const { options } = useAccounts();
  const [fileLabel, setFileLabel] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const loadFile = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { text, encoding } = decodeCsvBytes(bytes);
      const result = parseTransactionsCsv(text, options);
      setFileLabel(
        encoding === "utf-8"
          ? file.name
          : `${file.name}(${ENCODING_LABEL[encoding]}として読込)`,
      );
      setFileError(result.fileError);
      setRows(
        result.rows.map((r) => ({
          ...r,
          idempotencyKey: crypto.randomUUID(),
          status: "pending" as const,
        })),
      );
    } catch {
      setFileLabel(file.name);
      setFileError("ファイルの読み込みに失敗しました");
      setRows([]);
    }
  };

  const updateRow = (rowNumber: number, patch: Partial<ImportRow>) =>
    setRows((current) =>
      current.map((r) =>
        r.rowNumber === rowNumber ? { ...r, ...patch } : r,
      ),
    );

  const registrableCount = rows.filter(
    (r) => r.input !== undefined && r.status !== "imported",
  ).length;

  const register = async () => {
    const targets = rows.filter(
      (r): r is ImportRow & { input: TransactionInput } =>
        r.input !== undefined && r.status !== "imported",
    );
    if (targets.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: targets.length });
    let succeeded = 0;
    for (const row of targets) {
      try {
        await callApi(() =>
          createTransaction(businessId, {
            ...row.input,
            idempotencyKey: row.idempotencyKey,
          }),
        );
        succeeded++;
        updateRow(row.rowNumber, { status: "imported", serverError: undefined });
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
    if (succeeded > 0) onImported();
  };

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  const importedCount = rows.filter((r) => r.status === "imported").length;

  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">CSV取込</h2>
        <Button variant="ghost" onClick={onClose} disabled={importing}>
          閉じる
        </Button>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {TRANSACTION_CSV_HEADER.join("・")}{" "}
        の列を持つCSVを選択してください。取込はすべて下書きとして登録され、状態・科目名の列は無視されます。
      </p>
      <div className="mt-3">
        <FileInput
          accept=".csv,text/csv"
          disabled={importing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
          }}
        />
      </div>
      {fileLabel && (
        <p className="mt-2 text-xs text-zinc-500">{fileLabel}</p>
      )}
      {fileError && (
        <Alert tone="error" className="mt-2">
          {fileError}
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            全{rows.length}行: 登録可 {registrableCount}件 / エラー {errorCount}件
            {importedCount > 0 && ` / 登録済み ${importedCount}件`}
          </p>
          <div className="mt-1 max-h-80 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>行</th>
                  <th>日付</th>
                  <th>種別</th>
                  <th>科目コード</th>
                  <th>取引先</th>
                  <th>摘要</th>
                  <th className="text-right">金額</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="whitespace-nowrap">{r.rowNumber}</td>
                    <td className="whitespace-nowrap">{r.values.date}</td>
                    <td className="whitespace-nowrap">{r.values.type}</td>
                    <td className="whitespace-nowrap">
                      {r.values.accountCode}
                    </td>
                    <td className="max-w-28 truncate">
                      {r.values.counterparty}
                    </td>
                    <td className="max-w-28 truncate">
                      {r.values.description}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {r.values.amount}
                    </td>
                    <td>
                      {r.status === "imported" ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          登録済み
                        </span>
                      ) : r.errors.length > 0 ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {r.errors.join(" / ")}
                        </span>
                      ) : r.status === "failed" ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {r.serverError}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">登録可</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => void register()}
              loading={importing}
              disabled={registrableCount === 0}
            >
              {importing
                ? `登録中 ${progress.done}/${progress.total}`
                : `${registrableCount}件を登録`}
            </Button>
            {errorCount > 0 && (
              <span className="text-xs text-zinc-500">
                エラー行は除外して登録されます
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
