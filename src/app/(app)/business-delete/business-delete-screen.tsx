"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/auth-provider";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { deleteBusiness } from "@/lib/actions/businesses";
import { callApi } from "@/lib/api-client";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Field,
  LoadingBlock,
  PageHeader,
  TextInput,
} from "@/components/ui";

/** 事業の完全削除画面。owner限定・事業名入力 + ConfirmDialog の二重確認 */
export function BusinessDeleteScreen() {
  useBrowserOnly();
  const { businessId, business, reloadBusinesses } = useApp();
  const router = useRouter();
  const isOwner = business?.role === "owner";

  const [confirmName, setConfirmName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const nameMatches =
    business !== undefined && confirmName === business.name;

  const doDelete = async () => {
    if (!businessId || !nameMatches) return;
    setConfirmOpen(false);
    setDeleting(true);
    setError(undefined);
    try {
      await callApi(() => deleteBusiness(businessId, confirmName));
      // 一覧を再取得させてからダッシュボードへ。選択中businessIdは
      // provider側で残存事業へフォールバックされる
      reloadBusinesses();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
      setDeleting(false);
    }
  };

  if (!business) {
    return <LoadingBlock />;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="事業の削除"
        description="事業とその全データを完全に削除します"
      />

      {!isOwner ? (
        <Alert tone="warning">
          事業の削除はオーナーのみ実行できます
        </Alert>
      ) : (
        <Card>
          <Alert tone="warning">
            <p>
              事業「{business.name}」を削除すると、取引・経費・
              領収書(画像・PDFファイルを含む)・顧客・案件・請求書・入金・
              定期取引・会計期間・決算チェック・AI提案・月次集計・
              監査ログなど、この事業のすべてのデータが完全に削除されます。
              この操作は取り消せません。
            </p>
          </Alert>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            ログインアカウント自体は削除されず残ります。
            必要なデータは事前にバックアップ画面からエクスポートしてください。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nameMatches) setConfirmOpen(true);
            }}
            noValidate
            className="mt-4 flex flex-col gap-3"
          >
            <Field
              label="確認のため事業名を入力"
              hint={`「${business.name}」と入力してください`}
            >
              <TextInput
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            {error && <Alert tone="error">{error}</Alert>}
            <div>
              <Button
                type="submit"
                variant="danger"
                disabled={!nameMatches}
                loading={deleting}
              >
                {deleting ? "削除中..." : "事業を削除する"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="事業を完全に削除しますか?"
        message={
          <>
            <p>
              事業「{business.name}」とその全データ
              (証憑ファイルを含む)を削除します。
            </p>
            <p className="mt-1">
              この操作は取り消せません。本当に実行しますか?
            </p>
          </>
        }
        confirmLabel="削除を実行"
        danger
        loading={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
