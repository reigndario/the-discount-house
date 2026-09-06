import Image from "next/image";
import Link from "next/link";

type MenuItem = {
  /** Short label printed on the sign — matched 2x2 under its icon cluster. */
  label: string;
  href: string;
  description: string;
};

// Order matters: CSS grid auto-placement (2 cols) fills left-to-right, top-to-bottom,
// so this order must match the sign's icon layout: top-left, top-right, bottom-left, bottom-right.
const menuItems: MenuItem[] = [
  {
    label: "Book",
    href: "/book",
    description: "Confidential Preference Book — where borrowers and lenders discover each other.",
  },
  {
    label: "Loans",
    href: "/loans",
    description: "Loan Escrow — matched deals, funded and repaid confidentially.",
  },
  {
    label: "Build",
    href: "/builder",
    description: "Preference Builder — construct your ranked, encrypted terms.",
  },
  {
    label: "Docs",
    href: "/docs",
    description: "Documentation — how the protocol actually works.",
  },
];

const differentiators = [
  {
    color: "bg-tdh-red",
    title: "Confidential preferences",
    body: "Ranked borrower and lender terms are encrypted end to end. No one previews your position before a match.",
  },
  {
    color: "bg-tdh-yellow",
    title: "Bond-backed matching",
    body: "Takers post a bond to attempt a match — probing the book for free isn't an option.",
  },
  {
    color: "bg-tdh-blue",
    title: "Vesting-backed collateral",
    body: "Borrow against illiquid vesting tokens through TokenOps custody, without selling your position.",
  },
  {
    color: "bg-tdh-black",
    title: "No forced liquidation",
    body: "Terms are negotiated upfront. Lenders price the risk instead of relying on price-based liquidation.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-col">
      {/* Wordmark: a real header, never overlaid on the photo */}
      <header className="bg-black px-6 py-5 sm:px-10 sm:py-6">
        <p className="font-display text-tdh-cream text-xl sm:text-3xl uppercase tracking-wide">
          The Discount House
        </p>
      </header>

      {/* Hero: sign photograph, with the menu printed directly on the sign's blank lower panel */}
      <section className="relative w-full aspect-[16/9] bg-black">
        <Image
          src="/sign-hero.png"
          alt="The Discount House"
          fill
          priority
          className="object-cover object-center"
        />
        <nav
          aria-label="Primary"
          className="absolute grid grid-cols-2 gap-x-2 gap-y-1"
          style={{ top: "50%", left: "39%", width: "22%", height: "19%" }}
        >
          {menuItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="font-display uppercase tracking-wide text-tdh-black text-center leading-none hover:opacity-60"
              style={{ fontSize: "clamp(0.5rem, 1.6vw, 1.3rem)" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </section>

      {/* Product intro / differentiators */}
      <section className="bg-tdh-black text-tdh-cream px-6 sm:px-10 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-display text-4xl sm:text-6xl uppercase tracking-wide mb-6">
            Private credit against vesting tokens
          </h1>
          <p className="text-base sm:text-lg opacity-80 mb-16 max-w-2xl">
            The Discount House is a confidential vesting-backed credit protocol. Borrowers and
            lenders publish encrypted ranked preferences, a matching engine finds bounded
            negotiated terms, and successful matches settle into bilateral escrow — without
            exposing either side&apos;s exact position.
          </p>

          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-10">
            {differentiators.map((d) => (
              <div key={d.title} className="flex gap-4">
                <span aria-hidden="true" className={`mt-1.5 h-4 w-4 shrink-0 ${d.color}`} />
                <div>
                  <h2 className="font-display uppercase tracking-wide mb-1">{d.title}</h2>
                  <p className="text-sm opacity-75">{d.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer / status disclosure */}
      <footer className="bg-tdh-cream px-6 sm:px-10 py-6 text-xs uppercase tracking-wide opacity-60">
        Unaudited, experimental protocol. Built on Zama fhEVM. Not for production use.
      </footer>
    </main>
  );
}
