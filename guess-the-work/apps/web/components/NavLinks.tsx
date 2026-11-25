"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/lib/icons";

export default function NavLinks({ items, className, mobile }: { items: { href: string; icon: string; label: string }[]; className?: string; mobile?: boolean }) {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  if (mobile)
    return (
      <div className="grid grid-cols-5">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={`flex flex-col items-center gap-1 py-2 text-[11px] ${active(i.href) ? "text-accent" : "text-muted"}`}>
            <Icon name={i.icon} size={20} />
            {i.label}
          </Link>
        ))}
      </div>
    );
  return (
    <div className={`items-center gap-1 ${className ?? ""}`}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`relative px-3 py-2 text-sm transition-colors ${active(i.href) ? "text-text" : "text-muted hover:text-text"}`}>
          {i.label}
          {active(i.href) && <span className="absolute inset-x-3 -bottom-[13px] h-px bg-accent" />}
        </Link>
      ))}
    </div>
  );
}
