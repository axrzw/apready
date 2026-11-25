import { requireUser } from "@/lib/server/session";
import { getLang } from "@/lib/server/lang";
import RoomClient from "@/components/RoomClient";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  await requireUser();
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} lang={await getLang()} />;
}
