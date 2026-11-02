import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test("セットアップウィザードを完了すると設定が保存されダッシュボードへ行ける", async ({
  page,
}) => {
  await signUpAndCreateBusiness(page);

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "セットアップウィザード" }),
  ).toBeVisible();

  // 1. 事業情報(作成済みの値が初期表示) → 次へ
  await expect(
    page.getByRole("heading", { name: "事業情報" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();

  // 2. 会計年度の開始月 → 保存して次へ
  await expect(
    page.getByRole("heading", { name: "会計年度の開始月" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存して次へ" }).click();

  // 3. 期首残高: 現金に10,000を入れて保存して次へ
  await expect(
    page.getByRole("heading", { name: /年度の期首残高/ }),
  ).toBeVisible();
  await page.getByLabel("現金(円)").fill("10000");
  await page.getByRole("button", { name: "保存して次へ" }).click();

  // 4. 勘定科目の確認 → 次へ
  await expect(
    page.getByRole("heading", { name: "勘定科目の確認" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();

  // 5. 完了画面: 入力内容のサマリが出る
  await expect(
    page.getByRole("heading", { name: "セットアップが完了しました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("E2Eテスト事業"),
  ).toBeVisible();
  await expect(page.getByText("1件登録")).toBeVisible();

  await page.getByRole("button", { name: "ダッシュボードへ" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 期首残高ステップの入力は実データとして保存されている
  await page.goto("/opening-balances");
  const cashRow = page.getByRole("row", { name: /現金/ });
  await expect(cashRow).toBeVisible();
  await expect(cashRow.getByPlaceholder("0")).toHaveValue("10000");
});
