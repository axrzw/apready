"use client";
import { useRouter } from "next/navigation";

export default function ReportButtons({ id }: { id: string }) {
  const router = useRouter();
  const set = async (status: string) => {
    await fetch("/api/admin/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <button className="chip" onClick={() => set("fixed")}>✔ تصلّح</button>
      <button className="chip" onClick={() => set("ignored")}>تجاهل</button>
      <a className="chip" href="/admin/works">تعديل الأسماء</a>
    </div>
  );
}
