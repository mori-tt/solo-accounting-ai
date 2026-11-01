import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("経費を登録すると下書き取引として取引一覧に連動する", async ({
  page,
}) => {
  await page.goto("/expenses/new");
  const form = page.locator("form");
  await form.getByLabel("金額(円)").fill("5500");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "通信費" });
  await form.getByLabel("取引先").fill("モバイル株式会社");
  await form.getByLabel("摘要").fill("携帯電話");
  await form.getByRole("button", { name: "経費を登録する" }).click();

  await expect(
    page.getByText("経費を下書きとして登録しました"),
  ).toBeVisible();

  // 登録済みの経費テーブルに表示される(未払・下書き)
  const expenseRow = page.getByRole("row", { name: /モバイル株式会社/ });
  await expect(expenseRow).toContainText("通信費");
  await expect(expenseRow).toContainText("￥5,500");
  await expect(expenseRow).toContainText("未払");
  await expect(expenseRow).toContainText("下書き");

  // 取引一覧でも同じ取引が下書きとして見え、そこで確定できる
  await page.goto("/transactions");
  const txRow = page.getByRole("row", { name: /モバイル株式会社/ });
  await expect(txRow).toContainText("下書き");
  await txRow.click();
  await page.getByRole("button", { name: "確定する" }).click();
  await expect(txRow).toContainText("確定");

  // 経費側にも取引状態の確定が反映される
  await page.goto("/expenses/new");
  await expect(
    page.getByRole("row", { name: /モバイル株式会社/ }),
  ).toContainText("確定");
});

test("未払の経費を支払済みにできる", async ({ page }) => {
  await page.goto("/expenses/new");
  const form = page.locator("form");
  await form.getByLabel("金額(円)").fill("8800");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "地代家賃" });
  await form.getByLabel("取引先").fill("賃貸オーナー");
  await form.getByRole("button", { name: "経費を登録する" }).click();

  const row = page.getByRole("row", { name: /賃貸オーナー/ });
  await expect(row).toContainText("未払");
  await row.getByRole("button", { name: "支払済にする" }).click();
  await expect(row).toContainText("支払済");
  await expect(
    row.getByRole("button", { name: "支払済にする" }),
  ).not.toBeVisible();
});
