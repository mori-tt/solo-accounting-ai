import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test("事業名の確認入力で事業を完全削除でき、最初の作成画面に戻る", async ({
  page,
}) => {
  await signUpAndCreateBusiness(page);

  await page.goto("/business-delete");
  const deleteButton = page.getByRole("button", {
    name: "事業を削除する",
  });
  await expect(deleteButton).toBeDisabled();

  // 事業名と一致しない限り削除ボタンは無効のまま
  await page.getByLabel("確認のため事業名を入力").fill("別の名前");
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel("確認のため事業名を入力").fill("E2Eテスト事業");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await page
    .getByRole("dialog", { name: "事業を完全に削除しますか?" })
    .getByRole("button", { name: "削除を実行" })
    .click();

  // 事業がなくなりダッシュボード上で最初の事業作成フォームが出る
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "事業を作成しましょう" }),
  ).toBeVisible();
});
