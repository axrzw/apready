"use client";
import { useState } from "react";
import { Icon } from "@/lib/icons";

export default function WishButton({ workId, on: on0 = false, compact }: { workId: string; on?: boolean; compact?: boolean }) {
  const [on, setOn] = useState(on0);
  return (
    <button
      className={`toggle ${compact ? "h-8" : ""} ${on ? "toggle-on" : ""}`}
      onClick={async () => {
        await fetch("/api/wish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId, on: !on }) });
        setOn(!on);
      }}
    >
      <Icon name="Star" size={14} />
      {on ? "في قائمتي" : "أبي أشوفه"}
    </button>
  );
}
