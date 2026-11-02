"use server";

import { writeAuditLog } from "@/lib/api/queries";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor } from "@/lib/api/session";
import { isImportKind, type ImportKind } from "@/lib/audit-log-view";

/**
 * CSVインポートの実行を監査ログへ記録する。
 * 監査ログは識別情報のみ持つため、実行の種別と登録件数は
 * `imports/{kind}:{count}` 形式の擬似 targetPath に含める
 * (実コレクションではない。明細内容・ファイル名は記録しない)。
 */
export async function recordImportRun(
  businessId: string,
  input: { kind: ImportKind; count: number },
): Promise<ActionResult<null>> {
  if (!isImportKind(input?.kind)) {
    return fail("INVALID_INPUT", "インポート種別が不正です");
  }
  const count = Math.max(0, Math.floor(input.count));
  return run(async () => {
    const actor = await requireEditor(businessId);
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "import",
      targetPath: `businesses/${businessId}/imports/${input.kind}:${count}`,
    });
    return null;
  });
}
