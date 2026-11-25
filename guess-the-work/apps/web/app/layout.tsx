import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { getLang } from "@/lib/server/lang";
import { getSession } from "@/lib/server/session";
import { t } from "@/lib/i18n";
import LangToggle from "@/components/LangToggle";

export const metadata: Metadata = {
  title: "خمّن العمل",
  description: "خاص",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const viewport: Viewport = { themeColor: "#0b0b12", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const s = await getSession();
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className="dark">
      <body className="font-sans antialiased">
        <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/80 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/" className="text-xl font-black tracking-tight">
              <span className="text-brand-400">خمّن</span> العمل
            </Link>
            {s && (
              <div className="ms-4 hidden gap-4 text-sm text-zinc-300 md:flex">
                <Link href="/play">{t(lang, "solo")}</Link>
                <Link href="/daily">{t(lang, "daily")}</Link>
                <Link href="/leaderboard">{t(lang, "leaderboard")}</Link>
                <Link href="/stats">{t(lang, "stats")}</Link>
                <Link href="/gallery">{t(lang, "gallery")}</Link>
                <Link href="/profile">🔗</Link>
                {s.admin && <Link href="/admin">{t(lang, "admin")}</Link>}
              </div>
            )}
            <div className="ms-auto flex items-center gap-3 text-sm">
              <LangToggle lang={lang} />
              {s && (
                <>
                  <span className="flex items-center gap-2">
                    {s.avatar ? <img src={s.avatar} alt="" className="h-7 w-7 rounded-full" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-700">{s.name[0]}</span>}
                    <span className="hidden sm:inline">{s.name}</span>
                  </span>
                  <form action="/api/auth/logout" method="post">
                    <button className="text-zinc-400 hover:text-white">{t(lang, "logout")}</button>
                  </form>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
