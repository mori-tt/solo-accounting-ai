"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  archiveReceiptAction,
  decideReceiptSuggestionAction,
  linkReceipt,
  listReceipts,
} from "@/lib/actions/receipts";
import { listTransactions } from "@/lib/actions/transactions";
import { callApi } from "@/lib/api-client";
import { accountLabel } from "@/lib/accounts";
import { formatDateTime } from "@/lib/format";
import type { Receipt, ReceiptStatus, Transaction } from "@/lib/accounting/types";
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
  PageHeader,
  Select,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { AiSuggestionCard } from "@/components/ai-suggestion-card";

function ReceiptImage({ receipt }: { receipt: Receipt }) {
  const { businessId } = useApp();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-24 w-32 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
        画像なし
      </div>
    );
  }
  return (
    // ルートハンドラ経由でStorageから取得する(画面にStorage SDKを置かない)
    <img
      src={`/api/receipts/${receipt.id}?businessId=${encodeURIComponent(businessId ?? "")}`}
      alt="領収書画像"
      className="h-24 w-32 rounded object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function ReceiptRow({
  receipt,
  transactions,
  canEdit,
  onChanged,
}: {
  receipt: Receipt;
  transactions: Transaction[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { businessId } = useApp();
  const [linkTarget, setLinkTarget] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const linkable = transactions.filter((t) => t.status !== "locked");

  return (
    <tr>
      <td>
        <ReceiptImage receipt={receipt} />
      </td>
      <td className="align-top">
        <p className="text-sm">{receipt.fileName}</p>
        <p className="text-xs text-zinc-400">
          アップロード: {formatDateTime(receipt.createdAt)}
        </p>
        {receipt.status === "linked" && receipt.transactionId && (
          <p className="mt-1 text-xs text-zinc-500">
            紐付け先: {receipt.transactionId}
          </p>
        )}
      </td>
      <td className="align-top">
        <StatusBadge kind="receipt" status={receipt.status} />
        {receipt.aiSuggestion?.status === "pending" && (
          <span className="ml-1">
            <Badge tone="indigo">AI提案</Badge>
          </span>
        )}
      </td>
      <td className="align-top">
        <div className="flex flex-col gap-2">
          {receipt.aiSuggestion && (
            <div className="max-w-md">
              <AiSuggestionCard
                suggestion={receipt.aiSuggestion}
                busy={busy}
                onApprove={
                  canEdit && receipt.status !== "archived"
                    ? () =>
                        run(() =>
                          callApi(() =>
                            decideReceiptSuggestionAction(
                              businessId ?? "",
                              receipt.id,
                              "approved",
                            ),
                          ),
                        )
                    : undefined
                }
                onReject={
                  canEdit && receipt.status !== "archived"
                    ? () =>
                        run(() =>
                          callApi(() =>
                            decideReceiptSuggestionAction(
                              businessId ?? "",
                              receipt.id,
                              "rejected",
                            ),
                          ),
                        )
                    : undefined
                }
              />
            </div>
          )}

          {canEdit && receipt.status === "unprocessed" && (
            <div className="flex flex-col gap-2">
              {showLink ? (
                <div className="flex items-end gap-2">
                  <Field label="紐付ける取引">
                    <Select
                      className="w-72"
                      value={linkTarget}
                      onChange={(e) => setLinkTarget(e.target.value)}
                    >
                      <option value="">選択してください</option>
                      {linkable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.date} / {accountLabel(t.account)} /{" "}
                          {t.amount.toLocaleString("ja-JP")}円
                          {t.counterparty ? ` / ${t.counterparty}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    disabled={!linkTarget}
                    loading={busy}
                    onClick={() =>
                      run(async () => {
                        await callApi(() =>
                          linkReceipt(
                            businessId ?? "",
                            receipt.id,
                            linkTarget,
                          ),
                        );
                        setShowLink(false);
                      })
                    }
                  >
                    紐付ける
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowLink(false)}
                  >
                    キャンセル
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowLink(true)}
                  >
                    取引に紐付ける
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setConfirmArchive(true)}
                  >
                    アーカイブ
                  </Button>
                </div>
              )}
            </div>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
        <ConfirmDialog
          open={confirmArchive}
          title="領収書のアーカイブ"
          message={`「${receipt.fileName}」をアーカイブします。一覧の未処理対象から外れます。`}
          confirmLabel="アーカイブする"
          loading={busy}
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => {
            setConfirmArchive(false);
            void run(() =>
              callApi(() =>
                archiveReceiptAction(businessId ?? "", receipt.id),
              ),
            );
          }}
        />
      </td>
    </tr>
  );
}

export function ReceiptsScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [statusFilter, setStatusFilter] = useState("unprocessed");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [file, setFile] = useState<File | null>(null);

  const { data, initialLoading, error, reload } = useApiData(async () => {
    const [receipts, transactions] = await Promise.all([
      callApi(() => listReceipts(businessId ?? "")),
      callApi(() =>
        listTransactions(businessId ?? "", {
          startDate: "0001-01-01",
          endDate: "9999-12-31",
        }),
      ),
    ]);
    return { receipts, transactions };
  }, [businessId]);

  const filtered = useMemo(
    () =>
      (data?.receipts ?? []).filter(
        (r) => statusFilter === "" || r.status === (statusFilter as ReceiptStatus),
      ),
    [data, statusFilter],
  );

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !businessId) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("ファイルサイズは10MB以下にしてください");
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.type,
      )
    ) {
      setUploadError("JPEG/PNG/WebP/PDF形式のファイルを選択してください");
      return;
    }
    setUploadBusy(true);
    setUploadError(undefined);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("businessId", businessId);
      body.set("idempotencyKey", crypto.randomUUID());
      const res = await fetch("/api/receipts", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        throw new Error(json.error?.message ?? "アップロードに失敗しました");
      }
      setFile(null);
      reload();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "アップロードに失敗しました",
      );
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="領収書確認"
        description="アップロードした領収書を確認し、取引に紐付けます"
      />

      {canEdit && (
        <Card className="mb-6">
          <form
            onSubmit={upload}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="領収書ファイル(JPEG/PNG/WebP/PDF・10MBまで)">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
                required
              />
            </Field>
            <Button type="submit" disabled={!file} loading={uploadBusy}>
              アップロード
            </Button>
          </form>
          {uploadError && (
            <Alert tone="error" className="mt-3">
              {uploadError}
            </Alert>
          )}
        </Card>
      )}

      <div className="mb-4">
        <Select
          className="w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="状態で絞り込み"
        >
          <option value="">すべて</option>
          <option value="unprocessed">未処理のみ</option>
          <option value="linked">紐付け済み</option>
          <option value="archived">アーカイブ済み</option>
        </Select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            statusFilter === "unprocessed"
              ? "未処理の領収書はありません"
              : "領収書がまだありません"
          }
          description={
            canEdit
              ? "領収書をアップロードするとここに表示されます"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>画像</th>
                <th>ファイル / メタ情報</th>
                <th>状態</th>
                <th>AI提案・操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <ReceiptRow
                  key={r.id}
                  receipt={r}
                  transactions={data?.transactions ?? []}
                  canEdit={canEdit}
                  onChanged={reload}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
