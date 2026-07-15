"use client";

export default function GlobalError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <html lang="uk">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui" }}>
          <section style={{ maxWidth: 440, textAlign: "center" }}>
            <h1>Сталася непередбачена помилка</h1>
            <p>Оновіть сторінку або повторіть спробу.</p>
            <button type="button" onClick={unstable_retry} style={{ marginTop: 16, padding: "12px 24px", borderRadius: 999 }}>
              Повторити
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
