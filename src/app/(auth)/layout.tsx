export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center p-4">
      {children}
    </main>
  );
}
