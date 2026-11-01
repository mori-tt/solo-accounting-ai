import { expect, test } from "@playwright/test";
import {
  createTransactionDraft,
  signUpAndCreateBusiness,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUpAndCreateBusiness(page);
});

test("取引を下書き登録して確定すると状態が確定になる", async ({ page }) => {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const form = page.locator("form");
  await form.getByLabel("金額(円)").fill("12000");
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: "消耗品費" });
  await form.getByLabel("取引先").fill("テスト商店");
  await form.getByLabel("摘要").fill("コピー用紙");
  await form.getByRole("button", { name: "下書きとして登録" }).click();

  const row = page.getByRole("row", { name: /テスト商店/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText("消耗品費");
  await expect(row).toContainText("￥12,000");
  await expect(row).toContainText("下書き");

  // 行をクリックで展開し、確定操作を行う
  await row.click();
  await page.getByRole("button", { name: "確定する" }).click();
  await expect(row).toContainText("確定");
  await expect(row).not.toContainText("下書き");

  // 状態フィルタで「確定」表示中は残り、「下書き」に切替えると消える
  const statusFilter = page.getByRole("combobox", {
    name: "状態で絞り込み",
  });
  await statusFilter.selectOption({ label: "確定" });
  await expect(row).toBeVisible();
  await statusFilter.selectOption({ label: "下書き" });
  await expect(row).not.toBeVisible();
});

test("取引を編集して金額を変更できる", async ({ page }) => {
  await createTransactionDraft(page);
  await page.getByRole("row", { name: /テスト商店/ }).click();
  await page.getByRole("button", { name: "編集", exact: true }).click();

  const editForm = page.locator("form");
  await editForm.getByLabel("金額(円)").fill("15500");
  await editForm.getByRole("button", { name: "変更を保存" }).click();

  // 編集フォーム入りの展開行もアクセシブル名に取引先を含むため、
  // テキスト内容で絞る(input の value は textContent に含まれない)
  await expect(
    page.locator("tbody tr", { hasText: "テスト商店" }),
  ).toContainText("￥15,500");
});

test("取引を削除すると一覧から消える", async ({ page }) => {
  await createTransactionDraft(page);
  await page.getByRole("row", { name: /テスト商店/ }).click();
  await page.getByRole("button", { name: "削除", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "取引の削除" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "削除する" }).click();

  await expect(
    page.getByRole("row", { name: /テスト商店/ }),
  ).not.toBeVisible();
  await expect(page.getByText("取引はまだありません")).toBeVisible();
});

test("必須項目が空だと検証エラーが表示され登録されない", async ({ page }) => {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const form = page.locator("form");
  // 金額・勘定科目が未入力のまま送信する
  await form.getByRole("button", { name: "下書きとして登録" }).click();

  const alert = page
    .getByRole("alert")
    .filter({ hasText: "勘定科目を選択してください" });
  await expect(alert).toContainText("金額は1円以上で入力してください");
  // フォームは開いたままで、一覧には何も追加されない
  await expect(
    page.getByText("取引はまだありません"),
  ).toBeVisible();
});

test("月送りと種別フィルタで一覧を絞り込める", async ({ page }) => {
  await createTransactionDraft(page);
  const row = page.getByRole("row", { name: /テスト商店/ });
  await expect(row).toBeVisible();

  // 前月に移ると対象外になり空表示、今月に戻すと再び見える
  await page.getByRole("button", { name: "← 前月" }).click();
  await expect(row).not.toBeVisible();
  await expect(
    page.getByText(/の取引はまだありません/),
  ).toBeVisible();
  await page.getByRole("button", { name: "翌月 →" }).click();
  await expect(row).toBeVisible();

  // 種別フィルタ: 「収入」では消え、「支出」では残る
  const typeFilter = page.getByRole("combobox", { name: "種別で絞り込み" });
  await typeFilter.selectOption({ label: "収入" });
  await expect(row).not.toBeVisible();
  await expect(
    page.getByText("条件に一致する取引がありません"),
  ).toBeVisible();
  await typeFilter.selectOption({ label: "支出" });
  await expect(row).toBeVisible();
});
