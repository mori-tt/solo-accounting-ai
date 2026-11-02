import { expect, test, type Page } from "@playwright/test";
import {
  confirmTransaction,
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

/** 収入 ¥300,000 と支出 ¥12,000 の確定済み取引を用意する */
async function createConfirmedTransactions(page: Page): Promise<void> {
  await createTransactionDraft(page, {
    typeLabel: "収入",
    amount: "300000",
    accountLabel: "売上高",
    counterparty: "売上先株式会社",
    description: "10月分制作費",
  });
  await confirmTransaction(page, /売上先株式会社/);
  await createTransactionDraft(page);
  await confirmTransaction(page, /テスト商店/);
}

test("確定取引が仕訳帳に借方・貸方の複式仕訳で表示される", async ({
  page,
}) => {
  await createConfirmedTransactions(page);
  await page.goto("/reports/journal");

  // 支出: 借方=消耗品費 / 貸方=現金
  const expenseRow = page.getByRole("row", { name: /消耗品費/ });
  await expect(expenseRow).toContainText("￥12,000");
  await expect(expenseRow).toContainText("現金");
  await expect(expenseRow).toContainText("E2E備品購入");

  // 収入: 借方=現金 / 貸方=売上高
  const incomeRow = page.getByRole("row", { name: /売上高/ });
  await expect(incomeRow).toContainText("￥300,000");
  await expect(incomeRow).toContainText("現金");
});

test("確定取引が総勘定元帳の科目別残高に反映される", async ({ page }) => {
  await createConfirmedTransactions(page);
  await page.goto("/reports/ledger");

  await page
    .getByRole("combobox", { name: "勘定科目" })
    .selectOption({ label: "消耗品費" });
  const lineRow = page.getByRole("row", { name: /E2E備品購入/ });
  await expect(lineRow).toContainText("￥12,000");
  await expect(page.getByText("期末残高")).toBeVisible();
});

test("試算表で借方合計と貸方合計が一致する", async ({ page }) => {
  await createConfirmedTransactions(page);
  await page.goto("/reports/trial-balance");

  await expect(page.getByText("貸借一致")).toBeVisible();
  // 借方: 消耗品費 12,000 + 現金 300,000 = 貸方: 売上高 300,000 + 現金 12,000
  await expect(
    page.getByRole("row", { name: /消耗品費/ }),
  ).toContainText("￥12,000");
  await expect(page.getByRole("row", { name: /売上高/ })).toContainText(
    "￥300,000",
  );
  const totalRow = page.getByRole("row", { name: /^合計/ });
  await expect(totalRow).toContainText("￥312,000");
});

test("年次レポートで収入・支出・差引損益が年度合計で表示される", async ({
  page,
}) => {
  await createConfirmedTransactions(page);
  await page.goto("/reports/yearly");

  const incomeCard = page.locator("p", { hasText: "収入合計" }).locator("..");
  await expect(incomeCard).toContainText("￥300,000");
  const expenseCard = page.locator("p", { hasText: "支出合計" }).locator("..");
  await expect(expenseCard).toContainText("￥12,000");
  const profitCard = page.locator("p", { hasText: "差引損益" }).locator("..");
  await expect(profitCard).toContainText("￥288,000");

  // 科目別内訳にも出る
  await expect(
    page.getByRole("row", { name: /売上高/ }),
  ).toContainText("￥300,000");
});

test("決算書(収支内訳書)で収入金額と経費が集計される", async ({ page }) => {
  await createConfirmedTransactions(page);
  await page.goto("/reports/filing");

  await expect(
    page.getByRole("row", { name: /売上\(収入\)金額/ }),
  ).toContainText("￥300,000");
  await expect(
    page.getByRole("row", { name: /収入金額 計/ }),
  ).toContainText("￥300,000");
  await expect(
    page.getByRole("row", { name: /消耗品費/ }),
  ).toContainText("￥12,000");
  await expect(
    page.getByRole("row", { name: /経費 計/ }),
  ).toContainText("￥12,000");
  await expect(
    page.getByRole("row", { name: /所得金額/ }),
  ).toContainText("￥288,000");
});
