import Image from "next/image";

import { HomeIndex } from "@/components/HomeIndex";

/** Logo centered over the wordmark. The negative margin cancels the tracking's trailing space after the final E, so
    centering is measured against the visible letters. */
function Brand() {
  return (
    <div className="flex w-fit flex-col items-center gap-4 lg:gap-6">
      <Image
        src="/tdh-logo.png"
        alt=""
        width={384}
        height={384}
        priority
        className="h-24 w-24 sm:h-32 sm:w-32 lg:h-48 lg:w-48"
      />
      <p className="-mr-[0.3em] whitespace-nowrap text-base font-medium uppercase tracking-[0.3em] sm:text-lg lg:text-xl">
        The Discount House
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col px-4 py-6 sm:px-10 sm:py-8">
      {/* Top-anchored, not vertically centered, so the row never shifts as the disclosure text changes length. */}
      <div className="flex flex-1 justify-center pt-6 pb-10 sm:pt-10 sm:pb-16 lg:pt-[10vh]">
        <HomeIndex brand={<Brand />} />
      </div>
    </main>
  );
}
