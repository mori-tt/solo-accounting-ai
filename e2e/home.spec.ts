import { expect, test } from "@playwright/test";

import { signUpAndCreateBusiness } from "./helpers";

test("未認証のトップページはランディングページを表示する", async ({ page }) => {
  await page.goto("/");
  // LPは / にとどまり、ログイン画面へはリダイレクトされない
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: /経理から確定申告の準備まで/ }),
  ).toBeVisible();
  // 「無料ではじめる」リンクはヒーローとCTAの2箇所にある
  await expect(
    page.getByRole("link", { name: "無料ではじめる" }),
  ).toHaveCount(2);
});

test("LPのログインリンクからログイン画面へ遷移できる", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("banner")
    .getByRole("link", { name: "ログイン" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
});

test("ログイン済みでトップページを開くとダッシュボードへ戻る", async ({
  page,
}) => {
  await signUpAndCreateBusiness(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "ダッシュボード", exact: true }),
  ).toBeVisible();
});
