import { connection } from "next/server";
import { logger } from "@/lib/monitoring";

/**
 * 生存確認(liveness)。認証不要・個人情報を一切含まない固定構造のみ返す。
 * `connection()` でビルド時プリレンダを抑止し、毎リクエスト実行する。
 *
 * DB疎通は Emulator 環境(FIRESTORE_EMULATOR_HOST 設定時)のみ試行する。
 * 本番の疎通確認は資格情報・到達性が環境依存のため省略し、
 * checks.db = "skipped" を返す(生存確認はプロセスの応答性のみを保証)。
 * db=error でもプロセス自体は応答しているため HTTP 200 のまま返し、
 * 障害はボディの checks と構造化ログで表現する。
 */

const DB_CHECK_TIMEOUT_MS = 1000;

type DbStatus = "ok" | "error" | "skipped";

async function checkDb(env: NodeJS.ProcessEnv = process.env): Promise<DbStatus> {
  if (!env.FIRESTORE_EMULATOR_HOST?.trim()) return "skipped";
  try {
    // Emulator 不使用時に admin SDK を読み込まないよう遅延 import
    const { getAdminDb } = await import("@/lib/firebase/admin");
    await Promise.race([
      getAdminDb().listCollections(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("db check timeout")), DB_CHECK_TIMEOUT_MS),
      ),
    ]);
    return "ok";
  } catch {
    return "error";
  }
}

export async function GET() {
  await connection();
  const db = await checkDb();
  if (db === "error") {
    logger.warn("health check: db unreachable", { route: "/api/health" });
  }
  return Response.json({
    ok: true,
    service: "solo-accounting-ai",
    timestamp: new Date().toISOString(),
    checks: { db },
  });
}
