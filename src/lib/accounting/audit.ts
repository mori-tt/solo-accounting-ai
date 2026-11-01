import { DomainError } from "./errors";
import type { AuditAction, AuditLogEntry } from "./types";

/**
 * 監査ログは対象の識別情報(actorUid / action / targetPath)のみ記録する。
 * 個人情報・証憑内容・金額などのスナップショットは含めない
 * (docs/SECURITY_RULES.md)。
 */
export function buildAuditEntry(input: {
  id: string;
  actorUid: string;
  action: AuditAction;
  targetPath: string;
  at: string;
}): AuditLogEntry {
  if (!input.actorUid) {
    throw new DomainError("NOT_FOUND", "audit entry requires actorUid");
  }
  return {
    id: input.id,
    actorUid: input.actorUid,
    action: input.action,
    targetPath: input.targetPath,
    createdAt: input.at,
  };
}
