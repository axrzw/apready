import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { IBM_Plex_Sans_Arabic, Reem_Kufi } from "next/font/google";
import "./globals.css";
import { getLang } from "@/lib/server/lang";
import { getSession } from "@/lib/server/session";
import { t } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { Avatar } from "@/components/ui";
import HeaderTools from "@/components/HeaderTools";
import Providers from "@/components/Providers";
import NavLinks from "@/components/NavLinks";

const body = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const display = Reem_Kufi({ subsets: ["arabic", "latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "خمّن العمل",
  description: "خاص",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const viewport: Viewport = { themeColor: "#0b0b0d", width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const s = await getSession();
  const nav = [
    { href: "/", icon: "LayoutGrid", label: lang === "ar" ? "الرئيسية" : "Home" },
    { href: "/play", icon: "Play", label: t(lang, "solo") },
    { href: "/log", icon: "Library", label: lang === "ar" ? "سجلّي" : "My log" },
    { href: "/leaderboard", icon: "Trophy", label: t(lang, "leaderboard") },
    { href: "/stats", icon: "BarChart3", label: t(lang, "stats") },
  ];
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`${body.variable} ${display.variable}`}>
      <body className="font-sans antialiased">
        <Providers>
          <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
            <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
              <Link href="/" className="flex items-baseline gap-1.5 font-display text-xl font-semibold tracking-tight">
                <span className="text-accent">خمّن</span>
                <span>العمل</span>
              </Link>
              {s && <NavLinks items={[...nav, { href: "/daily", icon: "CalendarDays", label: t(lang, "daily") }, { href: "/mine", icon: "Star", label: lang === "ar" ? "قائمتي" : "My list" }, { href: "/discover", icon: "Sparkles", label: lang === "ar" ? "اكتشف" : "Discover" }, { href: "/gallery", icon: "Palette", label: t(lang, "gallery") }, ...(s.admin ? [{ href: "/admin", icon: "Wrench", label: t(lang, "admin") }] : [])]} className="ms-4 hidden md:flex" />}
              <div className="ms-auto flex items-center gap-2">
                <HeaderTools lang={lang} />
                {s && (
                  <>
                    <Avatar name={s.name} color={s.color} icon={s.avatar} size={30} />
                    <span className="hidden text-sm sm:inline">{s.name}</span>
                    <form action="/api/auth/logout" method="post">
                      <button className="btn-quiet px-2" aria-label={t(lang, "logout")} title={t(lang, "logout")}>
                        <Icon name="LogOut" size={16} />
                      </button>
                    </form>
                  </>
                )}
              </div>
            </nav>
          </header>
          <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:pb-12">{children}</main>
          {s && (
            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raise/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
              <NavLinks items={nav} mobile />
            </nav>
          )}
        </Providers>
      </body>
    </html>
  );
}
