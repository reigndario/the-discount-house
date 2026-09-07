import Image from "next/image";
import Link from "next/link";

type MenuItem = {
  /** Short label printed on the sign, matched 2x2 under its icon cluster. */
  label: string;
  href: string;
};

// Order matters: CSS grid auto-placement (2 cols) fills left-to-right, top-to-bottom,
// so this order must match the sign's icon layout: top-left, top-right, bottom-left, bottom-right.
const menuItems: MenuItem[] = [
  { label: "Book", href: "/book" },
  { label: "Vault", href: "/vault" },
  { label: "Desk", href: "/desk" },
  { label: "Docs", href: "/docs" },
];

export default function Home() {
  return (
    <main className="flex flex-col">
      {/* Wordmark: a real header, never overlaid on the photo */}
      <header className="bg-black px-6 py-5 sm:px-10 sm:py-6">
        <p className="font-serif font-bold uppercase text-tdh-cream text-xl sm:text-3xl tracking-wide">
          The Discount House
        </p>
      </header>

      {/* Desktop hero: sign photograph, menu printed directly on the sign's blank lower panel */}
      <section className="relative hidden sm:block w-full aspect-[16/9] bg-black">
        <Image
          src="/sign-hero.png"
          alt="The Discount House"
          fill
          priority
          className="object-cover object-center"
        />
        <nav
          aria-label="Primary"
          className="absolute grid grid-cols-2 gap-x-2 content-between"
          style={{ top: "52.5%", left: "39%", width: "22%", height: "20%" }}
        >
          {menuItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="font-display uppercase tracking-wide text-tdh-black text-center leading-none hover:opacity-60"
              style={{ fontSize: "clamp(0.9rem, 3.1vw, 2.5rem)" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </section>

      {/* Mobile hero: portrait composition. The menu labels don't fit legibly at this size, so
          the sign's own logo mark is the single tap target into the app instead. */}
      <section className="relative sm:hidden w-full aspect-[941/1672] bg-black">
        <Image
          src="/sign-hero-mobile.png"
          alt="The Discount House"
          fill
          priority
          className="object-cover object-center"
        />
        <Link
          href="/book"
          aria-label="Enter The Discount House"
          className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
          style={{ left: "49.5%", top: "69%", width: "16vw", height: "16vw" }}
        >
          <span className="absolute inset-0 rounded-full bg-tdh-yellow/40 animate-ping" />
          <span className="absolute inset-0 rounded-full border-2 border-tdh-yellow" />
        </Link>
      </section>
    </main>
  );
}
