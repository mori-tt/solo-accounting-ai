import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  datePlusDays,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("期間作成→下書きで締め不可→確定→締め実行→取引がロックされる", async ({
  page,
}) => {
  await createTransactionDraft(page);

  // 期間を作成(指定日=今日が属する年度)
  await page.goto("/closing");
  await page.getByRole("button", { name: "期間を作成" }).click();

  // 下書きが残っている間は締められない
  await expect(
    page.getByText("下書きの取引が残っているため締められません"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この期間を締める" }),
  ).toBeDisabled();
  // 未確定の取引セクションに1件と表示される
  const draftSection = page
    .getByRole("heading", { name: "未確定の取引(下書き)" })
    .locator("..");
  await expect(draftSection).toContainText("1件");

  // 取引一覧で下書きを確定
  await page.goto("/transactions");
  const txRow = page.getByRole("row", { name: /テスト商店/ });
  await txRow.click();
  await page.getByRole("button", { name: "確定する" }).click();
  await expect(txRow).toContainText("確定");

  // 締め可能になる → 締め実行
  await page.goto("/closing");
  await expect(page.getByText("締め可能です")).toBeVisible();
  // 確定済み経費で領収書未添付のものが警告として残る(締めの妨げにはならない)
  await expect(page.getByText("領収書未添付の確定済み経費")).toBeVisible();
  await page.getByRole("button", { name: "この期間を締める" }).click();
  const dialog = page.getByRole("dialog", { name: "会計期間の締め" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "締めを実行する" }).click();

  await expect(
    page.getByText("この期間は締め済みです"),
  ).toBeVisible();

  // 締め済み期間の取引は locked になり編集・削除・確定の操作が消える
  await page.goto("/transactions");
  const lockedRow = page.getByRole("row", { name: /テスト商店/ });
  await expect(lockedRow).toContainText("締め済み");
  await lockedRow.click();
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "削除", exact: true }),
  ).not.toBeVisible();
});

test("確定取引が月次レポートの科目別内訳に集計される", async ({ page }) => {
  // 収入取引を登録して確定
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const form = page.locator("form");
  await form
    .getByRole("combobox", { name: "種別", exact: true })
    .selectOption({ label: "収入" });
  await form.getByLabel("金額(円)").fill("300000");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "売上高" });
  await form.getByLabel("取引先").fill("売上先株式会社");
  await form.getByRole("button", { name: "下書きとして登録" }).click();

  const row = page.getByRole("row", { name: /売上先株式会社/ });
  await row.click();
  await page.getByRole("button", { name: "確定する" }).click();
  await expect(row).toContainText("確定");

  await page.goto("/reports/monthly");
  const breakdownRow = page.getByRole("row", { name: /売上高/ });
  await expect(breakdownRow).toContainText("￥300,000");

  // 集計の保存で「保存済み集計」表示になる
  await page.getByRole("button", { name: "集計を保存して更新" }).click();
  await expect(page.getByText("保存済み集計:")).toBeVisible();
});

test("期日超過の未払経費と未入金請求書がチェック対象に出る", async ({
  page,
}) => {
  // 支払期日を過ぎた未払経費を登録(取引は下書きのまま)
  await page.goto("/expenses/new");
  const expenseForm = page.locator("form");
  await expenseForm.getByLabel("金額(円)").fill("30000");
  await expenseForm
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "通信費" });
  await expenseForm.getByLabel("取引先").fill("携帯キャリア");
  await expenseForm.getByLabel("支払期日(任意)").fill(datePlusDays(-5));
  await expenseForm.getByRole("button", { name: "経費を登録する" }).click();
  await expect(
    page.getByText("経費を下書きとして登録しました"),
  ).toBeVisible();

  // 期日の過ぎた発行済み請求書を用意する
  await page.goto("/customers");
  await page.getByRole("button", { name: "顧客を登録" }).click();
  await page.getByLabel("顧客名").fill("締めチェック株式会社");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(
    page.getByRole("row", { name: /締めチェック株式会社/ }),
  ).toBeVisible();

  await page.goto("/invoices");
  await page.getByRole("button", { name: "請求書を作成" }).click();
  const invoiceForm = page.locator("form");
  await invoiceForm
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: "締めチェック株式会社" });
  await invoiceForm.getByLabel("発行日").fill(datePlusDays(-10));
  await invoiceForm.getByLabel("支払期日").fill(datePlusDays(-1));
  await invoiceForm.getByPlaceholder("例: デザイン制作費").fill("制作費");
  await invoiceForm.getByPlaceholder("単価(円)").fill("80000");
  await invoiceForm
    .getByRole("button", { name: "請求書を作成(下書き)" })
    .click();
  const invoiceRow = page.getByRole("row", {
    name: /締めチェック株式会社/,
  });
  await invoiceRow.getByRole("button", { name: "発行する" }).click();
  await expect(invoiceRow).toContainText("期限超過");

  // 期間を作成すると両方が期限超過つきで検出される
  await page.goto("/closing");
  await page.getByRole("button", { name: "期間を作成" }).click();

  const unpaidExpenseSection = page
    .getByRole("heading", { name: "未払の経費" })
    .locator("..")
    .locator("..");
  await expect(unpaidExpenseSection).toContainText("1件");
  await expect(unpaidExpenseSection).toContainText("期限超過");
  await expect(unpaidExpenseSection).toContainText("￥30,000");

  const unpaidInvoiceSection = page
    .getByRole("heading", { name: "未入金の請求書" })
    .locator("..")
    .locator("..");
  await expect(unpaidInvoiceSection).toContainText("1件");
  await expect(unpaidInvoiceSection).toContainText("期限超過");
  await expect(unpaidInvoiceSection).toContainText("￥80,000");
});
