import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getLang } from "@/lib/server/lang";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { assetUrl } from "@/lib/server/media";
import { t } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import JoinBox from "@/components/JoinBox";
import PosterStrip from "@/components/PosterStrip";

export default async function Home() {
  const s = await requireUser();
  const lang = await getLang();
  const [counts, lib] = await Promise.all([getRepo().counts(), getLibrary()]);
  // a strip of posters from every tier (decor only; served through tokens like everything else)
  const pick = [...lib.works].filter((w) => w.posterUrl).sort((a, b) => ((a.popularity * 7919) % 1000) - ((b.popularity * 7919) % 1000)).slice(0, 14);
  const posters = pick.map((w) => assetUrl({ a: { type: "plain", src: w.posterUrl! } }));
  const rows = [
    { href: "/play?room=1", icon: "Users", title: t(lang, "createRoom"), text: "غرفة للشلة: أطوار التخمين، Mix، الواصف، الرسّام" },
    { href: "/play", icon: "Play", title: t(lang, "solo"), text: "تدرّب لحالك على أي طور" },
    { href: "/daily", icon: "CalendarDays", title: t(lang, "daily"), text: "نفس الأسئلة للكل، مرة باليوم" },
    { href: "/leaderboard", icon: "Trophy", title: t(lang, "leaderboard"), text: "لكل طور وللمجموع" },
    { href: "/stats", icon: "BarChart3", title: t(lang, "stats"), text: "أقوى قسم، أضعف طور، كم عمل مظلوم عرفت" },
    { href: "/log", icon: "Library", title: "سجّل اللي شفته", text: "بطاقات تسحبها، وتقييم من 10" },
    { href: "/packs", icon: "Swords", title: "باقتي", text: "ابنِ أسئلة من أعمالك وتحدَّ الشباب" },
    { href: "/discover", icon: "Sparkles", title: "اكتشف", text: "توصيات من أقرب صاحب لذوقك" },
    { href: "/sessions", icon: "Clapperboard", title: "أرشيف السهرات", text: "ملخص كل جلسة وبطاقة المشاركة" },
    { href: "/gallery", icon: "Palette", title: t(lang, "gallery"), text: "رسمات طور الرسّام" },
    ...(s.admin ? [{ href: "/admin", icon: "Wrench", title: t(lang, "admin"), text: "المكتبة، التغطية، البلاغات، المصادر" }] : []),
  ];
  return (
    <div className="space-y-10">
      <section className="relative -mx-4 overflow-hidden border-b border-line pb-8 sm:mx-0 sm:rounded-md sm:border">
        <PosterStrip posters={posters} />
        <div className="relative px-4 pt-6 sm:px-8 sm:pt-10">
          <div className="label">TONIGHT&apos;S SCREENING · {counts.works.toLocaleString("en-US")} WORKS</div>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] sm:text-6xl">
            هلا {s.name}،<br />
            <span className="text-accent">وش نخمّن الليلة؟</span>
          </h1>
          <div className="mt-6 max-w-md">
            <JoinBox label={t(lang, "join")} placeholder={t(lang, "code")} />
          </div>
        </div>
      </section>

      <section>
        <div className="label mb-3">PROGRAM</div>
        <ol className="divide-y divide-line border-y border-line">
          {rows.map((r, i) => (
            <li key={r.href}>
              <Link href={r.href} className="group flex items-center gap-4 py-4 transition-colors hover:bg-surface/60 sm:px-2">
                <span className="num w-8 text-sm text-faint">{String(i + 1).padStart(2, "0")}</span>
                <Icon name={r.icon} size={22} className="text-muted transition-colors group-hover:text-accent" />
                <span className="flex-1">
                  <span className="block font-display text-xl">{r.title}</span>
                  <span className="block text-sm text-muted">{r.text}</span>
                </span>
                <Icon name="ArrowLeft" className="text-faint transition group-hover:-translate-x-1 group-hover:text-accent ltr:rotate-180" />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-faint">
        المكتبة: {counts.works.toLocaleString("en-US")} عمل · {counts.characters.toLocaleString("en-US")} شخصية · {counts.themes.toLocaleString("en-US")} أغنية · {counts.media.toLocaleString("en-US")} لقطة ومقطع
      </p>
    </div>
  );
}
