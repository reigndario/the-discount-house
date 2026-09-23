import Image from "next/image";

import { HomeIndex } from "@/components/HomeIndex";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col px-4 py-6 sm:px-10 sm:py-8">
      {/* items-baseline puts the image's bottom edge on the text baseline, and 0.7em is Jost's cap
          height, so the mark spans exactly the capitals. The negative margin cancels the tracking's
          trailing space after the final E so the mark sits right beside it. */}
      <p className="flex items-baseline text-base sm:text-lg font-medium uppercase tracking-[0.3em]">
        <span className="-mr-[0.3em] whitespace-nowrap">The Discount House</span>
        <Image src="/tdh-logo.png" alt="" width={24} height={24} priority className="ml-2 h-[0.7em] w-[0.7em]" />
      </p>
      {/* Top-anchored, not vertically centred, so the grid never shifts as the disclosure text changes length. */}
      <div className="flex flex-1 justify-center pt-10 pb-10 sm:pt-[12vh] sm:pb-16">
        <HomeIndex />
      </div>
    </main>
  );
}
