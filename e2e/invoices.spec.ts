import { expect, test, type Page } from "@playwright/test";
import {
  datePlusDays,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

async function createCustomer(page: Page, name = "E2E請求先"): Promise<void> {
  await page.goto("/customers");
  await page.getByRole("button", { name: "顧客を登録" }).click();
  await page.getByLabel("顧客名").fill(name);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

/** 顧客1件・明細1行の請求書を下書き作成して行を返す */
async function createInvoiceDraft(
  page: Page,
  input: {
    customerName?: string;
    issueDate?: string;
    dueDate: string;
    unitPrice?: string;
  },
) {
  const {
    customerName = "E2E請求先",
    issueDate,
    dueDate,
    unitPrice = "200000",
  } = input;
  await page.goto("/invoices");
  await page.getByRole("button", { name: "請求書を作成" }).click();
  const form = page.locator("form");
  await form
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: customerName });
  if (issueDate) await form.getByLabel("発行日").fill(issueDate);
  await form.getByLabel("支払期日").fill(dueDate);
  await form.getByPlaceholder("例: デザイン制作費").fill("制作費");
  await form.getByPlaceholder("単価(円)").fill(unitPrice);
  await form.getByRole("button", { name: "請求書を作成(下書き)" }).click();
  const row = page.getByRole("row", { name: new RegExp(customerName) });
  await expect(row).toContainText("下書き");
  return row;
}

test("複数明細の請求書では合計が加算される", async ({ page }) => {
  await createCustomer(page);

  await page.goto("/invoices");
  await page.getByRole("button", { name: "請求書を作成" }).click();
  const form = page.locator("form");
  await form
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: "E2E請求先" });
  await form.getByLabel("支払期日").fill(datePlusDays(30));

  await form.getByPlaceholder("例: デザイン制作費").fill("デザイン費");
  await form.getByPlaceholder("単価(円)").fill("150000");

  // 明細を追加して数量2の行を入れる → 150000 + 50000*2 = 250000
  await form.getByRole("button", { name: "明細を追加" }).click();
  await form.getByPlaceholder("例: デザイン制作費").nth(1).fill("保守費");
  await form.getByPlaceholder("数量").nth(1).fill("2");
  await form.getByPlaceholder("単価(円)").nth(1).fill("50000");

  await expect(
    form.locator("p", { hasText: "合計" }),
  ).toContainText("￥250,000");

  await form.getByRole("button", { name: "請求書を作成(下書き)" }).click();
  await expect(
    page.getByRole("row", { name: /E2E請求先/ }),
  ).toContainText("￥250,000");
});

test("一部入金で残額が減り、残額の入金で入金済みになる", async ({ page }) => {
  await createCustomer(page);
  const row = await createInvoiceDraft(page, { dueDate: datePlusDays(30) });

  await row.getByRole("button", { name: "発行する" }).click();
  await expect(row).toContainText("発行済み");

  // 50,000 だけ入金 → 残額 150,000・状態は発行済みのまま
  await row.getByRole("button", { name: "入金を記録" }).click();
  const paymentForm = page.locator("form");
  await paymentForm.getByLabel(/入金額/).fill("50000");
  await paymentForm.getByRole("button", { name: "入金を記録" }).click();

  await expect(row).toContainText("￥50,000 / ￥150,000");
  await expect(row).toContainText("発行済み");

  // 残額を入金(初期値が残額なのでそのまま送信)→ 入金済み
  await row.getByRole("button", { name: "入金を記録" }).click();
  await page
    .locator("form")
    .getByRole("button", { name: "入金を記録" })
    .click();
  await expect(row).toContainText("入金済み");
  await expect(row).not.toContainText("発行済み");
});

test("残額を超える入金はエラーになる", async ({ page }) => {
  await createCustomer(page);
  const row = await createInvoiceDraft(page, { dueDate: datePlusDays(30) });

  await row.getByRole("button", { name: "発行する" }).click();
  await expect(row).toContainText("発行済み");

  await row.getByRole("button", { name: "入金を記録" }).click();
  const paymentForm = page.locator("form");
  await paymentForm.getByLabel(/入金額/).fill("99999999");
  await paymentForm.getByRole("button", { name: "入金を記録" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "入金額が残額(￥200,000)を超えています" }),
  ).toBeVisible();
  await expect(row).toContainText("発行済み");
});

test("支払期日を過ぎた発行済み請求書は期限超過になる", async ({ page }) => {
  await createCustomer(page);
  const row = await createInvoiceDraft(page, {
    issueDate: datePlusDays(-10),
    dueDate: datePlusDays(-1),
  });

  // 発行すると一覧再取得時に overdue へ更新される
  await row.getByRole("button", { name: "発行する" }).click();
  await expect(row).toContainText("期限超過");
  await expect(row).not.toContainText("発行済み");
});
