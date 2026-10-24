import { Suspense } from "react";

import { DeskChat } from "@/components/desk/DeskChat";
import { Eyebrow } from "@/components/Eyebrow";

export default function DeskPage() {
  return (
    <div className="max-w-5xl">
      <Eyebrow>Bundle authoring</Eyebrow>
      <h1 className="mb-2 text-3xl font-medium sm:text-4xl">Desk</h1>
      <p className="mb-8 max-w-2xl font-light text-foreground/70">
        Describe what you want in plain words. Desk drafts the bundle with you, one question at a time, and
        never guesses a value.
      </p>
      <Suspense fallback={<p className="font-light">Loading Desk.</p>}>
        <DeskChat />
      </Suspense>
    </div>
  );
}
