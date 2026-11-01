"use server";

import { listAuditLogsRaw, listMembers } from "@/lib/api/queries";
import { run, type ActionResult } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";

export interface AuditLogRow {
  /** auditLogs ドキュメントID */
  id: string;
  actorUid: string;
  /** メンバーの表示名またはメールアドレス。解決できない場合は null */
  actorName: string | null;
  action: string;
  targetPath: string;
  /** ISO 8601 */
  createdAt: string;
}

/**
 * 監査ログ一覧(viewer以上・読み取り専用)。
 * 並び替え・絞り込みは画面側で行い、ここでは識別情報と
 * actorUid → メンバー名の解決だけを行う。
 */
export async function listAuditLogs(
  businessId: string,
): Promise<ActionResult<AuditLogRow[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const [logs, members] = await Promise.all([
      listAuditLogsRaw(businessId),
      // 名前解決に失敗してもログ自体は表示する
      listMembers(businessId).catch(() => []),
    ]);
    const nameByUid = new Map(
      members.map((m) => [m.uid, m.displayName || m.email || ""]),
    );
    return logs.map((l) => {
      const actorUid = typeof l.actorUid === "string" ? l.actorUid : "";
      return {
        id: l.id,
        actorUid,
        actorName: nameByUid.get(actorUid) || null,
        action: typeof l.action === "string" ? l.action : "",
        targetPath: typeof l.targetPath === "string" ? l.targetPath : "",
        createdAt: typeof l.createdAt === "string" ? l.createdAt : "",
      };
    });
  });
}
