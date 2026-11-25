"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import SettingsForm from "./SettingsForm";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { ErrorNote, PageTitle } from "./ui";

export default function PlaySetup({ lang, room }: { lang: Lang; room: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle kicker={room ? "NEW ROOM" : "SOLO PRACTICE"} title={room ? t(lang, "createRoom") : t(lang, "solo")} />
      {err && (
        <div className="mb-4">
          <ErrorNote text={err} onClose={() => setErr(null)} />
        </div>
      )}
      <SettingsForm
        lang={lang}
        allowParty={room}
        submitLabel={room ? t(lang, "createRoom") : t(lang, "start")}
        onSubmit={async (settings) => {
          setErr(null);
          const r = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings, solo: !room }) });
          const j = await r.json();
          if (!r.ok) return setErr(j.error);
          router.push(`/room/${j.code}`);
        }}
      />
    </div>
  );
}
