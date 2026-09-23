import { Eyebrow } from "@/components/Eyebrow";

export default function AtpPage() {
  return (
    <div className="max-w-2xl">
      <Eyebrow color="black">Fund</Eyebrow>
      <h1 className="font-bold text-3xl sm:text-4xl mb-4">ATP</h1>
      <p className="text-foreground/70 mb-6">
        A lender-side fund that aggregates confidential positions. Deposits and positions stay
        encrypted; only the aggregate NAV is published, once per epoch.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide bg-foreground text-background inline-block px-3 py-2">
        Coming soon
      </p>
    </div>
  );
}
