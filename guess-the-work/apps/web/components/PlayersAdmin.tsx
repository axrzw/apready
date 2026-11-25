"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "./ui";

type U = { id: string; name: string; color?: string; avatar?: string; isAdmin: boolean; kicked: boolean };

/** Rename, make admin, kick (a kicked player is logged out and needs the password again). */
export default function PlayersAdmin({ users }: { users: U[] }) {
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(users.map((u) => [u.id, u.name])));
  const post = async (body: Record<string, unknown>) => {
    await fetch("/api/admin/player", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    router.refresh();
  };
  return (
    <ul className="divide-y divide-line border-y border-line">
      {users.map((u) => (
        <li key={u.id} className={`flex flex-wrap items-center gap-3 py-3 ${u.kicked ? "opacity-50" : ""}`}>
          <Avatar name={u.name} color={u.color} icon={u.avatar} />
          <input className="field h-9 w-48" value={names[u.id]} onChange={(e) => setNames({ ...names, [u.id]: e.target.value })} />
          <button className="btn-quiet border border-line" onClick={() => post({ id: u.id, name: names[u.id] })}>
            حفظ الاسم
          </button>
          <button className="btn-quiet border border-line" onClick={() => post({ id: u.id, isAdmin: !u.isAdmin })}>
            {u.isAdmin ? "شيل الأدمن" : "خله أدمن"}
          </button>
          <button className={u.kicked ? "btn-quiet border border-line" : "btn-danger h-9"} onClick={() => post({ id: u.id, kicked: !u.kicked })}>
            {u.kicked ? "رجّعه" : "اطرده"}
          </button>
        </li>
      ))}
    </ul>
  );
}
