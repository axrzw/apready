import Link from "next/link";
import { requireAdmin } from "@/lib/server/session";
import { Icon } from "@/lib/icons";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const tabs = [
    ["/admin", "BarChart3", "التغطية والمهام"],
    ["/admin/works", "Library", "الأعمال والأسماء"],
    ["/admin/clips", "Scissors", "أوستات ومشاهد"],
    ["/admin/reports", "Flag", "البلاغات"],
    ["/admin/players", "Users", "اللاعبين"],
  ];
  return (
    <div className="space-y-6">
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {tabs.map(([href, icon, label]) => (
          <Link key={href} className="toggle shrink-0" href={href}>
            <Icon name={icon} size={16} />
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
