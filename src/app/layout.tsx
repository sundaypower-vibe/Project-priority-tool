import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Priority Tool — Sunday Power",
  description: "Solar project tracking and prioritisation dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
