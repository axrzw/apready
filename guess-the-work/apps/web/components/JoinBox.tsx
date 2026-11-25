"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinBox({ label, placeholder }: { label: string; placeholder: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  return (
    <form
      className="mx-auto flex max-w-md gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ join: code }) });
        const j = await r.json();
        if (!r.ok) return setErr(j.error);
        router.push(`/room/${j.code}`);
      }}
    >
      <input className="input text-center font-mono text-xl uppercase tracking-widest" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={placeholder} />
      <button className="btn-primary whitespace-nowrap" disabled={code.length < 4}>
        {label}
      </button>
      {err && <span className="self-center text-sm text-rose-300">{err}</span>}
    </form>
  );
}
