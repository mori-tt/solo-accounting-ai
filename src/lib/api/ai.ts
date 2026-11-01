import { FirestoreSuggestionStore } from "@/lib/ai/firestore-store";
import { createAIProvider } from "@/lib/ai/llm-provider";
import {
  createReceiptOcr,
  ReceiptOcrResolver,
} from "@/lib/ai/receipt-ocr";
import { AISuggestionService } from "@/lib/ai/service";
import {
  KIND_TARGET_TYPE,
  type SuggestionKind,
  type SuggestionTarget,
} from "@/lib/ai/types";
import { getAdminBucket, getAdminDb } from "@/lib/firebase/admin";
import { ApiError } from "./result";
import { getStore } from "./store";

let service: AISuggestionService | undefined;

/**
 * AI提案サービスのサーバーサイド組み立て。
 * Route Handlerからのみ呼ぶこと(プロバイダのAPIキーを含むためサーバー専用。
 * llm-provider.ts側でもブラウザ実行検知のガードあり)。
 * 呼び出し前に session.ts の requireViewer/requireEditor で認可済みであること。
 */
export function getAISuggestionService(): AISuggestionService {
  service ??= new AISuggestionService({
    store: new FirestoreSuggestionStore(getAdminDb()),
    // receipt_extraction の ocrText はStorage上の証憑ファイルから
    // サーバーサイドで生成する(receipt-ocr.ts)。クライアント指定の
    // ocrText も引き続き使える(Emulator/開発用)。
    provider: new ReceiptOcrResolver({
      inner: createAIProvider(),
      ocr: createReceiptOcr(),
      getReceipt: async (businessId, receiptId) =>
        (await getStore().getReceipt(businessId, receiptId)) ?? null,
      downloadFile: async (storagePath) => {
        const [buffer] = await getAdminBucket()
          .file(storagePath)
          .download();
        return buffer;
      },
    }),
  });
  return service;
}

/**
 * 提案の対象を検証する。
 * - kindとtarget.typeの組み合わせが正しいこと(例: receipt_extractionはreceiptのみ)
 * - 対象ドキュメントがbusinessId内に存在すること
 *   (businessIdをまたいだ対象・存在しない対象への提案生成を防ぐ)
 */
export async function assertSuggestionTarget(
  businessId: string,
  kind: SuggestionKind,
  target: SuggestionTarget,
): Promise<void> {
  if (KIND_TARGET_TYPE[kind] !== target.type) {
    throw new ApiError(
      "INVALID_INPUT",
      "提案の種別と対象データの種類が一致しません",
    );
  }
  const store = getStore();
  const found =
    target.type === "receipt"
      ? await store.getReceipt(businessId, target.id)
      : target.type === "transaction"
        ? await store.getTransaction(businessId, target.id)
        : await store.getMonthlySummary(businessId, target.id);
  if (!found) {
    throw new ApiError("NOT_FOUND", "対象データが見つかりません");
  }
}
