import type { Metadata } from "next";
import { Bodoni_Moda, Jost, Staatliches } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const staatliches = Staatliches({
  variable: "--font-staatliches",
  subsets: ["latin"],
  weight: "400",
});

const bodoniModa = Bodoni_Moda({
  variable: "--font-bodoni-moda",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
});

export const metadata: Metadata = {
  title: "The Discount House",
  description:
    "A confidential vesting-backed credit protocol. Borrow and lend against vesting tokens, privately.",
};

// Runs before paint so a returning visitor's stored theme applies with no flash.
const THEME_INIT_SCRIPT = `
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jost.variable} ${staatliches.variable} ${bodoniModa.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
