import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>&copy; {new Date().getFullYear()} Argon</span>
        <Link href="/privacidade" className="transition hover:text-foreground">
          Política de privacidade
        </Link>
      </div>
    </footer>
  );
}
