import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("定期取引テンプレートを登録して今月分を生成すると下書き取引ができる", async ({
  page,
}) => {
  await page.goto("/recurring");
  await page.getByRole("button", { name: "テンプレートを登録" }).click();
  const form = page.locator("form");
  await form.getByLabel("テンプレート名").fill("事務所家賃");
  await form.getByLabel("金額(円)").fill("80000");
  await form.getByLabel("毎月の日付").fill("25");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "地代家賃" });
  await form.getByLabel("取引先").fill("大家不動産");
  await form.getByLabel("摘要").fill("毎月の家賃");
  await form.getByRole("button", { name: "登録する" }).click();

  const templateRow = page.getByRole("row", { name: /事務所家賃/ });
  await expect(templateRow).toContainText("支出");
  await expect(templateRow).toContainText("地代家賃");
  await expect(templateRow).toContainText("￥80,000");
  await expect(templateRow).toContainText("25日");
  await expect(templateRow).toContainText("有効");

  // 今月分の取引を一括生成
  await page.getByRole("button", { name: /分を生成$/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "今月分の取引を生成",
  });
  await dialog.getByRole("button", { name: "生成する" }).click();
  await expect(
    page.getByText(/分の取引を1件生成しました/),
  ).toBeVisible();

  // 取引一覧に下書きとして現れる
  await page.goto("/transactions");
  const txRow = page.getByRole("row", { name: /大家不動産/ });
  await expect(txRow).toContainText("下書き");
  await expect(txRow).toContainText("￥80,000");

  // 同じ月に再実行しても二重生成されない
  await page.goto("/recurring");
  await page.getByRole("button", { name: /分を生成$/ }).click();
  await page
    .getByRole("dialog", { name: "今月分の取引を生成" })
    .getByRole("button", { name: "生成する" })
    .click();
  await expect(
    page.getByText(/に生成対象のテンプレートはありません/),
  ).toBeVisible();
});

test("テンプレートを無効化すると生成対象から外れる", async ({ page }) => {
  await page.goto("/recurring");
  await page.getByRole("button", { name: "テンプレートを登録" }).click();
  const form = page.locator("form");
  await form.getByLabel("テンプレート名").fill("サーバー代");
  await form.getByLabel("金額(円)").fill("5000");
  await form.getByLabel("毎月の日付").fill("10");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "通信費" });
  await form.getByRole("button", { name: "登録する" }).click();

  const templateRow = page.getByRole("row", { name: /サーバー代/ });
  await expect(templateRow).toContainText("有効");

  // 無効化 → 生成対象なしになる
  await templateRow.getByRole("button", { name: "無効化" }).click();
  await expect(templateRow).toContainText("無効");

  await page.getByRole("button", { name: /分を生成$/ }).click();
  await page
    .getByRole("dialog", { name: "今月分の取引を生成" })
    .getByRole("button", { name: "生成する" })
    .click();
  await expect(
    page.getByText(/に生成対象のテンプレートはありません/),
  ).toBeVisible();
});
