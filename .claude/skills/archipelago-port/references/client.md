# The game side: talking to the server

## Contents
- The protocol in one page
- C# with Archipelago.MultiClient.Net (Unity, .NET games)
- Python external client (memory, bridges)
- The connection file My Ready AP writes
- Reliability checklist

## The protocol in one page
JSON arrays of packets over a WebSocket (`wss://archipelago.gg:<port>` for the website, `ws://` locally;
try wss then ws). Client -> server: `Connect`, `LocationChecks`, `StatusUpdate`, `Bounce`, `Say`, `Sync`,
`GetDataPackage`. Server -> client: `RoomInfo`, `Connected` (slot, team, slot_data, checked_locations),
`ConnectionRefused`, `ReceivedItems` (index + items), `PrintJSON`, `Bounced`, `RoomUpdate`.
```json
[{"cmd": "Connect", "game": "My Game", "name": "Mishal", "password": "", "uuid": "<random per install>",
  "version": {"major": 0, "minor": 6, "build": 0, "class": "Version"},
  "items_handling": 7, "tags": ["DeathLink"], "slot_data": true}]
[{"cmd": "LocationChecks", "locations": [1234500001]}]
[{"cmd": "StatusUpdate", "status": 30}]
[{"cmd": "Bounce", "tags": ["DeathLink"], "data": {"time": 1732600000.0, "source": "Mishal", "cause": "Mishal fell into lava"}}]
```
`items_handling` 7 = receive items from other worlds, your own, and your starting inventory. Full spec:
`docs/network protocol.md` in the Archipelago repo.

## C# with Archipelago.MultiClient.Net
```csharp
using Archipelago.MultiClient.Net;
using Archipelago.MultiClient.Net.Enums;
using Archipelago.MultiClient.Net.BounceFeatures.DeathLink;

var session = ArchipelagoSessionFactory.CreateSession(host, port);
session.Items.ItemReceived += helper => {               // network thread: queue, apply on the main thread
    var item = helper.DequeueItem();
    pending.Enqueue((helper.Index, item.ItemId, item.ItemName));
};
var result = session.TryConnectAndLogin("My Game", slot, ItemsHandlingFlags.AllItems,
                                        password: string.IsNullOrEmpty(pw) ? null : pw, tags: new[] { "AP" });
if (!result.Successful) { ShowError(string.Join("; ", ((LoginFailure)result).Errors)); return; }
var slotData = ((LoginSuccessful)result).SlotData;      // death_link, goal, version...

// checks: send now; on reconnect send every checked one again (the server ignores repeats)
session.Locations.CompleteLocationChecks(locationId);
// goal
session.SetGoalAchieved();
// Death Link
var dl = session.CreateDeathLinkService();
if ((long)slotData["death_link"] == 1) dl.EnableDeathLink();
dl.OnDeathLinkReceived += link => pendingDeath = link.Source != slot;      // kill the player on the main thread
void OnPlayerDied(string cause) {
    if (++deathsSinceSent > amnesty) { deathsSinceSent = 0; dl.SendDeathLink(new DeathLink(slot, cause)); }
}
```
Items arrive with an index that grows by one per item for this slot. Save `lastAppliedIndex` in the game's
save (per seed: key by `session.RoomState.Seed`). On connect the server replays everything from index 0:
skip what you already applied. That one rule prevents duplicate and lost items.

## Python external client
Base it on Archipelago's `CommonClient.py` (`CommonContext`, `server_loop`, `get_base_parser`) so it gets the
text console, `/connect`, reconnects and the Launcher component for free:
```python
class MyGameContext(CommonContext):
    game = "My Game"
    items_handling = 0b111
    async def server_auth(self, password_requested=False):
        await super().server_auth(password_requested)
        await self.send_connect()
    def on_package(self, cmd, args):
        if cmd == "Connected":
            self.slot_data = args["slot_data"]
async def game_loop(ctx):
    while not ctx.exit_event.is_set():
        new = read_checked_flags_from_memory() - ctx.checked_locations
        if new:
            await ctx.send_msgs([{"cmd": "LocationChecks", "locations": list(new)}])
        apply_items(ctx.items_received[read_applied_index():])
        await asyncio.sleep(0.25)
```
Register it as a Launcher component in the apworld (`components.append(Component("My Game Client", ...))`)
so players start it with `ArchipelagoLauncher.exe "My Game Client" -- --connect host:port --name slot`,
which My Ready AP already knows how to run.

## The connection file My Ready AP writes
Read `ap_connection.json` from the mod's folder at startup (and when the player presses connect):
```json
{"host": "archipelago.gg", "port": 38281, "slot": "Mishal", "password": "", "death_link": true}
```
Accept `host` with a port in it too (`archipelago.gg:38281`). Keep an in-game box as a fallback and save
what was typed back into the same file. With this, the recipe's connect step is one `write_file` and
the player never types the room.

## Reliability checklist
- Reconnect by itself with backoff (2 s, 4 s ... 30 s) and show "disconnected" in-game, big.
- Never block the game thread on the network.
- Ignore Death Links whose `source` is this slot; don't kill during loading screens or cutscenes (queue it).
- Tag `DeathLink` only while Death Link is on (`ConnectUpdate` when the player toggles it).
- Log to a file next to the mod (`ap_log.txt`): connection, every check sent, every item applied.
- Version check: compare `slot_data["version"]` with the mod's; refuse with a clear message if too old.
