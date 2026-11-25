"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";

export interface CardData {
  date: string;
  ranking: { name: string; score: number; color: string }[];
  highlights: { label: string; value: string; sub?: string }[];
  images: string[];
}

const W = 1080;
const H = 1350;

/** The share card is drawn in the browser (the page's own Arabic fonts shape correctly), then saved as PNG. */
export default function ShareCard({ data }: { data: CardData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      const c = ref.current;
      if (!c || cancelled) return;
      const ctx = c.getContext("2d")!;
      const css = getComputedStyle(document.documentElement);
      const display = css.getPropertyValue("--font-display").trim() || "serif";
      const body = css.getPropertyValue("--font-body").trim() || "sans-serif";
      ctx.fillStyle = "#0b0b0d";
      ctx.fillRect(0, 0, W, H);
      // letterbox bars + hairlines
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, 70);
      ctx.fillRect(0, H - 70, W, 70);
      ctx.direction = "rtl";
      ctx.textAlign = "right";
      ctx.fillStyle = "#5f5b55";
      ctx.font = `600 26px ${body}`;
      ctx.fillText(`ملخص السهرة · ${data.date}`, W - 80, 150);
      ctx.font = `600 110px ${display}`;
      ctx.fillStyle = "#e9b44c";
      ctx.fillText("خمّن", W - 80, 280);
      ctx.fillStyle = "#eeeae2";
      ctx.fillText("العمل", W - 80 - ctx.measureText("خمّن ").width, 280);
      ctx.fillStyle = "rgba(255,255,255,.12)";
      ctx.fillRect(80, 320, W - 160, 2);
      let y = 410;
      data.ranking.slice(0, 5).forEach((r, i) => {
        ctx.fillStyle = i === 0 ? "#e9b44c" : "#5f5b55";
        ctx.font = `600 64px ${display}`;
        ctx.fillText(String(i + 1), W - 80, y);
        ctx.fillStyle = r.color;
        ctx.fillRect(W - 170, y - 34, 10, 34);
        ctx.fillStyle = "#eeeae2";
        ctx.font = `600 52px ${body}`;
        ctx.fillText(r.name, W - 200, y);
        ctx.textAlign = "left";
        ctx.fillStyle = i === 0 ? "#e9b44c" : "#9c978e";
        ctx.font = `600 52px ${display}`;
        ctx.fillText(r.score.toLocaleString("en-US"), 80, y);
        ctx.textAlign = "right";
        y += 92;
      });
      ctx.fillStyle = "rgba(255,255,255,.12)";
      ctx.fillRect(80, y - 30, W - 160, 2);
      y += 40;
      for (const h of data.highlights.slice(0, 4)) {
        ctx.fillStyle = "#5f5b55";
        ctx.font = `600 26px ${body}`;
        ctx.fillText(h.label, W - 80, y);
        ctx.fillStyle = "#eeeae2";
        ctx.font = `500 40px ${display}`;
        ctx.fillText(h.value.slice(0, 34), W - 80, y + 50);
        if (h.sub) {
          ctx.fillStyle = "#9c978e";
          ctx.font = `400 26px ${body}`;
          ctx.fillText(h.sub.slice(0, 60), W - 80, y + 90);
        }
        y += 140;
      }
      if (!cancelled) setUrl(c.toDataURL("image/png"));
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);
  const share = async () => {
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], "khammin-session.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "خمّن العمل" });
    else {
      const a = document.createElement("a");
      a.href = url;
      a.download = "khammin-session.png";
      a.click();
    }
  };
  return (
    <div className="space-y-3">
      <canvas ref={ref} width={W} height={H} className="mx-auto w-full max-w-sm rounded-md border border-line" aria-label="بطاقة ملخص السهرة" />
      <div className="flex justify-center gap-2">
        <button className="btn-primary" disabled={!url} onClick={share}>
          <Icon name="Download" size={16} /> شارك البطاقة
        </button>
      </div>
    </div>
  );
}
