import type { Metadata } from "next";
import { Jost, Staatliches } from "next/font/google";
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

export const metadata: Metadata = {
  title: "The Discount House",
  description:
    "A confidential vesting-backed credit protocol. Borrow and lend against vesting tokens, privately.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jost.variable} ${staatliches.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-tdh-cream text-tdh-black">
        {children}
      </body>
    </html>
  );
}
