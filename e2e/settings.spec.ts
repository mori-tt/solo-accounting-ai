import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
  uniqueEmail,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("事業名と年度開始月を変更するとヘッダーの切替に反映される", async ({
  page,
}) => {
  await page.goto("/settings");

  const bizCard = page
    .getByRole("heading", { name: "事業情報" })
    .locator("..");
  await bizCard.getByLabel("事業名").fill("改名後の事業");
  await bizCard.getByLabel("会計年度の開始月").fill("4");
  await bizCard.getByRole("button", { name: "保存する" }).click();

  await expect(page.getByText("保存しました")).toBeVisible();
  const switcher = page.getByRole("combobox", { name: "事業の切り替え" });
  await expect(switcher.locator("option:checked")).toHaveText("改名後の事業");
  await expect(page.getByText("年度開始月 4月")).toBeVisible();
});

test("2つ目の事業を作成すると切替わり、事業ごとにデータが分かれる", async ({
  page,
}) => {
  // 元の事業に取引を1件登録しておく
  await createTransactionDraft(page);

  await page.goto("/settings");
  const newBizCard = page
    .getByRole("heading", { name: "新しい事業を作成" })
    .locator("..");
  await newBizCard.getByLabel("事業名").fill("第二の事業");
  await newBizCard
    .getByRole("button", { name: "事業を作成する" })
    .click();

  // 作成した事業が自動で選択される
  const switcher = page.getByRole("combobox", { name: "事業の切り替え" });
  await expect(switcher.locator("option:checked")).toHaveText("第二の事業");

  // 新しい事業では取引は見えない(businessId ごとの分離)
  await page.goto("/transactions");
  await expect(page.getByText("の取引はまだありません")).toBeVisible();
  await expect(
    page.getByRole("row", { name: /テスト商店/ }),
  ).not.toBeVisible();

  // 元の事業に切替えると取引が戻る
  await switcher.selectOption({ label: "E2Eテスト事業" });
  await expect(page.getByRole("row", { name: /テスト商店/ })).toBeVisible();
});

test("未登録のメールアドレスへの招待はエラーになる", async ({ page }) => {
  await page.goto("/settings");

  const membersCard = page
    .getByRole("heading", { name: "メンバー" })
    .locator("..");
  await membersCard
    .getByLabel("メンバー招待(メールアドレス)")
    .fill(uniqueEmail());
  await membersCard.getByRole("button", { name: "招待する" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "そのメールアドレスのユーザーが見つかりません" }),
  ).toBeVisible();
});
