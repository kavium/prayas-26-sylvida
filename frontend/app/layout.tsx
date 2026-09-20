import type { Metadata, Viewport } from "next";
import { Archivo, Azeret_Mono, Fraunces } from "next/font/google";
import "./globals.css";

/** Editorial serif. Headlines, figures, the wordmark — read once, not scanned. */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

/** Interface face. Narrow enough to survive a 336px rail without truncating. */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

/** Every number in the product. Tabular so columns of scores do not shimmer. */
const azeret = Azeret_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-azeret",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sylvida — zonal planning studio",
  description:
    "Finds the cells on a city's edge whose land use is holding quality of life back, and shows what changing each one would do.",
};

export const viewport: Viewport = {
  themeColor: "#14161a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${archivo.variable} ${azeret.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
