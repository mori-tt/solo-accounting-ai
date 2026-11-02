import { expect, test, type Page } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

async function createCustomer(page: Page, name = "E2E顧問先"): Promise<void> {
  await page.goto("/customers");
  await page.getByRole("button", { name: "顧客を登録" }).click();
  await page.getByLabel("顧客名").fill(name);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

async function createTemplate(page: Page): Promise<void> {
  await page.goto("/recurring-invoices");
  await page.getByRole("button", { name: "テンプレートを登録" }).click();
  const form = page.locator("form");
  await form.getByLabel("テンプレート名").fill("月額顧問料");
  await form
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: "E2E顧問先" });
  await form.getByLabel("毎月の発行日").fill("25");
  // 当日基準だと実行日が発行日(25日)を過ぎた月に生成対象外になるため、
  // 確実に当月分が対象になるよう過去日付を入れる
  await form.getByLabel("開始日").fill("2020-01-01");
  await form.getByPlaceholder("例: 顧問料(月額)").fill("顧問料");
  await form.getByPlaceholder("単価(円)").fill("50000");
  await form.getByRole("button", { name: "登録する" }).click();
}

test("定期請求書テンプレートを登録して今月分を生成すると下書き請求書ができる", async ({
  page,
}) => {
  await createCustomer(page);
  await createTemplate(page);

  const templateRow = page.getByRole("row", { name: /月額顧問料/ });
  await expect(templateRow).toContainText("E2E顧問先");
  await expect(templateRow).toContainText("毎月");
  await expect(templateRow).toContainText("25日");
  await expect(templateRow).toContainText("￥50,000");
  await expect(templateRow).toContainText("有効");

  // 今月分の請求書を一括生成
  await page.getByRole("button", { name: /分を生成$/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "今月分の請求書を生成",
  });
  await dialog.getByRole("button", { name: "生成する" }).click();
  await expect(
    page.getByText(/分の請求書を1件生成しました/),
  ).toBeVisible();

  // 請求・入金画面に下書きとして現れる
  await page.goto("/invoices");
  const row = page.getByRole("row", { name: /E2E顧問先/ });
  await expect(row).toContainText("下書き");
  await expect(row).toContainText("￥50,000");
  await expect(row).toContainText("INV-000001");

  // 同じ月に再実行しても二重生成されない
  await page.goto("/recurring-invoices");
  await page.getByRole("button", { name: /分を生成$/ }).click();
  await page
    .getByRole("dialog", { name: "今月分の請求書を生成" })
    .getByRole("button", { name: "生成する" })
    .click();
  await expect(
    page.getByText(/に生成対象のテンプレートはありません/),
  ).toBeVisible();
});

test("テンプレートを無効化すると生成対象から外れる", async ({ page }) => {
  await createCustomer(page);
  await createTemplate(page);

  const templateRow = page.getByRole("row", { name: /月額顧問料/ });
  await expect(templateRow).toContainText("有効");

  await templateRow.getByRole("button", { name: "無効化" }).click();
  await expect(templateRow).toContainText("無効");

  await page.getByRole("button", { name: /分を生成$/ }).click();
  await page
    .getByRole("dialog", { name: "今月分の請求書を生成" })
    .getByRole("button", { name: "生成する" })
    .click();
  await expect(
    page.getByText(/に生成対象のテンプレートはありません/),
  ).toBeVisible();
});
