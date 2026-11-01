import { expect, test } from "@playwright/test";
import {
  createFirstBusiness,
  signIn,
  signOut,
  signUp,
} from "./helpers";

test("新規登録→事業作成→ログアウト→再ログインで事業が引き継がれる", async ({
  page,
}) => {
  const email = await signUp(page);
  await createFirstBusiness(page, "E2E認証事業");

  // ヘッダーにログイン中のメールアドレスとナビが表示される
  await expect(page.getByText(email)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "取引一覧" }),
  ).toBeVisible();

  await signOut(page);
  await expect(
    page.getByRole("heading", { name: "Solo Accounting AI" }),
  ).toBeVisible();

  // 再ログインすると作成済みの事業が選択された状態でダッシュボードが出る
  await signIn(page, email);
  await expect(
    page.getByRole("heading", { name: "ダッシュボード", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("combobox", { name: "事業の切り替え" })
      .locator("option:checked"),
  ).toHaveText("E2E認証事業");
});

test("誤ったパスワードではログインできずエラーメッセージが出る", async ({
  page,
}) => {
  const email = await signUp(page);
  await createFirstBusiness(page);
  await signOut(page);

  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill("wrong-password-999");
  await page
    .locator("form")
    .getByRole("button", { name: "ログイン" })
    .click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "メールアドレスまたはパスワードが違います" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("未ログインで認証領域へ行くとログイン画面へ戻される", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login$/);
});
