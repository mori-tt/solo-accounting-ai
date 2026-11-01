import type { SuggestionKind, SuggestionTarget } from "./types";

/**
 * AIへの入力。証憑のOCRテキストや取引・月次集計など、
 * 処理に必要な最小限のデータのみを渡すこと(個人情報は最小化)。
 */
export interface AIRequest {
  kind: SuggestionKind;
  businessId: string;
  target: SuggestionTarget;
  input: Record<string, unknown>;
}

/**
 * AIプロバイダの抽象化。戻り値は生のJSON相当の値。
 * 形の検証はサービス側(schemas.ts)で行う。
 * 実装は外部APIでもローカル推論でもよい。
 */
export interface AIProvider {
  generate(request: AIRequest): Promise<unknown>;
}
