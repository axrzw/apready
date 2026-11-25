import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import ProfileForm from "@/components/ProfileForm";

export default async function Profile() {
  const s = await requireUser();
  const u = await getRepo().getUser(s.uid);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-black">🔗 اربط قوائمك</h1>
      <p className="text-zinc-400">أعمال قائمتك تنضاف للمكتبة في المهمة الأسبوعية (أو لما الأدمن يشغّلها).</p>
      <ProfileForm linked={u?.linked ?? {}} />
    </div>
  );
}
