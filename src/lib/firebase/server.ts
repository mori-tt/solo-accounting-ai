import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "./admin";

// サーバーサイド(Route Handler / Server Action / Cloud Functions)共通処理。
// Admin SDKはSecurity Rulesをバイパスするため、ここで認証・認可を必ず検証する。

export type MemberRole = "owner" | "editor" | "viewer";

const MEMBER_ROLES: readonly MemberRole[] = ["owner", "editor", "viewer"];

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

// Authorization: Bearer <idToken> ヘッダからトークンを取り出す
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length) || null;
}

export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  return getAdminAuth().verifyIdToken(idToken);
}

// RequestからIDトークンを取り出して検証し、認証済みユーザーを返す
export async function authenticate(request: Request): Promise<DecodedIdToken> {
  const token = bearerToken(request);
  if (!token) throw new UnauthorizedError("missing bearer token");
  try {
    return await verifyIdToken(token);
  } catch {
    throw new UnauthorizedError("invalid id token");
  }
}

export async function getMemberRole(
  businessId: string,
  uid: string,
): Promise<MemberRole | null> {
  const snap = await getAdminDb()
    .doc(`businesses/${businessId}/members/${uid}`)
    .get();
  const role = snap.get("role");
  return MEMBER_ROLES.includes(role) ? role : null;
}

// businessIdのメンバーシップとロールを検証する。非メンバー・権限不足はForbiddenError
export async function requireMemberRole(
  businessId: string,
  uid: string,
  allowed: readonly MemberRole[] = MEMBER_ROLES,
): Promise<MemberRole> {
  const role = await getMemberRole(businessId, uid);
  if (!role || !allowed.includes(role)) {
    throw new ForbiddenError(`insufficient role for business ${businessId}`);
  }
  return role;
}

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "close"
  | "approve_ai";

// 監査ログを追記する。対象の識別情報のみ記録し、
// 個人情報・証憑内容のスナップショットは保存しない(SECURITY_RULES.md)
export async function writeAuditLog(params: {
  businessId: string;
  actorUid: string;
  action: AuditAction;
  targetPath: string;
}): Promise<string> {
  const ref = await getAdminDb()
    .collection(`businesses/${params.businessId}/auditLogs`)
    .add({
      actorUid: params.actorUid,
      action: params.action,
      targetPath: params.targetPath,
      createdAt: FieldValue.serverTimestamp(),
    });
  return ref.id;
}

export type AiSuggestionType =
  | "receipt_extraction"
  | "account_suggestion"
  | "journal_candidate"
  | "duplicate_detection"
  | "monthly_explanation";

// aiSuggestionsコレクションはAdmin SDKからのみ生成する
// (Security Rulesでクライアント作成を禁止済み。AI_POLICY.md/ADR-0005参照)
export async function createAiSuggestion(params: {
  businessId: string;
  type: AiSuggestionType;
  targetPath: string;
  suggestion: Record<string, unknown>;
  confidence: number;
}): Promise<string> {
  const ref = await getAdminDb()
    .collection(`businesses/${params.businessId}/aiSuggestions`)
    .add({
      type: params.type,
      targetPath: params.targetPath,
      suggestion: params.suggestion,
      confidence: params.confidence,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  return ref.id;
}
