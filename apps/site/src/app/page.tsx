import { HomeIndex } from "@/components/HomeIndex";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col px-4 py-6 sm:px-10 sm:py-8">
      <p className="text-sm font-medium uppercase tracking-[0.3em]">The Discount House</p>
      {/* Top-anchored, not vertically centred, so the grid never shifts as the disclosure text changes length. */}
      <div className="flex flex-1 justify-center pt-10 pb-10 sm:pt-[12vh] sm:pb-16">
        <HomeIndex />
      </div>
    </main>
  );
}
