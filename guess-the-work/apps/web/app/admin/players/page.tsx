import { getRepo } from "@/lib/server/repo";
import { PageTitle } from "@/components/ui";
import PlayersAdmin from "@/components/PlayersAdmin";

export default async function Players() {
  const users = await getRepo().listUsers();
  return (
    <div>
      <PageTitle kicker="ADMIN · PLAYERS" title="اللاعبين" />
      <PlayersAdmin users={users.map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar, isAdmin: !!u.isAdmin, kicked: !!u.kicked }))} />
    </div>
  );
}
