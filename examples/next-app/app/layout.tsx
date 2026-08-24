import "hina-js/react/styles.css";
import "./styles.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "hina-js Next.js verification",
  description: "An install-and-build fixture for the published hina-js package.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
