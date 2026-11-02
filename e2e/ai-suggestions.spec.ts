import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("取引の科目をAI提案でき、採用すると取引の科目に反映される", async ({
  page,
}) => {
  // 「電車」を含む摘要 → ヒューリスティック提案は旅費交通費
  await createTransactionDraft(page, {
    counterparty: "交通系IC",
    description: "電車移動ICチャージ",
  });
  const txRow = page.getByRole("row", { name: /交通系IC/ });
  await txRow.click();
  await page.getByRole("button", { name: "科目をAI提案" }).click();

  // 生成が終わると行にAI提案バッジが付く(操作成功で展開は畳まれる)
  await expect(txRow).toContainText("AI提案");

  // 再度展開すると提案カードに科目候補が出る(提案は自動確定しない)
  await txRow.click();
  await expect(page.getByText("勘定科目の提案")).toBeVisible();
  await expect(page.getByText("旅費交通費")).toBeVisible();
  await expect(
    page.getByText(/AI提案はあくまで候補です/),
  ).toBeVisible();

  // 採用すると取引の科目が提案値に変わる
  await page
    .getByRole("button", { name: "提案を採用して反映" })
    .click();
  await expect(txRow).toContainText("旅費交通費");
});

test("AI提案を却下すると却下済みになる", async ({ page }) => {
  await createTransactionDraft(page);
  const txRow = page.getByRole("row", { name: /テスト商店/ });
  await txRow.click();
  await page.getByRole("button", { name: "重複チェック" }).click();

  await expect(txRow).toContainText("AI提案");

  await txRow.click();
  await expect(page.getByText("重複の疑い")).toBeVisible();
  await page.getByRole("button", { name: "却下する" }).click();

  // 却下が成功すると展開が畳まれるのを待ってから再度開く
  await expect(page.getByText("重複の疑い")).toBeHidden();
  await txRow.click();
  await expect(page.getByText("却下済み")).toBeVisible();
});
