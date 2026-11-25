"use client";
import { useState } from "react";
import { AVATARS, COLORS } from "@/lib/identity";
import { Icon } from "@/lib/icons";
import { Avatar, ErrorNote } from "./ui";

export default function LoginForm({ error, next, name: n0, color: c0, avatar: a0 }: { error?: string; next: string; name?: string; color?: string; avatar?: string }) {
  const [name, setName] = useState(n0 ?? "");
  const [color, setColor] = useState<string>(c0 ?? COLORS[0]);
  const [avatar, setAvatar] = useState<string>(a0 ?? AVATARS[0]);
  return (
    <form action="/api/auth/login" method="post" className="panel space-y-5 p-5">
      {error && <ErrorNote text={error} />}
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="avatar" value={avatar} />
      <label className="block space-y-2">
        <span className="label">كلمة سر القروب</span>
        <input name="password" type="password" required className="field" autoComplete="current-password" dir="ltr" />
      </label>
      <label className="block space-y-2">
        <span className="label">اسمك</span>
        <input name="name" required maxLength={24} className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: أبو فهد" />
      </label>
      <div className="space-y-2">
        <span className="label">لونك</span>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button type="button" key={c} onClick={() => setColor(c)} aria-label={c} className={`h-8 w-8 rounded-sm transition ${c === color ? "ring-2 ring-text ring-offset-2 ring-offset-surface" : "opacity-70 hover:opacity-100"}`} style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <span className="label">رمزك</span>
        <div className="grid grid-cols-8 gap-2">
          {AVATARS.map((a) => (
            <button type="button" key={a} onClick={() => setAvatar(a)} aria-label={a} className={`grid aspect-square place-items-center rounded-sm border transition ${a === avatar ? "border-text" : "border-line text-muted hover:text-text"}`} style={a === avatar ? { color } : undefined}>
              <Icon name={a} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-4">
        <Avatar name={name || "؟"} color={color} icon={avatar} size={40} />
        <div className="flex-1 truncate text-sm text-muted">{name || "اسمك هنا"}</div>
        <button className="btn-primary">
          ادخل
          <Icon name="ArrowLeft" size={16} className="ltr:rotate-180" />
        </button>
      </div>
    </form>
  );
}
