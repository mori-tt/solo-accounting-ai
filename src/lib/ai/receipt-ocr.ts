import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { AIProcessingError, AIResponseValidationError } from "./errors";
import { DEFAULT_OPENAI_MODEL } from "./llm-provider";
import type { AIProvider, AIRequest } from "./provider";

/**
 * 領収書OCR基盤。receipt_extraction の入力となる ocrText を
 * Storage上の証憑ファイル(画像/PDF)から生成する。
 * サーバーサイド専用: APIキーはNEXT_PUBLIC_ではない環境変数からのみ読み、
 * ブラウザ環境での実行を検知した場合は例外を投げる。
 * ファイル内容・抽出テキスト・SDKのエラーメッセージはログに出力しない
 * (証憑内容・個人情報を含み得るため)。
 */

/** OCRへ送れる証憑ファイルの上限。アップロード上限(10MB)と揃える */
export const DEFAULT_MAX_OCR_FILE_BYTES = 10 * 1024 * 1024;

/** OpenAI Responses APIが受け付ける画像MIME(image/heic等は非対応) */
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const PDF_MIME_TYPE = "application/pdf";

/** OCRへ送信可能な証憑のMIMEタイプかどうか */
export function isOcrSupportedMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType) || mimeType === PDF_MIME_TYPE;
}

const OCR_INSTRUCTIONS = `あなたは証憑(レシート/領収書)のOCRエンジンです。
画像またはPDFに写っている文字をすべて読み取り、見えたままのテキストをocrTextに出力してください。

ルール:
- 店名・日付・品目・金額・合計など、写っている情報を漏れなく転記する
- レイアウトはおおまかな行の並びを改行で再現する
- 推測や補完、説明文は書かない
- 読み取れない部分は無理に推測せず、読み取れる範囲だけを出力する`;

/** Structured Outputs(strict)でOCR結果をJSONに限定するスキーマ */
const OCR_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    ocrText: {
      type: "string",
      description: "証憑から読み取ったテキスト(改行を保持)",
    },
  },
  required: ["ocrText"],
};

/** OCR呼び出しに渡すファイル。画像はinput_image、PDFはinput_fileに対応 */
export type OcrInput =
  | { type: "image"; dataUrl: string }
  | { type: "file"; dataUrl: string; fileName: string };

/** OCRへの1回のテキスト抽出呼び出し */
export interface OcrCall {
  model: string;
  instructions: string;
  input: OcrInput;
}

/**
 * OCR呼び出しの最小抽象化。戻り値はモデルが生成したテキスト。
 * テストではSDKを介さない偽のcallerを注入できる。
 */
export type OcrCaller = (call: OcrCall) => Promise<string>;

export interface ReceiptOcrInput {
  /** 証憑ファイルのバイナリ */
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
}

/** 証憑ファイル→テキスト抽出の抽象化 */
export interface ReceiptOcr {
  extractText(input: ReceiptOcrInput): Promise<string>;
}

export interface OpenAIReceiptOcrDeps {
  caller: OcrCaller;
  model: string;
}

/**
 * OpenAIのビジョン対応モデルをバックエンドに持つReceiptOcr。
 * MIMEに応じて input_image(画像) / input_file(PDF) を使い分ける。
 */
export class OpenAIReceiptOcr implements ReceiptOcr {
  private readonly caller: OcrCaller;
  private readonly model: string;

  constructor(deps: OpenAIReceiptOcrDeps) {
    this.caller = deps.caller;
    this.model = deps.model;
  }

  async extractText(input: ReceiptOcrInput): Promise<string> {
    let text: string;
    try {
      text = await this.caller({
        model: this.model,
        instructions: OCR_INSTRUCTIONS,
        input: toOcrInput(input),
      });
    } catch (error) {
      if (error instanceof AIProcessingError) throw error;
      // SDKのエラーメッセージは証憑内容を含み得るため固定文言に置き換える
      throw new AIProcessingError(
        "provider_error",
        "AI provider request failed",
      );
    }
    return text.trim();
  }
}

/**
 * OpenAI公式SDK(Responses API)を使うOcrCallerを作る。サーバーサイド専用。
 * `store: false` でOpenAI側にファイル内容・レスポンスを保存させない。
 * 出力は `{"ocrText": "..."}` の構造化JSON(strict)に限定し、
 * パースして抽出テキストを返す。
 */
export function createOpenAIOcrCaller(client: OpenAI): OcrCaller {
  return async (call) => {
    assertServerSide();
    const content: ResponseInputContent[] =
      call.input.type === "image"
        ? [
            {
              type: "input_image",
              image_url: call.input.dataUrl,
              detail: "auto",
            },
          ]
        : [
            {
              type: "input_file",
              file_data: call.input.dataUrl,
              filename: call.input.fileName,
            },
          ];
    const response = await client.responses.create({
      model: call.model,
      instructions: call.instructions,
      input: [{ role: "user", content }],
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "receipt_ocr_result",
          schema: OCR_OUTPUT_SCHEMA,
          strict: true,
        },
      },
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      throw new AIResponseValidationError("AI response was not valid JSON");
    }
    const ocrText =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).ocrText
        : undefined;
    if (typeof ocrText !== "string") {
      throw new AIResponseValidationError("AI response missing ocrText");
    }
    return ocrText;
  };
}

/**
 * 環境変数からReceiptOcrを構築する。サーバーサイド専用。
 *
 * - `AI_OCR_PROVIDER=openai` かつ `OPENAI_API_KEY` 設定時:
 *   OpenAI Responses APIを使うOpenAIReceiptOcr
 *   (モデルは `OPENAI_OCR_MODEL`、省略時 `OPENAI_MODEL` → DEFAULT_OPENAI_MODEL)
 * - 未設定・`none`・未知の値・APIキー欠落時:
 *   null(OCR無効。receipt_extractionはクライアント指定のocrTextが無いと
 *   判断不能になるが、本体機能は妨げない)
 */
export function createReceiptOcr(
  env: Record<string, string | undefined> = process.env,
): ReceiptOcr | null {
  assertServerSide();
  const name = env.AI_OCR_PROVIDER;
  if (!name || name === "none") {
    return null;
  }
  if (name !== "openai") {
    // 設定値のみを通知し、入力データや鍵は含めない
    console.warn("[ai] unknown AI_OCR_PROVIDER; receipt OCR disabled");
    return null;
  }
  if (!env.OPENAI_API_KEY) {
    console.warn(
      "[ai] AI_OCR_PROVIDER=openai but OPENAI_API_KEY is not set; receipt OCR disabled",
    );
    return null;
  }
  return new OpenAIReceiptOcr({
    caller: createOpenAIOcrCaller(new OpenAI({ apiKey: env.OPENAI_API_KEY })),
    model:
      env.OPENAI_OCR_MODEL ?? env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
  });
}

/**
 * OCRが利用可能かどうか。createReceiptOcr() !== null と同じ判定だが、
 * クライアント構築や警告出力を伴わないためUIの有効/無効判定に使える。
 * サーバーサイド専用。
 */
export function isReceiptOcrAvailable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AI_OCR_PROVIDER === "openai" && Boolean(env.OPENAI_API_KEY);
}

/** ocrText生成に必要な証憑の参照情報(ドメインReceiptへの依存を避け構造だけ定義) */
export interface ReceiptFileRef {
  storagePath: string;
  mimeType: string;
  fileName: string;
}

export interface ReceiptOcrResolverDeps {
  /** ocrText注入後に委譲する提案プロバイダ */
  inner: AIProvider;
  /** nullの場合はOCRを行わず空のocrTextを注入する */
  ocr: ReceiptOcr | null;
  /** businessId内の証憑を引く(存在しない/他businessIdの対象はnull) */
  getReceipt: (
    businessId: string,
    receiptId: string,
  ) => Promise<ReceiptFileRef | null>;
  downloadFile: (storagePath: string) => Promise<Uint8Array>;
  maxFileBytes?: number;
}

/**
 * receipt_extraction の input.ocrText をサーバーサイドで生成するAIProvider。
 *
 * - 対象kind/receipt以外はinnerへそのまま委譲する
 * - クライアントが ocrText を指定済みの場合はそれを使う(Emulator/開発用)
 * - 未指定の場合は対象receiptのstoragePathからファイルを取得しOCRを実行する。
 *   証憑のstoragePathはサーバー登録済みの値のみ使うため、任意パス参照は起きない
 * - OCRの失敗はAIProcessingErrorとなり、service層で needs_review として記録される
 */
export class ReceiptOcrResolver implements AIProvider {
  private readonly inner: AIProvider;
  private readonly ocr: ReceiptOcr | null;
  private readonly getReceipt: ReceiptOcrResolverDeps["getReceipt"];
  private readonly downloadFile: ReceiptOcrResolverDeps["downloadFile"];
  private readonly maxFileBytes: number;

  constructor(deps: ReceiptOcrResolverDeps) {
    this.inner = deps.inner;
    this.ocr = deps.ocr;
    this.getReceipt = deps.getReceipt;
    this.downloadFile = deps.downloadFile;
    this.maxFileBytes = deps.maxFileBytes ?? DEFAULT_MAX_OCR_FILE_BYTES;
  }

  async generate(request: AIRequest): Promise<unknown> {
    if (
      request.kind !== "receipt_extraction" ||
      request.target.type !== "receipt"
    ) {
      return this.inner.generate(request);
    }
    const provided = request.input.ocrText;
    const ocrText =
      typeof provided === "string" && provided.length > 0
        ? provided
        : await this.resolveOcrText(request.businessId, request.target.id);
    return this.inner.generate({
      ...request,
      input: { ...request.input, ocrText },
    });
  }

  private async resolveOcrText(
    businessId: string,
    receiptId: string,
  ): Promise<string> {
    if (!this.ocr) return "";
    const receipt = await this.getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new AIProcessingError(
        "provider_error",
        "receipt file unavailable",
      );
    }
    const data = await this.downloadFile(receipt.storagePath);
    if (data.byteLength > this.maxFileBytes) {
      throw new AIProcessingError(
        "provider_error",
        "receipt file too large for OCR",
      );
    }
    return this.ocr.extractText({
      data,
      mimeType: receipt.mimeType,
      fileName: receipt.fileName,
    });
  }
}

function toOcrInput(input: ReceiptOcrInput): OcrInput {
  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.data).toString("base64")}`;
  if (IMAGE_MIME_TYPES.has(input.mimeType)) {
    return { type: "image", dataUrl };
  }
  if (input.mimeType === PDF_MIME_TYPE) {
    return {
      type: "file",
      dataUrl,
      fileName: input.fileName ?? "receipt.pdf",
    };
  }
  throw new AIProcessingError(
    "provider_error",
    "unsupported receipt mime type for OCR",
  );
}

function assertServerSide(): void {
  if (typeof window !== "undefined") {
    throw new Error("receipt OCR must only run on the server");
  }
}
