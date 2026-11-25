import ClipsAdmin from "@/components/ClipsAdmin";
import { hasYtDlp } from "@/lib/server/admin";
export default function Page() {
  return <ClipsAdmin ytdlp={hasYtDlp()} />;
}
