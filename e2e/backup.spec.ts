import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("エクスポートしたJSONを検証プレビュー経由で復元できる", async ({
  page,
}) => {
  await createTransactionDraft(page);

  await page.goto("/backup");

  // エクスポート → backup-*.json がダウンロードされる
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "バックアップをダウンロード" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^backup-.*\.json$/);
  const path = await download.path();

  // ダウンロードしたJSONをそのまま復元ファイルとして選択
  await page.locator("input[type=file]").setInputFiles(path!);
  // プレビューにコレクション別件数が出る(取引1件を含む)
  const txPreviewRow = page.getByRole("row", { name: /^取引/ });
  await expect(txPreviewRow).toContainText("1");

  const restoreButton = page.getByRole("button", {
    name: "この内容で復元する",
  });
  await expect(restoreButton).toBeEnabled();
  await restoreButton.click();
  await page
    .getByRole("dialog", { name: "バックアップを復元しますか?" })
    .getByRole("button", { name: "復元を実行" })
    .click();
  await expect(page.getByText("復元が完了しました")).toBeVisible();
});

test("不正なJSONを選ぶと検証エラーが出る", async ({ page }) => {
  await page.goto("/backup");
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"not":"a backup"}', "utf-8"),
  });
  await expect(
    page.getByText(/バックアップファイルの構造が不正です/),
  ).toBeVisible();
});
