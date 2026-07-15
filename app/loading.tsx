import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8" aria-label="Завантаження">
      <Skeleton className="h-24 w-full rounded-[2rem]" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-[620px] rounded-[2rem]" />
        <Skeleton className="hidden h-[420px] rounded-[2rem] lg:block" />
      </div>
    </main>
  );
}
