import { requireUser } from "@/lib/server/session";
import { getLang } from "@/lib/server/lang";
import { PageTitle } from "@/components/ui";
import LogDeck from "@/components/LogDeck";

export default async function Log() {
  await requireUser();
  return (
    <div className="mx-auto max-w-md">
      <PageTitle kicker="WATCH LOG" title="سجّل اللي شفته" />
      <LogDeck lang={await getLang()} />
    </div>
  );
}
