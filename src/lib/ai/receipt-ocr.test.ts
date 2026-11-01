// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { AIProcessingError, AIResponseValidationError } from "./errors";
import { HeuristicAIProvider } from "./heuristic-provider";
import type { AIProvider, AIRequest } from "./provider";
import {
  createOpenAIOcrCaller,
  createReceiptOcr,
  OpenAIReceiptOcr,
  ReceiptOcrResolver,
  type OcrCall,
  type ReceiptOcr,
} from "./receipt-ocr";
import { AISuggestionService } from "./service";
import { InMemorySuggestionStore } from "./store";

const BUSINESS_ID = "biz-1";

const RECEIPT_REQUEST: AIRequest = {
  kind: "receipt_extraction",
  businessId: BUSINESS_ID,
  target: { type: "receipt", id: "rcpt-1" },
  input: {},
};

function fakeOcrCaller(output: string) {
  const calls: OcrCall[] = [];
  return {
    calls,
    caller: async (call: OcrCall) => {
      calls.push(call);
      return output;
    },
  };
}

function recordingProvider(result: unknown = {}) {
  const requests: AIRequest[] = [];
  const provider: AIProvider = {
    async generate(request) {
      requests.push(request);
      return result;
    },
  };
  return { requests, provider };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createReceiptOcr(プロバイダ選択)", () => {
  it("環境変数未設定時はnull(OCR無効)を返す", () => {
    expect(createReceiptOcr({})).toBeNull();
  });

  it("AI_OCR_PROVIDER=noneでもnullを返す", () => {
    expect(createReceiptOcr({ AI_OCR_PROVIDER: "none" })).toBeNull();
  });

  it("AI_OCR_PROVIDER=openaiかつOPENAI_API_KEY設定時はOpenAIReceiptOcrを返す", () => {
    const ocr = createReceiptOcr({
      AI_OCR_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(ocr).toBeInstanceOf(OpenAIReceiptOcr);
  });

  it("openai指定だがAPIキーが無い場合は警告してnullを返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createReceiptOcr({ AI_OCR_PROVIDER: "openai" })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("未知のプロバイダ名は警告してnullを返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createReceiptOcr({ AI_OCR_PROVIDER: "tesseract" })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("OpenAIReceiptOcr.extractText", () => {
  it("画像はdata URLのinput_imageとしてcallerへ渡す", async () => {
    const { calls, caller } = fakeOcrCaller("合計 1,280円");
    const ocr = new OpenAIReceiptOcr({ caller, model: "vision-m" });

    const text = await ocr.extractText({
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      fileName: "receipt.jpg",
    });

    expect(text).toBe("合計 1,280円");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("vision-m");
    expect(calls[0].instructions.length).toBeGreaterThan(0);
    const input = calls[0].input;
    expect(input.type).toBe("image");
    if (input.type === "image") {
      expect(input.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    }
  });

  it("PDFはfileName付きのinput_fileとしてcallerへ渡す", async () => {
    const { calls, caller } = fakeOcrCaller("領収書");
    const ocr = new OpenAIReceiptOcr({ caller, model: "m" });

    await ocr.extractText({
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mimeType: "application/pdf",
      fileName: "領収書.pdf",
    });

    const input = calls[0].input;
    expect(input.type).toBe("file");
    if (input.type === "file") {
      expect(input.fileName).toBe("領収書.pdf");
      expect(input.dataUrl.startsWith("data:application/pdf;base64,")).toBe(
        true,
      );
    }
  });

  it("非対応MIME(HEIC等)はprovider_errorになりcallerを呼ばない", async () => {
    const { calls, caller } = fakeOcrCaller("");
    const ocr = new OpenAIReceiptOcr({ caller, model: "m" });

    const err = await ocr
      .extractText({
        data: new Uint8Array([0x00]),
        mimeType: "image/heic",
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AIProcessingError);
    expect((err as AIProcessingError).code).toBe("provider_error");
    expect(calls).toHaveLength(0);
  });

  it("callerが失敗した場合は証憑内容を含まないprovider_errorに正規化する", async () => {
    const ocr = new OpenAIReceiptOcr({
      caller: async () => {
        throw new Error("openai api error: '合計1,280円' rejected");
      },
      model: "m",
    });

    const err = await ocr
      .extractText({ data: new Uint8Array([0x01]), mimeType: "image/png" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AIProcessingError);
    expect((err as AIProcessingError).code).toBe("provider_error");
    expect((err as AIProcessingError).message).not.toContain("合計");
  });
});

describe("createOpenAIOcrCaller", () => {
  function fakeClient(outputText = JSON.stringify({ ocrText: "読み取り結果" })) {
    const create = vi.fn<
      (params: Record<string, unknown>) => Promise<{ output_text: string }>
    >(async () => ({ output_text: outputText }));
    return {
      create,
      client: { responses: { create } } as unknown as OpenAI,
    };
  }

  it("store:false・構造化JSON出力でResponses APIを呼び、ocrTextを返す", async () => {
    const { create, client } = fakeClient();
    const caller = createOpenAIOcrCaller(client);

    const text = await caller({
      model: "m",
      instructions: "inst",
      input: { type: "image", dataUrl: "data:image/png;base64,AAAA" },
    });

    expect(text).toBe("読み取り結果");
    expect(create).toHaveBeenCalledOnce();
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("m");
    expect(params.instructions).toBe("inst");
    expect(params.store).toBe(false);
    const format = (params.text as { format: Record<string, unknown> }).format;
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    const input = params.input as {
      role: string;
      content: Record<string, unknown>[];
    }[];
    expect(input[0].role).toBe("user");
    expect(input[0].content[0].type).toBe("input_image");
    expect(input[0].content[0].image_url).toBe("data:image/png;base64,AAAA");
  });

  it("出力がJSONでない場合はinvalid_responseになる", async () => {
    const { client } = fakeClient("not json");
    const caller = createOpenAIOcrCaller(client);

    const err = await caller({
      model: "m",
      instructions: "inst",
      input: { type: "image", dataUrl: "data:image/png;base64,AAAA" },
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AIResponseValidationError);
    expect((err as AIProcessingError).code).toBe("invalid_response");
  });

  it("PDFはinput_fileのfile_dataとして送る", async () => {
    const { create, client } = fakeClient();
    const caller = createOpenAIOcrCaller(client);

    await caller({
      model: "m",
      instructions: "inst",
      input: {
        type: "file",
        dataUrl: "data:application/pdf;base64,JVBER",
        fileName: "receipt.pdf",
      },
    });

    const params = create.mock.calls[0][0];
    const input = params.input as {
      content: Record<string, unknown>[];
    }[];
    expect(input[0].content[0].type).toBe("input_file");
    expect(input[0].content[0].file_data).toBe(
      "data:application/pdf;base64,JVBER",
    );
    expect(input[0].content[0].filename).toBe("receipt.pdf");
  });
});

describe("ReceiptOcrResolver", () => {
  const receiptFile = {
    storagePath: "receipts/biz-1/rcpt-1/receipt.jpg",
    mimeType: "image/jpeg",
    fileName: "receipt.jpg",
  };

  function resolverDeps(overrides: {
    inner?: AIProvider;
    ocr?: ReceiptOcr | null;
    getReceipt?: () => Promise<typeof receiptFile | null>;
    downloadFile?: (path: string) => Promise<Uint8Array>;
  }) {
    const { provider } = recordingProvider();
    const downloads: string[] = [];
    return {
      downloads,
      deps: {
        inner: overrides.inner ?? provider,
        ocr: overrides.ocr ?? null,
        getReceipt:
          overrides.getReceipt ?? (async () => receiptFile),
        downloadFile:
          overrides.downloadFile ??
          (async (path: string) => {
            downloads.push(path);
            return new Uint8Array([0x01, 0x02]);
          }),
      },
    };
  }

  it("receipt_extraction以外のkindはinnerへそのまま委譲する", async () => {
    const { requests, provider } = recordingProvider({ candidates: [] });
    const ocr: ReceiptOcr = {
      extractText: async () => {
        throw new Error("must not be called");
      },
    };
    const { deps, downloads } = resolverDeps({ inner: provider, ocr });
    const resolver = new ReceiptOcrResolver(deps);

    const request: AIRequest = {
      kind: "monthly_explanation",
      businessId: BUSINESS_ID,
      target: { type: "monthlySummary", id: "202610" },
      input: { summary: { totalIncome: 1 } },
    };
    await resolver.generate(request);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toBe(request);
    expect(downloads).toHaveLength(0);
  });

  it("クライアント指定のocrTextがあればOCRを実行せずそのまま使う", async () => {
    const { requests, provider } = recordingProvider();
    const ocr: ReceiptOcr = {
      extractText: async () => {
        throw new Error("must not be called");
      },
    };
    const { deps, downloads } = resolverDeps({ inner: provider, ocr });
    const resolver = new ReceiptOcrResolver(deps);

    await resolver.generate({
      ...RECEIPT_REQUEST,
      input: { ocrText: "合計 500円 商店" },
    });

    expect(downloads).toHaveLength(0);
    expect(requests[0].input.ocrText).toBe("合計 500円 商店");
  });

  it("ocrText未指定時は証憑ファイルをOCRしてinnerへ注入する", async () => {
    const { requests, provider } = recordingProvider();
    const extractText = vi.fn(async () => "合計 1,280円 2026年10月1日 商店");
    const { deps, downloads } = resolverDeps({
      inner: provider,
      ocr: { extractText },
    });
    const resolver = new ReceiptOcrResolver(deps);

    await resolver.generate(RECEIPT_REQUEST);

    expect(downloads).toEqual([receiptFile.storagePath]);
    expect(extractText).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      mimeType: "image/jpeg",
      fileName: "receipt.jpg",
    });
    expect(requests[0].input.ocrText).toBe(
      "合計 1,280円 2026年10月1日 商店",
    );
    expect(requests[0].target).toEqual(RECEIPT_REQUEST.target);
  });

  it("OCRプロバイダ未設定(null)の場合は空のocrTextでinnerへ委譲する", async () => {
    const { requests, provider } = recordingProvider();
    const { deps, downloads } = resolverDeps({
      inner: provider,
      ocr: null,
      getReceipt: async () => {
        throw new Error("must not be called");
      },
    });
    const resolver = new ReceiptOcrResolver(deps);

    await resolver.generate(RECEIPT_REQUEST);

    expect(downloads).toHaveLength(0);
    expect(requests[0].input.ocrText).toBe("");
  });

  it("対象の証憑が存在しない場合はprovider_errorになる", async () => {
    const { provider } = recordingProvider();
    const { deps } = resolverDeps({
      inner: provider,
      ocr: { extractText: async () => "text" },
      getReceipt: async () => null,
    });
    const resolver = new ReceiptOcrResolver(deps);

    const err = await resolver.generate(RECEIPT_REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(AIProcessingError);
    expect((err as AIProcessingError).code).toBe("provider_error");
  });

  it("上限を超えるファイルはprovider_errorになる", async () => {
    const { provider } = recordingProvider();
    const { deps } = resolverDeps({
      inner: provider,
      ocr: {
        extractText: async () => {
          throw new Error("must not be called");
        },
      },
      downloadFile: async () => new Uint8Array(11 * 1024 * 1024),
    });
    const resolver = new ReceiptOcrResolver(deps);

    const err = await resolver.generate(RECEIPT_REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(AIProcessingError);
    expect((err as AIProcessingError).code).toBe("provider_error");
  });
});

describe("ReceiptOcrResolver + AISuggestionService統合", () => {
  it("OCR生成テキストで証憑抽出の提案がpendingになる", async () => {
    const store = new InMemorySuggestionStore();
    const service = new AISuggestionService({
      store,
      provider: new ReceiptOcrResolver({
        inner: new HeuristicAIProvider(),
        ocr: {
          extractText: async () => "商店\n合計 1,280円\n2026年10月1日",
        },
        getReceipt: async () => ({
          storagePath: "receipts/biz-1/rcpt-1/receipt.jpg",
          mimeType: "image/jpeg",
          fileName: "receipt.jpg",
        }),
        downloadFile: async () => new Uint8Array([0x01]),
      }),
    });

    const s = await service.run({
      businessId: BUSINESS_ID,
      kind: "receipt_extraction",
      target: { type: "receipt", id: "rcpt-1" },
      input: {},
      actorUid: "user-1",
    });

    expect(s.status).toBe("pending");
    expect(s.payload).toMatchObject({ amount: 1280, date: "2026-10-01" });
    expect(store.auditLogEntries(BUSINESS_ID)[0].action).toBe("run_ai");
  });

  it("OCR失敗時はneeds_reviewになり再実行できる", async () => {
    const store = new InMemorySuggestionStore();
    const service = new AISuggestionService({
      store,
      provider: new ReceiptOcrResolver({
        inner: new HeuristicAIProvider(),
        ocr: {
          extractText: async () => {
            throw new AIProcessingError("provider_error", "ocr failed");
          },
        },
        getReceipt: async () => ({
          storagePath: "receipts/biz-1/rcpt-1/receipt.jpg",
          mimeType: "image/jpeg",
          fileName: "receipt.jpg",
        }),
        downloadFile: async () => new Uint8Array([0x01]),
      }),
    });

    const s = await service.run({
      businessId: BUSINESS_ID,
      kind: "receipt_extraction",
      target: { type: "receipt", id: "rcpt-1" },
      input: {},
      actorUid: "user-1",
    });

    expect(s.status).toBe("needs_review");
    expect(s.lastError?.code).toBe("provider_error");
    expect(s.retriable).toBe(true);
  });
});
