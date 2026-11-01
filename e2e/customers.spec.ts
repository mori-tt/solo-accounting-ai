import { expect, test } from "@playwright/test";
import { signUpAndCreateBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("顧客を編集すると一覧に反映される", async ({ page }) => {
  await page.goto("/customers");
  await page.getByRole("button", { name: "顧客を登録" }).click();
  await page.getByLabel("顧客名").fill("編集前株式会社");
  await page.getByRole("button", { name: "登録する" }).click();

  const row = page.getByRole("row", { name: /編集前株式会社/ });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "編集" }).click();
  const form = page.locator("form");
  await form.getByLabel("顧客名").fill("編集後株式会社");
  await form.getByLabel("メールアドレス").fill("billing@example.co.jp");
  await form.getByLabel("住所").fill("東京都渋谷区1-2-3");
  await form.getByRole("button", { name: "変更を保存" }).click();

  const updated = page.getByRole("row", { name: /編集後株式会社/ });
  await expect(updated).toContainText("billing@example.co.jp");
  await expect(updated).toContainText("東京都渋谷区1-2-3");
  await expect(
    page.getByRole("row", { name: /編集前株式会社/ }),
  ).not.toBeVisible();
});

test("案件の状態を変更して状態フィルタで絞り込める", async ({ page }) => {
  // 顧客→案件を作成
  await page.goto("/customers");
  await page.getByRole("button", { name: "顧客を登録" }).click();
  await page.getByLabel("顧客名").fill("案件用株式会社");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(
    page.getByRole("row", { name: /案件用株式会社/ }),
  ).toBeVisible();

  await page.goto("/projects");
  await page.getByRole("button", { name: "案件を登録" }).click();
  await page
    .getByRole("combobox", { name: "顧客", exact: true })
    .selectOption({ label: "案件用株式会社" });
  await page.getByLabel("案件名").fill("E2E保守案件");
  await page.getByRole("button", { name: "登録する" }).click();

  const row = page.getByRole("row", { name: /E2E保守案件/ });
  await expect(row).toContainText("進行中");

  // 編集で完了に変更
  await row.getByRole("button", { name: "編集" }).click();
  const form = page.locator("form");
  await form.getByLabel("状態").selectOption("done");
  await form.getByRole("button", { name: "変更を保存" }).click();
  await expect(row).toContainText("完了");

  // 状態フィルタ: 「進行中」では消え、「完了」では残る
  const filter = page.getByRole("combobox", { name: "状態で絞り込み" });
  await filter.selectOption({ label: "進行中" });
  await expect(row).not.toBeVisible();
  await expect(
    page.getByText("条件に一致する案件がありません"),
  ).toBeVisible();
  await filter.selectOption({ label: "完了" });
  await expect(
    page.getByRole("row", { name: /E2E保守案件/ }),
  ).toBeVisible();
});
