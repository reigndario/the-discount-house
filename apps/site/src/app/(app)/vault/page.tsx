import { Eyebrow } from "@/components/Eyebrow";

export default function VaultPage() {
  return (
    <div className="max-w-2xl">
      <Eyebrow color="blue">Execution</Eyebrow>
      <h1 className="font-serif font-bold text-3xl sm:text-4xl mb-4">Vault</h1>
      <p className="text-foreground/70 mb-6">
        Loan Vault: matched deals settle into bilateral escrow, backed by TokenOps vesting
        collateral and funded through confidential ERC-7984 credit.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide bg-foreground text-background inline-block px-3 py-2">
        Coming soon
      </p>
    </div>
  );
}
