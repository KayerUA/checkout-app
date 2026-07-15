import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-[2rem] border bg-card p-8 text-center shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Сторінку не знайдено</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Посилання недійсне або сторінка вже недоступна.
        </p>
        <Link
          href="https://kayer.ua"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Перейти до KAYER
        </Link>
      </section>
    </main>
  );
}
