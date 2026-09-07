import { Eyebrow } from "@/components/Eyebrow";

export default function BookPage() {
  return (
    <div className="max-w-2xl">
      <Eyebrow color="red">Discovery</Eyebrow>
      <h1 className="font-serif font-bold text-3xl sm:text-4xl mb-4">Book</h1>
      <p className="text-tdh-black/70 mb-6">
        The Confidential Preference Book: where borrowers and lenders publish encrypted ranked
        preferences and discover the opposite side of the market through coarse public buckets,
        without revealing exact terms.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide bg-tdh-black text-tdh-cream inline-block px-3 py-2">
        Coming soon
      </p>
    </div>
  );
}
