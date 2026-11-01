import { expect, test } from "@playwright/test";
import {
  datePlusDays,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("顧客→案件→請求書発行→入金消込の一連の流れ", async ({ page }) => {
  // 顧客を登録
  await page.goto("/customers");
  await page.getByRole("button", { name: "顧客を登録" }).click();
  await page.getByLabel("顧客名").fill("株式会社E2E");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(
    page.getByRole("row", { name: /株式会社E2E/ }),
  ).toBeVisible();

  // その顧客の案件を登録
  await page.goto("/projects");
  await page.getByRole("button", { name: "案件を登録" }).click();
  await page
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: "株式会社E2E" });
  await page.getByLabel("案件名").fill("E2Eサイト制作");
  await page.getByRole("button", { name: "登録する" }).click();
  const projectRow = page.getByRole("row", { name: /E2Eサイト制作/ });
  await expect(projectRow).toContainText("株式会社E2E");
  await expect(projectRow).toContainText("進行中");

  // 請求書を作成(下書き)
  await page.goto("/invoices");
  await page.getByRole("button", { name: "請求書を作成" }).click();
  const form = page.locator("form");
  await form
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: "株式会社E2E" });
  await form
    .getByRole("combobox", { name: "案件(任意)" })
    .selectOption({ label: "E2Eサイト制作" });
  await form.getByLabel("支払期日").fill(datePlusDays(30));
  await form.getByPlaceholder("例: デザイン制作費").fill("サイト制作費");
  await form.getByPlaceholder("単価(円)").fill("200000");
  await form.getByRole("button", { name: "請求書を作成(下書き)" }).click();

  const invoiceRow = page.getByRole("row", { name: /株式会社E2E/ });
  await expect(invoiceRow).toContainText("E2Eサイト制作");
  await expect(invoiceRow).toContainText("￥200,000");
  await expect(invoiceRow).toContainText("下書き");

  // 発行 → 発行済み
  await invoiceRow.getByRole("button", { name: "発行する" }).click();
  await expect(invoiceRow).toContainText("発行済み");

  // 入金を記録(入金額は残額全額が初期値)→ 入金済み
  await invoiceRow.getByRole("button", { name: "入金を記録" }).click();
  await page
    .locator("form")
    .getByRole("button", { name: "入金を記録" })
    .click();
  await expect(invoiceRow).toContainText("入金済み");
  await expect(invoiceRow).not.toContainText("発行済み");
});

test("顧客が未登録だと請求書作成の導線が案内される", async ({ page }) => {
  await page.goto("/invoices");
  await expect(page.getByText("請求書がまだありません")).toBeVisible();
  await expect(
    page.getByText("先に顧客一覧で顧客を登録してください"),
  ).toBeVisible();
});
