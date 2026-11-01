import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signIn,
  signOut,
  signUp,
  signUpAndCreateBusiness,
} from "./helpers";

/**
 * メンバー招待とロール別UIのE2E。
 * 招待される側は別ブラウザコンテキストで操作し、
 * オーナー側・メンバー側の両方の見え方を検証する。
 */
test("viewerとして招待されたメンバーは閲覧専用UIになる", async ({
  page,
  browser,
}) => {
  // オーナー: 事業を作成し、招待前に取引も1件入れておく
  await signUpAndCreateBusiness(page, "招待元の事業");
  await createTransactionDraft(page);

  // 招待される側: 別コンテキストでアカウントだけ作成(事業はまだ無い)
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  let memberEmail = "";
  try {
    memberEmail = await signUp(memberPage);
    await expect(
      memberPage.getByRole("heading", { name: "事業を作成しましょう" }),
    ).toBeVisible();

    // オーナー側で viewer 招待
    await page.goto("/settings");
    const membersCard = page
      .getByRole("heading", { name: "メンバー" })
      .locator("..");
    await membersCard
      .getByLabel("メンバー招待(メールアドレス)")
      .fill(memberEmail);
    await membersCard.getByLabel("ロール").selectOption("viewer");
    await membersCard.getByRole("button", { name: "招待する" }).click();

    // メンバー一覧にオーナー+招待したviewerの2行が出る
    const memberRows = membersCard.getByRole("row");
    await expect(memberRows).toHaveCount(3); // ヘッダー行 + 2件
    await expect(
      membersCard.getByRole("row").filter({ hasText: "(あなた)" }),
    ).toContainText("オーナー");
    await expect(
      membersCard.getByRole("row").filter({ hasText: "閲覧者" }),
    ).toBeVisible();

    // メンバー側: リロードすると招待元の事業が選択される
    await memberPage.reload();
    const memberSwitcher = memberPage.getByRole("combobox", {
      name: "事業の切り替え",
    });
    await expect(memberSwitcher.locator("option:checked")).toHaveText(
      "招待元の事業",
    );

    // オーナーの取引は読めるが、登録・編集系の操作は出ない
    await memberPage.goto("/transactions");
    const row = memberPage.getByRole("row", { name: /テスト商店/ });
    await expect(row).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "取引を登録" }),
    ).not.toBeVisible();
    await row.click();
    await expect(
      memberPage.getByRole("button", { name: "確定する" }),
    ).not.toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "編集", exact: true }),
    ).not.toBeVisible();

    // 経費登録はフォームの代わりに案内が出る
    await memberPage.goto("/expenses/new");
    await expect(
      memberPage.getByText("閲覧ロールのため登録はできません"),
    ).toBeVisible();

    // 顧客・案件・請求書の登録ボタンも出ない
    await memberPage.goto("/customers");
    await expect(
      memberPage.getByRole("button", { name: "顧客を登録" }),
    ).not.toBeVisible();
    await memberPage.goto("/invoices");
    await expect(
      memberPage.getByRole("button", { name: "請求書を作成" }),
    ).not.toBeVisible();

    // 期間作成・締め操作も出ない
    await memberPage.goto("/closing");
    await expect(
      memberPage.getByRole("button", { name: "期間を作成" }),
    ).not.toBeVisible();
  } finally {
    await memberContext.close();
  }
});

test("メンバーを削除すると相手の事業一覧から消える", async ({
  page,
  browser,
}) => {
  await signUpAndCreateBusiness(page, "削除テスト事業");

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  let memberEmail = "";
  try {
    memberEmail = await signUp(memberPage);

    // editor として招待
    await page.goto("/settings");
    const membersCard = page
      .getByRole("heading", { name: "メンバー" })
      .locator("..");
    await membersCard
      .getByLabel("メンバー招待(メールアドレス)")
      .fill(memberEmail);
    await membersCard.getByRole("button", { name: "招待する" }).click();
    const invitedRow = membersCard
      .getByRole("row")
      .filter({ hasText: "編集者" });
    await expect(invitedRow).toBeVisible();

    // メンバー側で事業が見えることを確認
    await memberPage.reload();
    await expect(
      memberPage
        .getByRole("combobox", { name: "事業の切り替え" })
        .locator("option:checked"),
    ).toHaveText("削除テスト事業");

    // オーナー側でメンバー削除(確認ダイアログ経由)
    await invitedRow.getByRole("button", { name: "削除" }).click();
    const dialog = page.getByRole("dialog", { name: "メンバーの削除" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "削除する" }).click();
    await expect(invitedRow).not.toBeVisible();

    // メンバー側はリロードで事業が消え、オンボーディングに戻る
    await memberPage.reload();
    await expect(
      memberPage.getByRole("heading", { name: "事業を作成しましょう" }),
    ).toBeVisible();

    // 再ログインしても招待は復活しない
    await signOut(memberPage);
    await signIn(memberPage, memberEmail);
    await expect(
      memberPage.getByRole("heading", { name: "事業を作成しましょう" }),
    ).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
