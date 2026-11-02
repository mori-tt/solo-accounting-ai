import { readRequestText } from "@/lib/api/body";
import { writeAuditLog } from "@/lib/api/queries";
import {
  backupExportRateLimiter,
  backupRestoreRateLimiter,
} from "@/lib/api/rate-limit";
import { ApiError, toErrorResponse } from "@/lib/api/result";
import { requireEditor, requireOwner, requireUid } from "@/lib/api/session";
import {
  backupFileSchema,
  exportBusinessBackup,
  restoreBusinessBackup,
} from "@/lib/backup";
import { getAdminDb } from "@/lib/firebase/admin";

/** 復元リクエストのJSONボディ上限(暴走防止。証憑メタのみのため十分な上限) */
const MAX_BACKUP_BODY_BYTES = 64 * 1024 * 1024;

/**
 * 全データのJSONバックアップをダウンロードする。
 * GET /api/backup?businessId=...
 * owner/editorのみ。Storageのファイル本体は含めずメタデータのみ。
 */
export async function GET(request: Request) {
  try {
    const businessId =
      new URL(request.url).searchParams.get("businessId") ?? "";
    if (!businessId) {
      throw new ApiError("INVALID_INPUT", "businessId が必要です");
    }
    await requireEditor(businessId);
    // 全データ読み出しの重い処理のため businessId 単位で制限
    backupExportRateLimiter.consume(businessId);
    const backup = await exportBusinessBackup(getAdminDb(), businessId);
    const date = backup.exportedAt.slice(0, 10);
    return new Response(JSON.stringify(backup), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="backup-${businessId}-${date}.json"`,
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/**
 * バックアップJSONを事業へ復元(マージ)する。
 * POST /api/backup  body: { businessId, backup }
 * 事業データを大きく書き換える操作のためownerのみ。
 * 既存データは残し、ID衝突時は新規採番する。storagePathが指す
 * ファイル本体はコピーしない(メタデータのみの復元)。
 */
export async function POST(request: Request) {
  try {
    // ボディ解析前に認証のみ先行(R2-5)。実バイト数の上限は
    // ストリーム読みで強制する(content-length は迂回可能)
    await requireUid();
    const text = await readRequestText(request, MAX_BACKUP_BODY_BYTES);
    const body = (() => {
      try {
        return JSON.parse(text) as {
          businessId?: unknown;
          backup?: unknown;
        };
      } catch {
        throw new ApiError("INVALID_INPUT", "JSONボディが不正です");
      }
    })();
    const businessId =
      typeof body?.businessId === "string" ? body.businessId : "";
    if (!businessId) {
      throw new ApiError("INVALID_INPUT", "businessId が必要です");
    }
    const actor = await requireOwner(businessId);
    // 全件書き込みを伴う復元のため businessId 単位で厳しめに制限
    backupRestoreRateLimiter.consume(businessId);
    const parsed = backupFileSchema.safeParse(body.backup);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_INPUT",
        "バックアップファイルの構造が不正です",
      );
    }
    const result = await restoreBusinessBackup(
      getAdminDb(),
      businessId,
      parsed.data,
      actor,
    );
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "update",
      targetPath: `businesses/${businessId}`,
    });
    return Response.json({ ok: true, data: result });
  } catch (e) {
    return toErrorResponse(e);
  }
}
