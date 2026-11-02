import { expect, test } from "@playwright/test";
import {
  confirmTransaction,
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("確定済み取引をキーワードで横断検索できる(下書きは対象外)", async ({
  page,
}) => {
  await createTransactionDraft(page, {
    counterparty: "検索対象商店",
    description: "E2E検索用",
  });

  // 下書きのままではヒットしない
  await page.goto("/search");
  await page.getByLabel("検索キーワード").fill("検索対象");
  await page.getByRole("button", { name: "検索" }).click();
  await expect(
    page.getByText("条件に一致する確定済み取引がありません"),
  ).toBeVisible();

  // 確定するとヒットする
  await confirmTransaction(page, /検索対象商店/);
  await page.goto("/search");
  await page.getByLabel("検索キーワード").fill("検索対象");
  await page.getByRole("button", { name: "検索" }).click();
  const row = page.getByRole("row", { name: /検索対象商店/ });
  await expect(row).toContainText("消耗品費");
  await expect(row).toContainText("￥12,000");
  await expect(row).toContainText("確定");

  // 関係ないキーワードではヒットしない
  await page.getByLabel("検索キーワード").fill("存在しない取引先");
  await page.getByRole("button", { name: "検索" }).click();
  await expect(
    page.getByText("条件に一致する確定済み取引がありません"),
  ).toBeVisible();
});
