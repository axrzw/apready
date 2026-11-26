# The apworld

## Contents
- Folder layout
- Skeleton (`__init__.py`, items, locations, options, rules)
- Death Link options
- slot_data
- Tests and generating
- Packaging

Read Archipelago's own docs in the clone first: `docs/world api.md`, `docs/apworld specification.md`,
`docs/options api.md`, `docs/tests.md`. They change between versions; the skeleton below follows 0.6.x.
APQuest (`worlds/apquest`) and Clique are small complete worlds to copy patterns from.

## Folder layout
```
worlds/mygame/
  __init__.py        # the World class
  items.py           # item table
  locations.py       # location table + regions
  options.py         # PerGameCommonOptions dataclass
  rules.py           # access rules
  data/ids.json      # the shared id tables (the mod reads the same file)
  docs/en_My Game.md # game page; docs/setup_en.md setup guide
  test/              # WorldTestBase tests
  archipelago.json   # manifest for the .apworld
```

## Skeleton
```python
# __init__.py
from BaseClasses import Item, ItemClassification as IC, Location, Region, Tutorial
from worlds.AutoWorld import World, WebWorld
from .options import MyGameOptions
from .items import ITEMS          # {"Grappling Hook": (1, IC.progression, 1), ...}  name: (id, class, count)
from .locations import LOCATIONS, REGIONS   # LOCATIONS {"Chest A": (1, "Forest")}; REGIONS {"Forest": ["Cave"]}
from . import rules

class MyGameItem(Item):
    game = "My Game"

class MyGameLocation(Location):
    game = "My Game"

class MyGameWeb(WebWorld):
    tutorials = [Tutorial("Setup", "How to set up My Game for Archipelago", "English", "setup_en.md", "setup/en", ["you"])]

class MyGameWorld(World):
    """One line about the game."""
    game = "My Game"                   # exact name, used everywhere (YAML, server, the mod)
    web = MyGameWeb()
    options_dataclass = MyGameOptions
    options: MyGameOptions
    item_name_to_id = {n: v[0] + BASE for n, v in ITEMS.items()}
    location_name_to_id = {n: v[0] + BASE for n, v in LOCATIONS.items()}

    def create_item(self, name: str) -> MyGameItem:
        return MyGameItem(name, ITEMS[name][1], self.item_name_to_id[name], self.player)

    def create_regions(self):
        regions = {name: Region(name, self.player, self.multiworld) for name in ["Menu", *REGIONS]}
        for loc, (_, region) in LOCATIONS.items():
            regions[region].locations.append(MyGameLocation(self.player, loc, self.location_name_to_id[loc], regions[region]))
        regions["Menu"].connect(regions["Forest"])
        for src, exits in REGIONS.items():
            for dst in exits:
                regions[src].connect(regions[dst])
        self.multiworld.regions += regions.values()
        # the goal as an event location holding an event item
        goal = MyGameLocation(self.player, "Final Boss", None, regions["Castle"])
        goal.place_locked_item(MyGameItem("Victory", IC.progression, None, self.player))
        regions["Castle"].locations.append(goal)

    def create_items(self):
        pool = [self.create_item(n) for n, (_, _, count) in ITEMS.items() for _ in range(count)]
        while len(pool) < len(LOCATIONS):
            pool.append(self.create_item(self.get_filler_item_name()))
        self.multiworld.itempool += pool

    def get_filler_item_name(self) -> str:
        return "Coins"

    def set_rules(self):
        rules.set_rules(self)
        self.multiworld.completion_condition[self.player] = lambda state: state.has("Victory", self.player)

    def fill_slot_data(self):
        return {"death_link": bool(self.options.death_link.value),
                "death_link_amnesty": self.options.death_link_amnesty.value,
                "goal": self.options.goal.value, "version": 1}
```
```python
# rules.py
from worlds.generic.Rules import set_rule
def set_rules(world):
    p = world.player
    set_rule(world.get_entrance("Forest -> Cave"), lambda state: state.has("Lantern", p))
    set_rule(world.get_location("Chest on the Ledge"), lambda state: state.has("Grappling Hook", p))
```
Use a distinct `BASE` id (pick a random 9-10 digit base; ids must be unique per game, not globally, but a
high base avoids confusion when debugging).

## Death Link options
```python
# options.py
from dataclasses import dataclass
from Options import Choice, DeathLink, PerGameCommonOptions, Range

class Goal(Choice):
    """What ends your game."""
    display_name = "Goal"
    option_final_boss = 0
    option_all_bosses = 1
    default = 0

class DeathLinkAmnesty(Range):
    """Deaths that don't send a Death Link before one does (0 = every death sends)."""
    display_name = "Death Link Amnesty"
    range_start = 0
    range_end = 20
    default = 0

@dataclass
class MyGameOptions(PerGameCommonOptions):
    goal: Goal
    death_link: DeathLink
    death_link_amnesty: DeathLinkAmnesty
```
Use the stock `DeathLink` toggle (so `death_link: true` works in every YAML, and My Ready AP's big switch
just works). Only add `death_link_amnesty` when the game kills you often.

## slot_data
Everything the mod needs to know about this seed beyond items: options that change the game (goal,
difficulty, death link), shuffled entrances, prices. Keep it small and versioned (`"version": 1`) so an old
mod can say "update me" instead of misbehaving.

## Tests and generating
```python
# test/__init__.py
from test.bases import WorldTestBase
class MyGameTestBase(WorldTestBase):
    game = "My Game"
# test/test_logic.py
class TestHook(MyGameTestBase):
    def test_ledge_needs_hook(self):
        self.assertFalse(self.can_reach_location("Chest on the Ledge"))
        self.collect_by_name("Grappling Hook")
        self.assertTrue(self.can_reach_location("Chest on the Ledge"))
```
Run `python -m pytest worlds/mygame` (the base tests check every location is reachable, fill works, etc.),
then generate: put 1 and 3 YAMLs in `Players/` and run `python Generate.py`. Try odd options (all off, all on).

## Packaging
`archipelago.json`:
```json
{"game": "My Game", "minimum_ap_version": "0.6.4", "world_version": "0.1.0", "authors": ["you"]}
```
Zip the folder so the zip contains `mygame/...` and rename to `mygame.apworld`, or use the Launcher's
"Build APWorlds" component. Release it on GitHub with the mod, same tag.
