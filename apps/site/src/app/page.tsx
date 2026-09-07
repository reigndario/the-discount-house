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

// The sign hero photo isn't composed for phone dimensions yet. Until there's a real mobile
// landing design, skip it entirely on small screens and drop straight into the app.
// Plain inline script (not a React effect) so it runs before the desktop-only hero paints.
const MOBILE_REDIRECT_SCRIPT = `
  if (window.innerWidth < 768) {
    window.location.replace("/book");
  }
`;

export default function Home() {
  return (
    <main className="flex flex-col">
      <script dangerouslySetInnerHTML={{ __html: MOBILE_REDIRECT_SCRIPT }} />
      {/* Wordmark: a real header, never overlaid on the photo */}
      <header className="bg-black px-6 py-5 sm:px-10 sm:py-6">
        <p className="font-serif font-bold uppercase text-tdh-cream text-xl sm:text-3xl tracking-wide">
          The Discount House
        </p>
      </header>

      {/* Hero: sign photograph, with the menu printed directly on the sign's blank lower panel */}
      <section className="relative w-full aspect-[16/9] bg-black">
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
    </main>
  );
}
