import { expect, test } from "@playwright/test";

test("トップページからログイン画面へ誘導される", async ({ page }) => {
  await page.goto("/");
  // 未認証のため /login へリダイレクトされる
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Solo Accounting AI" }),
  ).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(
    page.locator("form").getByRole("button", { name: "ログイン" }),
  ).toBeVisible();
});
