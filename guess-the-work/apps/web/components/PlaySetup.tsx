"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import SettingsForm from "./SettingsForm";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export default function PlaySetup({ lang, room }: { lang: Lang; room: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-black">{room ? t(lang, "createRoom") : t(lang, "solo")}</h1>
      {err && <p className="rounded-xl bg-rose-500/15 p-3 text-rose-300">{err}</p>}
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
