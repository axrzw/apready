import { describe, expect, it } from "vitest";
import { authorizeUrl, exchangeCode, fetchMe, isAllowed } from "../lib/discord";

const cfg = { clientId: "123", clientSecret: "s", allowlist: ["1", "2"], admins: ["9"], guildId: "" };

describe("discord oauth", () => {
  it("builds the authorize url", () => {
    const u = new URL(authorizeUrl(cfg, "http://localhost:3000/api/auth/discord/callback", "xyz"));
    expect(u.searchParams.get("scope")).toBe("identify");
    expect(u.searchParams.get("state")).toBe("xyz");
    expect(new URL(authorizeUrl({ ...cfg, guildId: "g" }, "http://x", "s")).searchParams.get("scope")).toBe("identify guilds");
  });
  it("allowlist and server membership", () => {
    expect(isAllowed(cfg, { id: "1", username: "a" })).toBe(true);
    expect(isAllowed(cfg, { id: "9", username: "admin" })).toBe(true);
    expect(isAllowed(cfg, { id: "5", username: "stranger" })).toBe(false);
    expect(isAllowed({ ...cfg, guildId: "g" }, { id: "5", username: "friend" }, ["g"])).toBe(true);
  });
  it("exchanges the code and reads the user", async () => {
    const calls: string[] = [];
    const f = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/token")) return Response.json({ access_token: "tok" });
      if (url.endsWith("/guilds")) return Response.json([{ id: "g" }]);
      return Response.json({ id: "1", username: "ali", global_name: "Ali", avatar: null });
    };
    expect(await exchangeCode(cfg, "code", "http://x", f)).toBe("tok");
    const me = await fetchMe("tok", true, f);
    expect(me.user.global_name).toBe("Ali");
    expect(me.guilds).toEqual(["g"]);
  });
});
