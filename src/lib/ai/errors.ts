import type { SuggestionErrorCode } from "./types";

/** AI処理の失敗。messageには個人情報・証憑内容を含めない */
export class AIProcessingError extends Error {
  readonly code: SuggestionErrorCode;

  constructor(code: SuggestionErrorCode, message: string) {
    super(message);
    this.name = "AIProcessingError";
    this.code = code;
  }
}

export class AITimeoutError extends AIProcessingError {
  constructor(timeoutMs: number) {
    super("timeout", `AI request timed out after ${timeoutMs}ms`);
    this.name = "AITimeoutError";
  }
}

export class AIResponseValidationError extends AIProcessingError {
  constructor(message: string) {
    super("invalid_response", message);
    this.name = "AIResponseValidationError";
  }
}
