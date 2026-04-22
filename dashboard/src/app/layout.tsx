import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { getCsrfToken } from "@/lib/csrf";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CheckApp Dashboard",
  description: "Browse check history, run checks, and manage skills",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const csrf = getCsrfToken();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta name="checkapp-csrf" content={csrf} />
      </head>
      <body className="flex min-h-full">
        <Providers>
          <Sidebar />
          <main className="flex min-h-screen flex-1 flex-col pt-[7.25rem] md:ml-60 md:pt-0">
            {children}
          </main>
          <Toaster position="bottom-right" theme="system" richColors />
        </Providers>
      </body>
    </html>
  );
}
