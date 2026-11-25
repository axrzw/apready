import { devLoginEnabled, discord } from "@/lib/server/env";

const ERR: Record<string, string> = {
  notallowed: "حسابك مو بالقائمة المسموحة. كلّم صاحب الموقع.",
  state: "انتهت صلاحية المحاولة، جرّب مرة ثانية.",
  discord: "صار خطأ مع ديسكورد، جرّب بعد شوي.",
  name: "اكتب اسمك.",
  code: "ما وصلنا رمز من ديسكورد.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-md space-y-6 text-center">
      <h1 className="text-4xl font-black">
        <span className="text-brand-400">خمّن</span> العمل
      </h1>
      <p className="text-zinc-400">موقع خاص للشلة. لازم تدخل عشان تلعب.</p>
      {e && <p className="rounded-xl bg-rose-500/15 p-3 text-rose-300">{ERR[e] ?? e}</p>}
      {discord.clientId && (
        <a href="/api/auth/discord" className="btn w-full bg-[#5865F2] py-3 text-white hover:bg-[#4752c4]">
          دخول بالديسكورد
        </a>
      )}
      {devLoginEnabled && (
        <form action="/api/auth/dev" method="post" className="card space-y-3 text-start">
          <p className="text-sm text-zinc-400">وضع التطوير: دخول بدون ديسكورد (يقفل تلقائياً في الإنتاج لما تحط مفاتيح ديسكورد).</p>
          <input name="name" className="input" placeholder="اسمك" required maxLength={32} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="admin" /> أدمن
          </label>
          <button className="btn-primary w-full">ادخل</button>
        </form>
      )}
    </div>
  );
}
