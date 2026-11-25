"use client";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";

export default function PlayPack({ packId }: { packId: string }) {
  const router = useRouter();
  return (
    <button
      className="btn-primary h-10"
      onClick={async () => {
        const r = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { kind: "pack", packId } }) });
        const j = await r.json();
        if (r.ok) router.push(`/room/${j.code}`);
      }}
    >
      <Icon name="Swords" size={16} /> تحدَّ فيها
    </button>
  );
}
