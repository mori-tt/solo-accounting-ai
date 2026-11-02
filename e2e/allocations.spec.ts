import { expect, test } from "@playwright/test";
import {
  confirmTransaction,
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("科目別の事業割合を保存すると月次レポートに按分後支出が出る", async ({
  page,
}) => {
  // 通信費の事業割合を50%に設定
  await page.goto("/allocations");
  await page.getByLabel("通信費の事業割合").fill("50");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();

  // 通信費 ¥20,000 の確定取引を用意
  await createTransactionDraft(page, {
    amount: "20000",
    accountLabel: "通信費",
    counterparty: "携帯キャリア",
    description: "スマホ利用料",
  });
  await confirmTransaction(page, /携帯キャリア/);

  // 月次レポートの科目別内訳に按分率50%と按分後支出 ¥10,000 が出る
  await page.goto("/reports/monthly");
  const row = page.getByRole("row", { name: /通信費/ });
  await expect(row).toContainText("￥20,000");
  await expect(row).toContainText("50%");
  await expect(row).toContainText("￥10,000");
});
