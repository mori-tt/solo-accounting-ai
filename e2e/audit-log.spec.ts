import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("取引の登録が監査ログに記録され対象種別で絞り込める", async ({
  page,
}) => {
  await createTransactionDraft(page);

  await page.goto("/audit-log");
  await expect(
    page.getByRole("heading", { name: "監査ログ" }),
  ).toBeVisible();

  // 対象種別=取引 で絞り込み → 取引の登録ログが見える
  await page
    .getByRole("combobox", { name: "対象種別で絞り込み" })
    .selectOption({ label: "取引" });
  const row = page
    .getByRole("row", { name: /取引を登録/ })
    .first();
  await expect(row).toContainText("登録");
  await expect(row).toContainText("取引");

  // 件数表示が「N件 / 全M件」形式で出る
  await expect(page.getByText(/件 \/ 全\d+件/)).toBeVisible();
});
