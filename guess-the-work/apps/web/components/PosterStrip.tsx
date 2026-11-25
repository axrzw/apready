"use client";
import { motion } from "framer-motion";

/** A slow drifting row of posters behind the home title, faded into the background. */
export default function PosterStrip({ posters }: { posters: string[] }) {
  if (!posters.length) return null;
  const row = [...posters, ...posters];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <motion.div className="flex h-full gap-3 opacity-[0.22]" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 120, repeat: Infinity, ease: "linear" }} style={{ width: "max-content" }}>
        {row.map((p, i) => (
          <img key={i} src={p} alt="" className="h-full w-auto rounded-sm object-cover grayscale-[40%]" loading="lazy" />
        ))}
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/40" />
    </div>
  );
}
