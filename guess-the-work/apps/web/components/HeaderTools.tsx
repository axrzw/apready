"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";
import { isMuted, setMuted } from "@/lib/sound";
import type { Lang } from "@/lib/i18n";

export default function HeaderTools({ lang }: { lang: Lang }) {
  const [muted, set] = useState(false);
  useEffect(() => {
    set(isMuted());
    const f = () => set(isMuted());
    window.addEventListener("gtw-mute", f);
    return () => window.removeEventListener("gtw-mute", f);
  }, []);
  return (
    <div className="flex items-center gap-1">
      <button className="btn-quiet px-2" onClick={() => setMuted(!muted)} aria-label={muted ? "unmute" : "mute"} title={muted ? "تشغيل المؤثرات" : "كتم المؤثرات"}>
        <Icon name={muted ? "VolumeX" : "Volume2"} />
      </button>
      <button
        className="btn-quiet px-2 text-xs font-semibold"
        onClick={() => {
          document.cookie = `lang=${lang === "ar" ? "en" : "ar"}; path=/; max-age=31536000`;
          location.reload();
        }}
      >
        {lang === "ar" ? "EN" : "ع"}
      </button>
    </div>
  );
}
