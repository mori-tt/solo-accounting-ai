import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

const RECEIPT_FIXTURE = "e2e/fixtures/receipt.png";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("領収書をアップロードして取引に紐付ける", async ({ page }) => {
  await createTransactionDraft(page, {
    counterparty: "領収書商店",
    accountLabel: "消耗品費",
  });

  await page.goto("/receipts");
  await page
    .locator('input[type="file"]')
    .setInputFiles(RECEIPT_FIXTURE);
  await page.getByRole("button", { name: "アップロード" }).click();

  const row = page.getByRole("row", { name: /receipt\.png/ });
  await expect(row).toContainText("未処理");

  // 未処理の領収書を取引へ紐付ける(取引は1件だけ存在)
  await row.getByRole("button", { name: "取引に紐付ける" }).click();
  await page
    .getByRole("combobox", { name: "紐付ける取引" })
    .selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "紐付ける", exact: true })
    .click();

  // 既定の「未処理のみ」フィルタからは消え、紐付済みで表示される
  await expect(row).not.toBeVisible();
  await page
    .getByRole("combobox", { name: "状態で絞り込み" })
    .selectOption({ label: "紐付済み" });
  await expect(
    page.getByRole("row", { name: /receipt\.png/ }),
  ).toContainText("紐付済み");
});

test("領収書をアーカイブできる", async ({ page }) => {
  await page.goto("/receipts");
  await page
    .locator('input[type="file"]')
    .setInputFiles(RECEIPT_FIXTURE);
  await page.getByRole("button", { name: "アップロード" }).click();

  const row = page.getByRole("row", { name: /receipt\.png/ });
  await expect(row).toContainText("未処理");
  await row.getByRole("button", { name: "アーカイブ", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "領収書のアーカイブ" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "アーカイブする" }).click();

  await expect(row).not.toBeVisible();
  await page
    .getByRole("combobox", { name: "状態で絞り込み" })
    .selectOption({ label: "アーカイブ済み" });
  await expect(
    page.getByRole("row", { name: /receipt\.png/ }),
  ).toContainText("アーカイブ");
});
