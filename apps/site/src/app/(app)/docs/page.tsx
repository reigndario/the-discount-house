import { Eyebrow } from "@/components/Eyebrow";

const differentiators = [
  {
    color: "bg-tdh-red",
    title: "Confidential preferences",
    body: "Ranked borrower and lender terms are encrypted end to end. No one previews your position before a match.",
  },
  {
    color: "bg-tdh-yellow",
    title: "Bond-backed matching",
    body: "Takers post a bond to attempt a match, so probing the book for free isn't an option.",
  },
  {
    color: "bg-tdh-blue",
    title: "Vesting-backed collateral",
    body: "Borrow against illiquid vesting tokens through TokenOps custody, without selling your position.",
  },
  {
    color: "bg-foreground",
    title: "No forced liquidation",
    body: "Terms are negotiated upfront. Lenders price the risk instead of relying on price-based liquidation.",
  },
];

export default function DocsPage() {
  return (
    <div className="max-w-3xl">
      <Eyebrow color="black">Reference</Eyebrow>
      <h1 className="font-serif font-bold text-3xl sm:text-4xl mb-4">Docs</h1>
      <p className="text-foreground/70 mb-6">
        Documentation on how the protocol actually works: matching, bonds, vesting-backed
        collateral, and confidential settlement.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide bg-foreground text-background inline-block px-3 py-2 mb-12">
        Coming soon
      </p>

      <h2 className="font-serif font-bold text-2xl sm:text-3xl mb-4">
        Private credit against vesting tokens
      </h2>
      <p className="text-foreground/70 mb-10 max-w-2xl">
        The Discount House is a confidential vesting-backed credit protocol. Borrowers and
        lenders publish encrypted ranked preferences, a matching engine finds bounded negotiated
        terms, and successful matches settle into bilateral escrow, without exposing either
        side&apos;s exact position.
      </p>

      <div className="grid sm:grid-cols-2 gap-x-10 gap-y-8 mb-16">
        {differentiators.map((d) => (
          <div key={d.title} className="flex gap-4">
            <span aria-hidden="true" className={`mt-1.5 h-4 w-4 shrink-0 ${d.color}`} />
            <div>
              <h3 className="font-display uppercase tracking-wide mb-1">{d.title}</h3>
              <p className="text-sm text-foreground/70">{d.body}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs uppercase tracking-wide text-foreground/50">
        Unaudited, experimental protocol. Built on Zama fhEVM. Not for production use.
      </p>
    </div>
  );
}
