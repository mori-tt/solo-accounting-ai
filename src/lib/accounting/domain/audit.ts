import type { AuditAction, AuditLogEntity } from "./types";

export function businessDocPath(
  businessId: string,
  collection: string,
  docId: string,
): string {
  return `businesses/${businessId}/${collection}/${docId}`;
}

export function buildAuditLog(input: {
  id: string;
  actorUid: string;
  action: AuditAction;
  targetPath: string;
  createdAt: Date;
}): AuditLogEntity {
  return {
    id: input.id,
    actorUid: input.actorUid,
    action: input.action,
    targetPath: input.targetPath,
    createdAt: input.createdAt,
  };
}
