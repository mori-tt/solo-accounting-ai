"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { restoreBackup } from "@/lib/api-client";
import {
  backupFileSchema,
  summarizeBackup,
  type ParsedBackupFile,
  type RestoreSummary,
} from "@/lib/backup";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  FileInput,
  PageHeader,
  tableClass,
} from "@/components/ui";

/** プレビュー表示用のコレクション日本語ラベル */
const COLLECTION_LABELS: Record<string, string> = {
  members: "メンバー",
  customers: "顧客",
  projects: "案件",
  transactions: "取引",
  expenses: "経費",
  receipts: "領収書(メタデータ)",
  invoices: "請求書",
  payments: "入金",
  journalEntries: "仕訳",
  fiscalPeriods: "会計期間",
  closingChecks: "決算チェック",
  aiSuggestions: "AI提案",
  monthlySummaries: "月次集計",
  auditLogs: "監査ログ",
};

interface LoadedBackup {
  fileName: string;
  data: ParsedBackupFile;
}

async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? "通信に失敗しました";
}

/** バックアップのエクスポート/復元画面。エクスポートはeditor以上、復元はownerのみ */
export function BackupScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canExport = business?.role === "owner" || business?.role === "editor";
  const canRestore = business?.role === "owner";

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();

  const [fileName, setFileName] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [loaded, setLoaded] = useState<LoadedBackup>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();
  const [restoreResult, setRestoreResult] = useState<RestoreSummary>();

  const download = async () => {
    if (!businessId) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const res = await fetch(
        `/api/backup?businessId=${encodeURIComponent(businessId)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${businessId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(
        e instanceof Error ? e.message : "エクスポートに失敗しました",
      );
    } finally {
      setDownloading(false);
    }
  };

  const loadFile = async (file: File) => {
    setFileName(file.name);
    setFileError(undefined);
    setLoaded(undefined);
    setRestoreResult(undefined);
    setRestoreError(undefined);
    try {
      const json: unknown = JSON.parse(await file.text());
      const parsed = backupFileSchema.safeParse(json);
      if (!parsed.success) {
        setFileError(
          "バックアップファイルの構造が不正です(version/コレクション形式を確認してください)",
        );
        return;
      }
      setLoaded({ fileName: file.name, data: parsed.data });
    } catch {
      setFileError("JSONファイルとして読み込めませんでした");
    }
  };

  const restore = async () => {
    if (!businessId || !loaded) return;
    setConfirmOpen(false);
    setRestoring(true);
    setRestoreError(undefined);
    setRestoreResult(undefined);
    try {
      setRestoreResult(await restoreBackup(businessId, loaded.data));
    } catch (e) {
      setRestoreError(
        e instanceof Error ? e.message : "復元に失敗しました",
      );
    } finally {
      setRestoring(false);
    }
  };

  const preview = loaded ? summarizeBackup(loaded.data) : [];
  const previewTotal = preview.reduce((sum, e) => sum + e.count, 0);
  const resultRows = restoreResult
    ? Object.entries(restoreResult.counts).filter(
        ([, c]) => c.written > 0 || c.skipped > 0,
      )
    : [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="バックアップ / 復元"
        description="事業の全データをJSONファイルとしてエクスポート・復元します"
      />

      <Card>
        <h2 className="text-sm font-semibold">エクスポート</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          取引・経費・証憑メタデータ・顧客・請求・決算・AI提案・監査ログなど、
          この事業の全コレクションを1つのJSONファイルでダウンロードします。
          証憑のファイル本体(画像・PDF)は含まれません。
        </p>
        {canExport ? (
          <div className="mt-3">
            <Button onClick={() => void download()} loading={downloading}>
              バックアップをダウンロード
            </Button>
            {downloadError && (
              <Alert tone="error" className="mt-2">
                {downloadError}
              </Alert>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            エクスポートはeditor以上のロールが必要です
          </p>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold">復元</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          バックアップJSONを選択すると内容を検証して件数を表示します。
          復元は現在の事業へマージされ、既存データは削除されません。
          ドキュメントIDが既存データと衝突した場合は新規IDが採番され、
          取引・証憑・請求などの参照も新しいIDへ張り替えられます。
          別の事業からエクスポートしたファイルも取り込めます。
        </p>
        {canRestore ? (
          <>
            <div className="mt-3">
              <FileInput
                accept=".json,application/json"
                disabled={restoring}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
            </div>
            {fileError && (
              <Alert tone="error" className="mt-2">
                {fileName}: {fileError}
              </Alert>
            )}

            {loaded && (
              <>
                <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                  {loaded.fileName} — エクスポート元{" "}
                  {loaded.data.businessId === businessId
                    ? "この事業"
                    : `別の事業(${loaded.data.businessId})`}
                  {" / "}エクスポート日時 {loaded.data.exportedAt}
                </p>
                <div className="mt-1 max-h-80 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>コレクション</th>
                        <th className="text-right">件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((e) => (
                        <tr key={e.name}>
                          <td>{COLLECTION_LABELS[e.name] ?? e.name}</td>
                          <td className="whitespace-nowrap text-right tabular-nums">
                            {e.count}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="font-medium">合計</td>
                        <td className="whitespace-nowrap text-right font-medium tabular-nums">
                          {previewTotal}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    variant="danger"
                    onClick={() => setConfirmOpen(true)}
                    loading={restoring}
                    disabled={previewTotal === 0}
                  >
                    {restoring ? "復元中..." : "この内容で復元する"}
                  </Button>
                  <span className="text-xs text-zinc-500">
                    既存データは削除されず、衝突したIDのみ新規採番されます
                  </span>
                </div>
              </>
            )}

            {restoreError && (
              <Alert tone="error" className="mt-3">
                {restoreError}
              </Alert>
            )}
            {restoreResult && (
              <Alert tone="info" className="mt-3">
                <p>
                  復元が完了しました
                  {restoreResult.remappedCount > 0 &&
                    `(ID衝突のため ${restoreResult.remappedCount}件に新規IDを採番)`}
                </p>
                <ul className="mt-1 list-inside list-disc text-xs">
                  {resultRows.map(([name, c]) => (
                    <li key={name}>
                      {COLLECTION_LABELS[name] ?? name}: {c.written}件を復元
                      {c.skipped > 0 && ` / ${c.skipped}件をスキップ`}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            復元はownerのみ実行できます
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="バックアップを復元しますか?"
        message={
          <>
            <p>
              {loaded?.fileName} の内容(全{previewTotal}
              件)をこの事業へ書き込みます。
            </p>
            <p className="mt-1">
              既存データは削除されませんが、同じIDが存在する固定キー
              (メンバー・会計期間・月次集計)は既存が維持されます。
            </p>
          </>
        }
        confirmLabel="復元を実行"
        danger
        loading={restoring}
        onConfirm={() => void restore()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
