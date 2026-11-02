import { expect, test, type Page } from "@playwright/test";

// 法務ページは公開ページ(未ログインで閲覧可能)。骨組みのみで本文は法務レビュー待ち。
const PAGES = [
  { path: "/legal/terms", heading: "利用規約" },
  { path: "/legal/privacy", heading: "プライバシーポリシー" },
  { path: "/legal/tokusho", heading: "特定商取引法に基づく表記" },
] as const;

/**
 * Firebase Auth Emulator が画面下部に挿入する警告バナーは、
 * フッターリンク上に被さってクリックを妨げるため非表示にする
 * (エミュレータ固有の要素で、アプリUIではない)。
 *
 * バナーは Auth の Emulator 接続完了後に「非同期」でDOMへ追加される。
 * 存在する要素をその場で除去するだけだと、除去→挿入のレースで
 * 後から現れたバナーがクリックを遮り click timeout になる(CIで再現済み)。
 * CSSで常時非表示にしておけば、挿入タイミングに関係なく遮られない。
 * なお本操作は現在のdocumentにのみ効くため、ページ遷移のたびに呼ぶ。
 */
async function suppressEmulatorBanner(page: Page): Promise<void> {
  await page.addStyleTag({
    content: ".firebase-emulator-warning{display:none!important}",
  });
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
    await suppressEmulatorBanner(page);
    const link = legalNav.getByRole("link", { name: heading });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page.getByRole("heading", { name: heading }),
    ).toBeVisible();
    await page.goBack();
    // SPA遷移ではdocumentが維持されるが、戻り先の描画を待ってから次を操作する
    await expect(legalNav).toBeVisible();
  }
});

test("法務ページ間をフッターナビで回遊できる", async ({ page }) => {
  await page.goto("/legal/terms");
  const legalNav = page.getByRole("navigation", { name: "法務情報" });
  await suppressEmulatorBanner(page);
  await expect(legalNav).toBeVisible();

  const privacyLink = legalNav.getByRole("link", {
    name: "プライバシーポリシー",
  });
  await expect(privacyLink).toBeVisible();
  await privacyLink.click();
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  // 遷移先の描画完了を確認してから次のリンクを操作する
  // (URL更新とレンダー確定の間にclickすると不安定になりうる)
  await expect(
    page.getByRole("heading", { name: "プライバシーポリシー" }),
  ).toBeVisible();

  await suppressEmulatorBanner(page);
  const tokushoLink = legalNav.getByRole("link", {
    name: "特定商取引法に基づく表記",
  });
  await expect(tokushoLink).toBeVisible();
  await tokushoLink.click();
  await expect(page).toHaveURL(/\/legal\/tokusho$/);
  await expect(
    page.getByRole("heading", { name: "特定商取引法に基づく表記" }),
  ).toBeVisible();
});
