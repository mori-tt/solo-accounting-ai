"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  archiveReceiptAction,
  linkReceipt,
  listReceipts,
} from "@/lib/actions/receipts";
import {
  createTransaction,
  listTransactions,
  updateTransaction,
} from "@/lib/actions/transactions";
import {
  callApi,
  decideAiSuggestion,
  fetchAiSuggestions,
  fetchReceiptOcrAvailability,
  runAiSuggestion,
  runReceiptOcr,
} from "@/lib/api-client";
import { transactionPatchFromSuggestion } from "@/lib/ai/apply";
import {
  isUnresolvedSuggestion,
  type AISuggestionJSON,
  type ReceiptExtractionPayload,
} from "@/lib/ai/types";
import { useAccounts } from "@/lib/hooks/use-accounts";
import { formatDateTime, formatYen, todayDateString } from "@/lib/format";
import {
  parseForm,
  transactionSchema,
} from "@/lib/validation/schemas";
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
  FileInput,
  formIssuesMessage,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  Textarea,
  TextInput,
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
  suggestions,
  txSuggestions,
  ocrAvailable,
  canEdit,
  onChanged,
}: {
  receipt: Receipt;
  transactions: Transaction[];
  /** この証憑を対象とするAI提案(新しい順) */
  suggestions: AISuggestionJSON[];
  /** 紐付け先の取引を対象とするAI提案(科目提案など) */
  txSuggestions: AISuggestionJSON[];
  /** サーバーでOCRが利用可能か(未設定時はボタンを無効化して明示する) */
  ocrAvailable: boolean | undefined;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { businessId } = useApp();
  const { optionsFor, label, activeCodes } = useAccounts();
  const [linkTarget, setLinkTarget] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({
    date: todayDateString(),
    amount: "",
    account: "",
    counterparty: "",
    description: "",
  });
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrNote, setOcrNote] = useState<{
    tone: "info" | "warning";
    text: string;
  }>();
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
  const linkedTx = receipt.transactionId
    ? transactions.find((t) => t.id === receipt.transactionId)
    : undefined;

  /** 証憑宛+紐付取引宛の提案を新しい順にまとめて表示する */
  const displayedSuggestions = useMemo(() => {
    const byId = new Map<string, AISuggestionJSON>();
    for (const s of [...suggestions, ...txSuggestions]) byId.set(s.id, s);
    return [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [suggestions, txSuggestions]);

  /** OCR抽出値・採用した抽出提案を登録フォームへコピーする(保存は別操作) */
  const prefillForm = (p: {
    amount: number | null;
    date: string | null;
    vendor: string | null;
  }) => {
    setShowRegister(true);
    setForm((f) => ({
      ...f,
      date: p.date ?? f.date,
      amount: p.amount !== null ? String(p.amount) : f.amount,
      counterparty: p.vendor ?? f.counterparty,
    }));
  };

  const runOcr = async () => {
    setOcrBusy(true);
    setError(undefined);
    try {
      const r = await runReceiptOcr(businessId ?? "", receipt.id);
      prefillForm(r);
      setOcrNote(
        r.issues.length > 0
          ? {
              tone: "warning",
              text: `一部の項目を読み取れませんでした(${r.issues.join(", ")})。内容を確認して保存してください`,
            }
          : {
              tone: "info",
              text: "読み取り結果をフォームに反映しました。内容を確認して保存してください",
            },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCRに失敗しました");
    } finally {
      setOcrBusy(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(transactionSchema, {
      type: "expense",
      date: form.date,
      amount: Number(form.amount),
      account: form.account,
      counterparty: form.counterparty || undefined,
      description: form.description || undefined,
    });
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    await run(async () => {
      const tx = await callApi(() =>
        createTransaction(businessId ?? "", {
          ...parsed.data,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      await callApi(() =>
        linkReceipt(businessId ?? "", receipt.id, tx.id),
      );
      setShowRegister(false);
      setOcrNote(undefined);
    });
  };

  const acceptSuggestion = (s: AISuggestionJSON) =>
    run(async () => {
      await decideAiSuggestion(businessId ?? "", s.id, "accepted");
      if (s.kind === "receipt_extraction" && s.payload) {
        // 抽出値は登録フォームへコピー。確定はユーザーの保存操作(AI_POLICY)
        prefillForm(s.payload as ReceiptExtractionPayload);
        return;
      }
      // 取引宛の提案(科目・摘要)は確定フィールドへコピーする(ADR-0005)
      const patch = transactionPatchFromSuggestion(s);
      if (patch && linkedTx && linkedTx.status !== "locked") {
        await callApi(() =>
          updateTransaction(businessId ?? "", linkedTx.id, {
            type: linkedTx.type,
            date: linkedTx.date,
            amount: linkedTx.amount,
            account: patch.account ?? linkedTx.account,
            counterparty: linkedTx.counterparty || undefined,
            description:
              patch.description ?? (linkedTx.description || undefined),
          }),
        );
      }
    });

  const suggestAccount = () => {
    if (!linkedTx) return;
    void run(() =>
      runAiSuggestion(
        businessId ?? "",
        "account_suggestion",
        { type: "transaction", id: linkedTx.id },
        {
          counterparty: linkedTx.counterparty,
          description: linkedTx.description,
          date: linkedTx.date,
          amount: linkedTx.amount,
          accountCandidates: activeCodes,
        },
      ),
    );
  };

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
            紐付け先:{" "}
            {linkedTx
              ? `${linkedTx.date} / ${label(linkedTx.account)} / ${formatYen(linkedTx.amount)}`
              : receipt.transactionId}
          </p>
        )}
      </td>
      <td className="align-top">
        <StatusBadge kind="receipt" status={receipt.status} />
        {displayedSuggestions.some(isUnresolvedSuggestion) && (
          <span className="ml-1">
            <Badge tone="indigo">AI提案</Badge>
          </span>
        )}
      </td>
      <td className="align-top">
        <div className="flex flex-col gap-2">
          {displayedSuggestions.map((s) => (
            <div key={s.id} className="max-w-md">
              <AiSuggestionCard
                suggestion={s}
                pendingLabel={
                  s.target.type === "transaction" ? "取引" : "領収書"
                }
                busy={busy}
                acceptLabel={
                  transactionPatchFromSuggestion(s)
                    ? "提案を採用して反映"
                    : "提案を採用する"
                }
                onAccept={
                  canEdit && receipt.status !== "archived"
                    ? () => void acceptSuggestion(s)
                    : undefined
                }
                onReject={
                  canEdit && receipt.status !== "archived"
                    ? () =>
                        run(() =>
                          decideAiSuggestion(
                            businessId ?? "",
                            s.id,
                            "rejected",
                          ),
                        )
                    : undefined
                }
              />
            </div>
          ))}

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
                          {t.date} / {label(t.account)} /{" "}
                          {formatYen(t.amount)}
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowLink(true)}
                  >
                    取引に紐付ける
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowRegister((v) => !v)}
                  >
                    {showRegister ? "登録フォームを閉じる" : "領収書から登録"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void runOcr()}
                    loading={ocrBusy}
                    disabled={!ocrAvailable || busy}
                  >
                    OCRで自動入力
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setConfirmArchive(true)}
                  >
                    アーカイブ
                  </Button>
                </div>
              )}
              {ocrAvailable === false && (
                <p className="text-xs text-zinc-400">
                  OCRが未設定のため「OCRで自動入力」は利用できません(AI_OCR_PROVIDER
                  未設定)
                </p>
              )}
              {showRegister && (
                <form
                  onSubmit={submitRegister}
                  noValidate
                  className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    領収書から支出の下書き取引を登録します
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="日付">
                      <TextInput
                        type="date"
                        value={form.date}
                        onChange={(e) =>
                          setForm({ ...form, date: e.target.value })
                        }
                        required
                      />
                    </Field>
                    <Field label="金額(円)">
                      <NumberInput
                        value={form.amount}
                        min={1}
                        step={1}
                        placeholder="例: 1280"
                        onChange={(e) =>
                          setForm({ ...form, amount: e.target.value })
                        }
                        required
                      />
                    </Field>
                    <Field label="勘定科目">
                      <Select
                        value={form.account}
                        onChange={(e) =>
                          setForm({ ...form, account: e.target.value })
                        }
                        required
                      >
                        <option value="">選択してください</option>
                        {optionsFor("expense").map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="取引先">
                      <TextInput
                        value={form.counterparty}
                        onChange={(e) =>
                          setForm({ ...form, counterparty: e.target.value })
                        }
                        placeholder="例: 〇〇商店"
                      />
                    </Field>
                  </div>
                  <Field label="摘要">
                    <Textarea
                      rows={1}
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      placeholder="例: 備品購入"
                    />
                  </Field>
                  {ocrNote && <Alert tone={ocrNote.tone}>{ocrNote.text}</Alert>}
                  <div className="flex gap-2">
                    <Button type="submit" loading={busy}>
                      下書きとして登録して紐付ける
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowRegister(false)}
                    >
                      閉じる
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
          {canEdit &&
            receipt.status === "linked" &&
            linkedTx &&
            linkedTx.status !== "locked" && (
              <div>
                <Button
                  variant="secondary"
                  onClick={suggestAccount}
                  disabled={busy}
                >
                  科目をAI提案
                </Button>
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
    const [receipts, transactions, suggestions, txSuggestions, ocr] =
      await Promise.all([
        callApi(() => listReceipts(businessId ?? "")),
        callApi(() =>
          listTransactions(businessId ?? "", {
            startDate: "0001-01-01",
            endDate: "9999-12-31",
          }),
        ),
        businessId
          ? fetchAiSuggestions(businessId, { targetType: "receipt" })
          : Promise.resolve([]),
        businessId
          ? fetchAiSuggestions(businessId, { targetType: "transaction" })
          : Promise.resolve([]),
        // OCR未設定・問い合わせ失敗でも領収書機能自体は止めない
        businessId
          ? fetchReceiptOcrAvailability(businessId).catch(() => ({
              available: false,
            }))
          : Promise.resolve({ available: false }),
      ]);
    return {
      receipts,
      transactions,
      suggestions,
      txSuggestions,
      ocrAvailable: ocr.available,
    };
  }, [businessId]);

  const suggestionsByTarget = useMemo(() => {
    const map = new Map<string, AISuggestionJSON[]>();
    for (const s of data?.suggestions ?? []) {
      const list = map.get(s.target.id) ?? [];
      list.push(s);
      map.set(s.target.id, list);
    }
    return map;
  }, [data?.suggestions]);

  const txSuggestionsByTarget = useMemo(() => {
    const map = new Map<string, AISuggestionJSON[]>();
    for (const s of data?.txSuggestions ?? []) {
      const list = map.get(s.target.id) ?? [];
      list.push(s);
      map.set(s.target.id, list);
    }
    return map;
  }, [data?.txSuggestions]);

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
            noValidate
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="領収書ファイル(JPEG/PNG/WebP/PDF・10MBまで)">
              <FileInput
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
          <option value="">すべての状態</option>
          <option value="unprocessed">未処理のみ</option>
          <option value="linked">紐付済み</option>
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
            (data?.receipts.length ?? 0) > 0
              ? "条件に一致する領収書がありません"
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
                  suggestions={suggestionsByTarget.get(r.id) ?? []}
                  txSuggestions={
                    r.transactionId
                      ? (txSuggestionsByTarget.get(r.transactionId) ?? [])
                      : []
                  }
                  ocrAvailable={data?.ocrAvailable}
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
