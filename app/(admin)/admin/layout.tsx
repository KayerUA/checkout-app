import { AdminSidebar } from "@/components/admin/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_18%_-10%,rgba(218,183,164,0.24),transparent_28rem),linear-gradient(180deg,rgba(255,255,255,0.9),rgba(247,243,240,0.96)_40%,rgba(250,249,247,1))] lg:flex">
      <AdminSidebar />
      <main className="flex-1 overflow-auto px-4 py-6 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
