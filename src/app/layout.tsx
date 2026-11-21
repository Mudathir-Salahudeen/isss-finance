import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ISSS Finance", template: "%s · ISSS Finance" },
  description: "IBN Salahudeen Science School — Financial Management & Control System",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-NG">
      <body>{children}</body>
    </html>
  );
}
