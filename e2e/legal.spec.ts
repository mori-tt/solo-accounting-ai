import { expect, test, type Page } from "@playwright/test";

// 法務ページは公開ページ(未ログインで閲覧可能)。骨組みのみで本文は法務レビュー待ち。
const PAGES = [
  { path: "/legal/terms", heading: "利用規約" },
  { path: "/legal/privacy", heading: "プライバシーポリシー" },
  { path: "/legal/tokusho", heading: "特定商取引法に基づく表記" },
] as const;

/**
 * Firebase Auth Emulator が画面下部に挿入する警告バナーは、
 * フッターリンク上に被さってクリックを妨げるため除去する
 * (エミュレータ固有の要素で、アプリUIではない)。
 */
async function removeEmulatorBanner(page: Page): Promise<void> {
  await page
    .locator(".firebase-emulator-warning")
    .evaluateAll((els) => els.forEach((el) => el.remove()));
}

for (const { path, heading } of PAGES) {
  test(`${heading}が未ログインで閲覧できる`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading }),
    ).toBeVisible();
    // 本文未作成の旨のプレースホルダー注記が出ている
    await expect(page.getByText(/要法務レビュー/).first()).toBeVisible();
  });
}

test("ログイン画面のフッターから法務ページへ遷移できる", async ({ page }) => {
  await page.goto("/login");
  const legalNav = page.getByRole("navigation", { name: "法務情報" });
  await expect(legalNav).toBeVisible();

  for (const { path, heading } of PAGES) {
    await removeEmulatorBanner(page);
    await legalNav.getByRole("link", { name: heading }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page.getByRole("heading", { name: heading }),
    ).toBeVisible();
    await page.goBack();
  }
});

test("法務ページ間をフッターナビで回遊できる", async ({ page }) => {
  await page.goto("/legal/terms");
  const legalNav = page.getByRole("navigation", { name: "法務情報" });
  await removeEmulatorBanner(page);
  await legalNav.getByRole("link", { name: "プライバシーポリシー" }).click();
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  await removeEmulatorBanner(page);
  await legalNav.getByRole("link", { name: "特定商取引法に基づく表記" }).click();
  await expect(page).toHaveURL(/\/legal\/tokusho$/);
});
