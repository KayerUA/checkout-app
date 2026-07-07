import { AdminSidebar } from "@/components/admin/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background lg:flex">
      <AdminSidebar />
      <main className="flex-1 overflow-auto px-4 py-6 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
