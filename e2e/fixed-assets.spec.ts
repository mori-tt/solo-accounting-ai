import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("固定資産を登録して年度分の償却費を経費計上できる", async ({ page }) => {
  const year = new Date().getFullYear();
  await page.goto("/fixed-assets");
  await page.getByRole("button", { name: "資産を登録" }).click();
  const form = page.locator("form");
  await form.getByLabel("資産名").fill("複合機");
  // 1月取得 → 当年12ヶ月分で月割り変動を避け、金額を確定値にする
  await form.getByLabel("取得日").fill(`${year}-01-01`);
  await form.getByLabel("取得価額(円)").fill("300000");
  await form.getByLabel("耐用年数(年)").fill("5");
  await form.getByLabel("事業割合(%)").fill("100");
  await form.getByRole("button", { name: "登録する" }).click();

  const assetRow = page.getByRole("row", { name: /複合機/ });
  await expect(assetRow).toContainText("定額法");
  await expect(assetRow).toContainText("￥300,000");
  await expect(assetRow).toContainText("5年");
  // 定額法の当年償却費 = 300,000 / 5 = 60,000
  await expect(assetRow).toContainText("￥60,000");
  await expect(assetRow).toContainText("保有中");

  // 年度分の償却費を取引生成(定額法: 300,000/5 = 60,000)
  await page
    .getByRole("button", { name: /年度分を経費計上/ })
    .click();
  await page
    .getByRole("dialog", { name: "当年分の償却費を経費計上" })
    .getByRole("button", { name: "計上する" })
    .click();
  await expect(
    page.getByText(/年度分の償却費を1件の取引として生成しました/),
  ).toBeVisible();

  // 減価償却費の下書き取引は年度末日(開始月1月なら12月)に生成される
  await page.goto("/transactions");
  const clicksToDecember = 11 - new Date().getMonth();
  for (let i = 0; i < clicksToDecember; i += 1) {
    await page.getByRole("button", { name: "翌月 →" }).click();
  }
  const txRow = page.getByRole("row", { name: /減価償却費/ });
  await expect(txRow).toContainText("￥60,000");
  await expect(txRow).toContainText("下書き");
});
