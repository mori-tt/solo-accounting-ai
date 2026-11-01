import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("データがない事業では要対応なし・空の最近の取引が表示される", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "ダッシュボード", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("未処理の項目はありません")).toBeVisible();
  await expect(page.getByText("取引がまだありません")).toBeVisible();
});

test("下書きが要対応に出て、確定すると月次集計に反映される", async ({
  page,
}) => {
  await createTransactionDraft(page, {
    amount: "12000",
    accountLabel: "消耗品費",
  });

  await page.goto("/dashboard");

  // 要対応: 下書き1件のリンクが出る
  const draftLink = page.getByRole("link", {
    name: /未確定の取引\(下書き\)/,
  });
  await expect(draftLink).toBeVisible();
  await expect(draftLink).toContainText("1件");

  // 最近の取引に登録した取引が出る
  const recentRow = page.getByRole("row", { name: /消耗品費/ });
  await expect(recentRow).toContainText("支出");
  await expect(recentRow).toContainText("￥12,000");
  await expect(recentRow).toContainText("下書き");

  // 取引を確定
  await page.goto("/transactions");
  const txRow = page.getByRole("row", { name: /テスト商店/ });
  await txRow.click();
  await page.getByRole("button", { name: "確定する" }).click();
  await expect(txRow).toContainText("確定");

  // ダッシュボードの月次経費カードに確定額が載り、要対応はゼロに戻る
  await page.goto("/dashboard");
  const expenseCard = page
    .locator("p", { hasText: "の経費(確定)" })
    .locator("..");
  await expect(expenseCard).toContainText("￥12,000");
  await expect(page.getByText("未処理の項目はありません")).toBeVisible();
});
