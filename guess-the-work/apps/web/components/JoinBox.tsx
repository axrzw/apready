"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/lib/icons";

export default function JoinBox({ label, placeholder }: { label: string; placeholder: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ join: code }) });
        const j = await r.json();
        setBusy(false);
        if (!r.ok) return setErr(j.error);
        router.push(`/room/${j.code}`);
      }}
    >
      <div className="flex gap-2">
        <input
          className="field num h-12 text-center font-display text-2xl uppercase tracking-[0.35em]"
          maxLength={6}
          value={code}
          onChange={(e) => (setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")), setErr(""))}
          placeholder={placeholder}
          aria-label={placeholder}
          dir="ltr"
          autoCapitalize="characters"
        />
        <button className="btn-primary h-12 whitespace-nowrap" disabled={code.length < 4 || busy}>
          {label}
          <Icon name="ArrowLeft" size={16} className="ltr:rotate-180" />
        </button>
      </div>
      {err && <p className="text-sm text-signal">{err}</p>}
    </form>
  );
}
