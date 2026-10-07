import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "PrepMind | Your interview notes, on demand",
  description: "A grounded AI agent for your Notion interview preparation notes."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
