export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="theme-kayer flex min-h-screen flex-col bg-background text-foreground">
      {children}
    </div>
  );
}
