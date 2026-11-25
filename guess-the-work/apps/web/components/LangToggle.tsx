"use client";
import type { Lang } from "@/lib/i18n";

export default function LangToggle({ lang }: { lang: Lang }) {
  return (
    <button
      className="chip"
      onClick={() => {
        document.cookie = `lang=${lang === "ar" ? "en" : "ar"}; path=/; max-age=31536000`;
        location.reload();
      }}
    >
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}
