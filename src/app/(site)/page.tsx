import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">Argon</h1>
      <p className="max-w-prose text-lg text-muted">
        As últimas notícias sobre negócios, direto ao ponto.
      </p>
      <Link
        href="/newsletter"
        className="w-fit rounded-lg bg-accent px-5 py-3 text-base font-semibold text-accent-foreground transition hover:opacity-90"
      >
        Assinar a newsletter
      </Link>
    </div>
  );
}
