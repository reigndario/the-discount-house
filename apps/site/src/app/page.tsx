import Image from "next/image";

import { HomeIndex } from "@/components/HomeIndex";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col px-4 py-6 sm:px-10 sm:py-8">
      {/* Logo centred over the wordmark; the pair is centred on phones and top-left from sm up.
          The negative margin cancels the tracking's trailing space after the final E, so centring
          is measured against the visible letters. */}
      <div className="flex w-fit flex-col items-center gap-3 self-center sm:self-start">
        <Image
          src="/tdh-logo.png"
          alt=""
          width={48}
          height={48}
          priority
          className="h-10 w-10 sm:h-12 sm:w-12"
        />
        <p className="-mr-[0.3em] whitespace-nowrap text-base sm:text-lg font-medium uppercase tracking-[0.3em]">
          The Discount House
        </p>
      </div>
      {/* Top-anchored, not vertically centred, so the grid never shifts as the disclosure text changes length. */}
      <div className="flex flex-1 justify-center pt-10 pb-10 sm:pt-[12vh] sm:pb-16">
        <HomeIndex />
      </div>
    </main>
  );
}
