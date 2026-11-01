"use client";

// ルートレイアウト自体のエラーを拾う最終境界。
// ルートレイアウトを置き換えるため html/body と必要最小限の
// スタイルを自前で持つ(globals.css は読み込まれない)。
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    error instanceof Error && "digest" in error
      ? String(error.digest)
      : undefined;
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, 'Hiragino Sans', 'Yu Gothic', sans-serif",
          backgroundColor: "#fafafa",
          color: "#18181b",
        }}
      >
        <main style={{ maxWidth: 400, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>
            エラーが発生しました
          </h1>
          <p style={{ fontSize: 14, color: "#71717a", marginTop: 8 }}>
            予期しないエラーが発生しました。時間をおいて再試行してください。
          </p>
          {digest && (
            <p style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>
              エラーID: {digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 6,
              border: "1px solid #d4d4d8",
              backgroundColor: "#ffffff",
              cursor: "pointer",
            }}
          >
            再試行する
          </button>
        </main>
      </body>
    </html>
  );
}
