import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Argon
        </Link>
        <nav>
          <Link
            href="/newsletter"
            className="text-sm font-medium text-muted transition hover:text-foreground"
          >
            Newsletter
          </Link>
        </nav>
      </div>
    </header>
  );
}
