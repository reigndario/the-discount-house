import Link from "next/link";

export function StubPage({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <main className="flex flex-col min-h-screen bg-tdh-cream text-tdh-black">
      <header className="px-6 sm:px-10 py-6 border-b-4 border-tdh-black flex items-center justify-between">
        <Link href="/" className="font-bold uppercase tracking-tight">
          The Discount House
        </Link>
        <Link href="/" className="text-sm uppercase tracking-wide underline">
          Back to menu
        </Link>
      </header>

      <section className="flex-1 px-6 sm:px-10 py-16 sm:py-24 max-w-3xl">
        <h1 className="text-4xl sm:text-6xl font-bold uppercase tracking-tight mb-6">
          {name}
        </h1>
        <p className="text-base sm:text-lg opacity-80 mb-10">{description}</p>
        <p className="inline-block bg-tdh-black text-tdh-cream text-xs uppercase tracking-wide px-3 py-2">
          Coming soon
        </p>
      </section>

      <footer className="px-6 sm:px-10 py-6 text-xs uppercase tracking-wide opacity-60">
        Unaudited, experimental protocol. Built on Zama fhEVM. Not for production use.
      </footer>
    </main>
  );
}
