import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("カスタム科目を追加すると取引フォームの科目選択肢に出る", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page.getByLabel("科目コード").fill("software_fee");
  await page.getByLabel("科目名").fill("ソフトウェア利用料");
  await page.getByRole("button", { name: "追加する" }).click();

  const row = page.getByRole("row", { name: /software_fee/ });
  await expect(row).toContainText("ソフトウェア利用料");
  await expect(row).toContainText("支出");

  // 取引フォームの勘定科目選択肢にカスタム科目が出る
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const accountSelect = page
    .locator("form")
    .getByRole("combobox", { name: "勘定科目", exact: true });
  await expect(
    accountSelect.locator("option", { hasText: "ソフトウェア利用料" }),
  ).toHaveCount(1);
});

test("カスタム科目を無効化すると選択肢から外れ、有効化で戻る", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page.getByLabel("科目コード").fill("tool_fee");
  await page.getByLabel("科目名").fill("ツール利用料");
  await page.getByRole("button", { name: "追加する" }).click();

  const row = page.getByRole("row", { name: /tool_fee/ });
  await row.getByRole("button", { name: "無効化" }).click();
  // 無効になると操作ボタンが「有効化」に変わる
  await expect(
    row.getByRole("button", { name: "有効化" }),
  ).toBeVisible();

  // 無効化中は取引フォームの選択肢に出ない
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const accountSelect = page
    .locator("form")
    .getByRole("combobox", { name: "勘定科目", exact: true });
  await expect(
    accountSelect.locator("option", { hasText: "ツール利用料" }),
  ).toHaveCount(0);

  // 有効化すると選択肢に戻る
  await page.goto("/accounts");
  const enabledRow = page.getByRole("row", { name: /tool_fee/ });
  await enabledRow.getByRole("button", { name: "有効化" }).click();
  // 有効に戻ると操作ボタンが「無効化」に戻る
  await expect(
    enabledRow.getByRole("button", { name: "無効化" }),
  ).toBeVisible();
});
