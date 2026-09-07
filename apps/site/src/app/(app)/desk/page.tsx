import { Eyebrow } from "@/components/Eyebrow";

export default function DeskPage() {
  return (
    <div className="max-w-2xl">
      <Eyebrow color="yellow">Bundle authoring</Eyebrow>
      <h1 className="font-serif font-bold text-3xl sm:text-4xl mb-4">Desk</h1>
      <p className="text-tdh-black/70 mb-6">
        The Preference Desk: construct a ranked bundle of borrower or lender terms, encrypted
        before it ever leaves your browser.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide bg-tdh-black text-tdh-cream inline-block px-3 py-2">
        Coming soon
      </p>
    </div>
  );
}
