import { requireUser } from "@/lib/server/session";
import { getLang } from "@/lib/server/lang";
import PlaySetup from "@/components/PlaySetup";

export default async function Play({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  await requireUser();
  const { room } = await searchParams;
  return <PlaySetup lang={await getLang()} room={room === "1"} />;
}
