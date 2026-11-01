import { expect, type Page } from "@playwright/test";

/**
 * E2E共通ヘルパー。
 * Firebase Emulator(auth/firestore/storage)上で実際のUIを通して
 * ユーザー登録・事業作成を行う。テスト間の干渉を避けるため、
 * 各テストは一意のメールアドレスで新規ユーザーを作る。
 */

export const TEST_PASSWORD = "e2e-password-123";

let counter = 0;

export function uniqueEmail(): string {
  counter += 1;
  return `e2e-${Date.now()}-${process.pid}-${counter}@example.com`;
}

export function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function datePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** /login の「新規登録」タブからアカウント作成 → /dashboard へ */
export async function signUp(
  page: Page,
  email = uniqueEmail(),
): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: "新規登録" }).click();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "アカウントを作成" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  return email;
}

/** 既存アカウントで /login からサインイン → /dashboard へ */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  // 「ログイン」はタブにも同名ボタンがあるためフォーム内を指定
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(TEST_PASSWORD);
  await page
    .locator("form")
    .getByRole("button", { name: "ログイン" })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

/**
 * オンボーディング画面で最初の事業を作成する。
 * セッションCookieは signed_in 遷移前にPOST済みのため、
 * オンボーディングが表示された時点で Server Action が使える。
 */
export async function createFirstBusiness(
  page: Page,
  name = "E2Eテスト事業",
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "事業を作成しましょう" }),
  ).toBeVisible();
  await page.getByLabel("事業名").fill(name);
  await page.getByRole("button", { name: "事業を作成する" }).click();
  const switcher = page.getByRole("combobox", { name: "事業の切り替え" });
  await expect(switcher.locator("option:checked")).toHaveText(name);
  await expect(
    page.getByRole("heading", { name: "ダッシュボード", exact: true }),
  ).toBeVisible();
}

/** 新規登録 + 最初の事業作成まで行い、メールアドレスを返す */
export async function signUpAndCreateBusiness(
  page: Page,
  businessName = "E2Eテスト事業",
): Promise<string> {
  const email = await signUp(page);
  await createFirstBusiness(page, businessName);
  return email;
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export interface TransactionDraftInput {
  amount?: string;
  accountLabel?: string;
  counterparty?: string;
  description?: string;
  date?: string;
}

/**
 * /transactions から下書き取引を1件登録する。
 * 登録した行が一覧に表示されるまで待ってから返る。
 */
export async function createTransactionDraft(
  page: Page,
  input: TransactionDraftInput = {},
): Promise<void> {
  const {
    amount = "12000",
    accountLabel = "消耗品費",
    counterparty = "テスト商店",
    description = "E2E備品購入",
    date,
  } = input;
  await page.goto("/transactions");
  await page.getByRole("button", { name: "取引を登録" }).click();
  const form = page.locator("form");
  if (date) await form.getByLabel("日付").fill(date);
  await form.getByLabel("金額(円)").fill(amount);
  await form
    .getByRole("combobox", { name: "勘定科目", exact: true })
    .selectOption({ label: accountLabel });
  await form.getByLabel("取引先").fill(counterparty);
  await form.getByLabel("摘要").fill(description);
  await form.getByRole("button", { name: "下書きとして登録" }).click();
  await expect(
    page.getByRole("row", { name: new RegExp(counterparty) }),
  ).toBeVisible();
}
