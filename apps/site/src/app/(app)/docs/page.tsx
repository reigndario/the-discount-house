import { Eyebrow } from "@/components/Eyebrow";

export default function DocsPage() {
  return (
    <div className="max-w-2xl">
      <Eyebrow>Reference</Eyebrow>
      <h1 className="font-serif font-bold text-3xl sm:text-4xl mb-4">Docs</h1>
      <p className="text-tdh-black/70 mb-6">
        Documentation on how the protocol actually works: matching, bonds, vesting-backed
        collateral, and confidential settlement.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide bg-tdh-black text-tdh-cream inline-block px-3 py-2">
        Coming soon
      </p>
    </div>
  );
}
