"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-[2rem] border bg-card p-8 text-center shadow-xl">
        <AlertCircle className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold">Не вдалося завантажити сторінку</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Спробуйте ще раз. Дані замовлення не втрачено.
        </p>
        <button
          type="button"
          className="mt-6 h-10 w-full rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={unstable_retry}
        >
          Повторити
        </button>
      </section>
    </main>
  );
}
