import { ApiError } from "./result";

/**
 * リクエストボディを実バイト数の上限付きで読み取る。
 * content-length ヘッダはクライアント制御値で、chunked送信・欠落・
 * 非数値で上限チェックを回避されるため、ストリーム読みで実測する。
 * 上限超過時は読み取りを中断して INVALID_INPUT を投げる。
 */
export async function readRequestText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ApiError(
          "INVALID_INPUT",
          "リクエストボディが大きすぎます",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : concat(chunks, total),
  );
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
