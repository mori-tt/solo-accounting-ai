import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("期首残高を登録すると保存され再表示でも残る", async ({ page }) => {
  await page.goto("/opening-balances");
  await expect(
    page.getByText("期首残高は未登録です"),
  ).toBeVisible();

  // 現金 50,000 を1行追加して保存
  await page.getByRole("button", { name: "行を追加" }).click();
  await page.getByPlaceholder("0").fill("50000");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();

  // 再読み込みしても登録した行が残る
  await page.reload();
  const row = page.getByRole("row", { name: /現金/ });
  await expect(row).toBeVisible();
  await expect(row.getByPlaceholder("0")).toHaveValue("50000");
});
