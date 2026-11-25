import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getLang } from "@/lib/server/lang";
import { getRepo } from "@/lib/server/repo";
import { t } from "@/lib/i18n";
import JoinBox from "@/components/JoinBox";

export default async function Home() {
  const s = await requireUser();
  const lang = await getLang();
  const counts = await getRepo().counts();
  const cards = [
    { href: "/play", icon: "🎯", title: t(lang, "solo"), text: "تدرّب لحالك على أي طور أو Mix" },
    { href: "/play?room=1", icon: "🎮", title: t(lang, "createRoom"), text: "غرفة للشلة: أطوار التخمين، Mix، الواصف، الرسّام" },
    { href: "/daily", icon: "📆", title: t(lang, "daily"), text: "نفس الأسئلة للكل، مرة باليوم" },
    { href: "/leaderboard", icon: "🏆", title: t(lang, "leaderboard"), text: "لكل طور وللمجموع" },
    { href: "/stats", icon: "📊", title: t(lang, "stats"), text: "أقوى قسم، أضعف طور، كم عمل مظلوم عرفت" },
    { href: "/gallery", icon: "🖼️", title: t(lang, "gallery"), text: "كل رسمات طور الرسّام" },
  ];
  return (
    <div className="space-y-8">
      <section className="text-center">
        <h1 className="text-4xl font-black sm:text-5xl">
          هلا {s.name} 👋 <span className="text-brand-400">خمّن</span> العمل
        </h1>
        <p className="mt-2 text-zinc-400">{t(lang, "tagline")}</p>
        <p className="mt-1 text-sm text-zinc-500">
          المكتبة: {counts.works.toLocaleString()} عمل · {counts.characters.toLocaleString()} شخصية · {counts.themes.toLocaleString()} أغنية · {counts.media.toLocaleString()} مقطع/لقطة
        </p>
      </section>
      <JoinBox label={t(lang, "join")} placeholder={t(lang, "code")} />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card group transition hover:-translate-y-0.5 hover:border-brand-500">
            <div className="text-3xl">{c.icon}</div>
            <div className="mt-2 text-lg font-bold group-hover:text-brand-300">{c.title}</div>
            <div className="text-sm text-zinc-400">{c.text}</div>
          </Link>
        ))}
        {s.admin && (
          <Link href="/admin" className="card hover:border-brand-500">
            <div className="text-3xl">🛠️</div>
            <div className="mt-2 text-lg font-bold">{t(lang, "admin")}</div>
            <div className="text-sm text-zinc-400">المكتبة، التغطية، البلاغات، السحب</div>
          </Link>
        )}
      </section>
    </div>
  );
}
