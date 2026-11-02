import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness, todayDateString } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("銀行CSVを取り込んで選択行を一括登録すると下書き取引になる", async ({
  page,
}) => {
  const today = todayDateString();
  const csv = [
    "日付,摘要,出金額,入金額,残高",
    `${today},コンビニA,1500,,100000`,
    `${today},売上振込,,50000,150000`,
  ].join("\n");

  await page.goto("/transactions/import");
  await page.locator("input[type=file]").setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });

  // 2行とも候補化され選択状態になる(出金=支出・入金=収入の推定)
  await expect(page.getByText(/全2行: 候補 2件/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "選択中の2件を登録" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "選択中の2件を登録" }).click();
  await expect(
    page.getByText(/登録が完了しました/),
  ).toBeVisible();

  // 取引一覧に下書きとして出る
  await page.goto("/transactions");
  const expenseRow = page.getByRole("row", { name: /コンビニA/ });
  await expect(expenseRow).toContainText("支出");
  await expect(expenseRow).toContainText("￥1,500");
  await expect(expenseRow).toContainText("下書き");
  const incomeRow = page.getByRole("row", { name: /売上振込/ });
  await expect(incomeRow).toContainText("収入");
  await expect(incomeRow).toContainText("￥50,000");
  await expect(incomeRow).toContainText("下書き");
});

test("同じ金額・近日付の既存取引は重複の可能性として選択外になる", async ({
  page,
}) => {
  // 先に同日・同額の取引を登録しておく
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const form = page.locator("form");
  await form.getByLabel("金額(円)").fill("1500");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "雑費" });
  await form.getByLabel("取引先").fill("コンビニA");
  await form.getByRole("button", { name: "下書きとして登録" }).click();
  await expect(
    page.getByRole("row", { name: /コンビニA/ }),
  ).toBeVisible();

  const today = todayDateString();
  const csv = [
    "日付,摘要,出金額,入金額,残高",
    `${today},コンビニA,1500,,100000`,
    `${today},新規の支出,7000,,93000`,
  ].join("\n");

  await page.goto("/transactions/import");
  await page.locator("input[type=file]").setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });

  // コンビニA行は重複バッジが付き選択外 → 登録対象は1件だけ
  const dupRow = page.getByRole("row", { name: /コンビニA/ });
  await expect(dupRow).toContainText("重複の可能性");
  await expect(
    page.getByRole("button", { name: "選択中の1件を登録" }),
  ).toBeEnabled();
});
