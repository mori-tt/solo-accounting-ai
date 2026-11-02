import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

// firebase emulators:exec 経由で起動したEmulatorに接続する。
// FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST は自動設定される。
export const PROJECT_ID = "demo-solo-accounting-ai";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function hostPort(envValue: string | undefined, fallbackPort: number) {
  const value = envValue ?? `localhost:${fallbackPort}`;
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
}

export function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080),
      rules: readFileSync(resolve(ROOT, "firestore.rules"), "utf8"),
    },
    storage: {
      ...hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199),
      rules: readFileSync(resolve(ROOT, "storage.rules"), "utf8"),
    },
  });
}

// ---------- テスト用ID ----------

export const OWNER = "owner-uid";
export const EDITOR = "editor-uid";
export const VIEWER = "viewer-uid";
export const OUTSIDER = "outsider-uid";

export const BIZ = "biz-a";
export const OTHER_BIZ = "biz-b";

// ---------- クライアントコンテキスト ----------

export function anon(env: RulesTestEnvironment) {
  return env.unauthenticatedContext().firestore();
}

export function asUser(env: RulesTestEnvironment, uid: string) {
  return env.authenticatedContext(uid).firestore();
}

// ---------- シード(Rules無効化 = Admin SDK相当) ----------

export async function seed(
  env: RulesTestEnvironment,
  writes: Record<string, Record<string, unknown>>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of Object.entries(writes)) {
      await db.doc(path).set(data);
    }
  });
}

export function seedBusiness(
  env: RulesTestEnvironment,
  businessId: string,
  members: Record<string, "owner" | "editor" | "viewer">,
  ownerUid: string,
): Promise<void> {
  const writes: Record<string, Record<string, unknown>> = {
    [`businesses/${businessId}`]: {
      name: "テスト事業",
      ownerUid,
      fiscalYearStartMonth: 1,
      taxMode: "standard",
    },
  };
  for (const [uid, role] of Object.entries(members)) {
    writes[`businesses/${businessId}/members/${uid}`] = {
      role,
      invitedBy: ownerUid,
    };
  }
  return seed(env, writes);
}

// ---------- ドキュメントフィクスチャ ----------

export function tx(status: "draft" | "confirmed" | "locked" = "draft") {
  return {
    type: "expense",
    date: "2026-10-15",
    amount: 1000,
    account: "501",
    counterparty: "テスト商店",
    description: "消耗品",
    receiptIds: [],
    status,
    createdBy: "seed",
  };
}

export function expense(
  status: "draft" | "confirmed" | "locked" = "draft",
  extra: Record<string, unknown> = {},
) {
  return {
    taxCategory: "課税仕入",
    taxAmount: 100,
    status,
    createdBy: "seed",
    ...extra,
  };
}

export function journalEntry(status: "draft" | "confirmed" | "locked" = "draft") {
  return {
    date: "2026-10-15",
    description: "消耗品購入",
    lines: [
      { account: "501", debit: 1000, credit: 0 },
      { account: "101", debit: 0, credit: 1000 },
    ],
    sourceType: "expense",
    sourceId: "e1",
    status,
    createdBy: "seed",
  };
}

export function aiSuggestion(
  status: "pending" | "accepted" | "rejected" | "needs_review" = "pending",
) {
  return {
    kind: "receipt_extraction",
    target: { type: "receipt", id: "r1" },
    status,
    payload: { amount: 1000, date: "2026-10-15", vendor: "テスト商店" },
    confidence: 0.9,
    reason: "seed",
    issues: [],
    attempts: 1,
    retriable: true,
    lastError: null,
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    createdBy: "system",
  };
}

export function closingCheck(status: "open" | "resolved" | "waived" = "open") {
  return {
    fiscalPeriodId: "p1",
    type: "missing_receipt",
    targetPath: `businesses/${BIZ}/transactions/t1`,
    message: "証憑が未添付です",
    status,
    createdBy: "system",
  };
}

export function receipt(status = "unprocessed") {
  return {
    storagePath: `receipts/${BIZ}/r1/file.png`,
    fileName: "file.png",
    mimeType: "image/png",
    status,
    createdBy: "seed",
  };
}

export function recurringTemplate(extra: Record<string, unknown> = {}) {
  return {
    name: "事務所家賃",
    type: "expense",
    account: "rent",
    counterparty: "大家",
    description: "毎月の家賃",
    amount: 100000,
    dayOfMonth: 25,
    active: true,
    createdBy: "seed",
    ...extra,
  };
}

export function fixedAsset(extra: Record<string, unknown> = {}) {
  return {
    name: "複合機",
    acquiredDate: "2026-01-15",
    acquisitionCost: 300000,
    usefulLifeYears: 5,
    method: "straightLine",
    businessRatio: 80,
    status: "active",
    createdBy: "seed",
    ...extra,
  };
}

export function fiscalPeriod(status: "open" | "closed" = "open") {
  const closed = status === "closed";
  return {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status,
    ...(closed ? { closedBy: OWNER } : {}),
  };
}
