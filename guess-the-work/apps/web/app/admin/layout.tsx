import Link from "next/link";
import { requireAdmin } from "@/lib/server/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2">
        <Link className="chip" href="/admin">📊 التغطية والمهام</Link>
        <Link className="chip" href="/admin/works">📚 الأعمال والأسماء العربية</Link>
        <Link className="chip" href="/admin/clips">✂️ أوستات ومشاهد</Link>
        <Link className="chip" href="/admin/reports">🚩 البلاغات</Link>
      </nav>
      {children}
    </div>
  );
}
