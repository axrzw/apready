import { GROUP_PASSWORD } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { dbMissing } from "@/lib/server/repo";
import LoginForm from "@/components/LoginForm";

const ERR: Record<string, string> = {
  password: "كلمة السر غلط.",
  name: "اكتب اسمك.",
  nopass: "الموقع ما له كلمة سر للحين. أضف GROUP_PASSWORD في إعدادات Vercel.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const { e, next } = await searchParams;
  const s = dbMissing() ? null : await getSession().catch(() => null);
  return (
    <div className="mx-auto max-w-md pt-6 sm:pt-12">
      <div className="mb-8 space-y-3 text-center">
        <div className="label">PRIVATE SCREENING</div>
        <h1 className="font-display text-5xl font-semibold leading-none">
          <span className="text-accent">خمّن</span> العمل
        </h1>
        <p className="text-sm text-muted">عرض خاص للشلة. كلمة سر القروب واسمك، وبس.</p>
      </div>
      <LoginForm error={dbMissing() ? "قاعدة البيانات مو موصولة. في Vercel: Storage ثم Neon ثم Connect." : e ? (ERR[e] ?? e) : !GROUP_PASSWORD ? ERR.nopass : undefined} next={next ?? "/"} name={s?.name} color={s?.color} avatar={s?.avatar} />
    </div>
  );
}
