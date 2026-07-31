# Chanko — Game Specification

Top-down tile game. Plain HTML/CSS/JS, no build step, hosted on GitHub Pages.
The player is **Chanko**. He recruits a faction, collects quests from NPCs
scattered across the map, and completes seven trials for the Warlock to win.

---

## 1. Flow

```
Start screen  →  Faction select  →  Teams menu (forced)  →  Map
   (Start / Continue)   (Pirate / Viking)    (T, must fill)     (play)
```

`Continue` skips faction select and the forced Teams menu, restoring a save.

---

## 2. Factions and teams

- Player picks **Pirate** or **Viking** at the start of a new game.
- **Chanko** is permanently on the player's team, first slot, immovable.
- **15 assignable NPCs** — every portrait except the Warlock.
- The **Warlock** is never in the Teams menu and belongs to no faction.

### Teams menu (`T`)

Three columns:

| Column | Contents | Colour |
|---|---|---|
| Left | Player's faction — Chanko + up to 7 NPCs | Blue |
| Middle | Neutral / unassigned | White |
| Right | Opposing faction | Red |

- NPCs are listed by `npc-label`.
- At new-game time all 15 NPCs start in the middle column.
- The player's team caps at **8 total** (Chanko + 7). The opposing team is uncapped.
- **The menu cannot be closed while any NPC sits in the middle column.** The
  middle column exists as a staging area for moving NPCs between factions later.
- Reopening with `T` mid-game is allowed at any time; NPCs may be moved freely,
  subject to the same close condition.
- An NPC's team decides which sprite it renders with on the map: the player's
  faction sprite or the opposing one. Chanko always uses his own sprite. The
  Warlock always uses the warlock sprite.

---

## 3. Map

A single tile grid, **240 × 132 tiles** at **32 px** — exactly 36 screens at a
1280 × 704 viewport. The camera centres on Chanko and does **not** clamp at the
edges; beyond the map the player sees black void.

Left to right:

| Region | Tiles (x) | Passable |
|---|---|---|
| River — full map height | 0 – 11 | No |
| Forest — light maze, walkable gaps | 12 – 59 | Yes |
| Road — vertical, full map height | 60 – 67 | Yes |
| Villa grounds | 68 – 239 | Mixed |

**Villa** occupies `y = 22 – 109`, leaving a full screen of grass with occasional
trees above and below. Fence encloses it on the left (against the road), top,
bottom, and right (flush with the map's right edge). All fence tiles are
impassable except:

- **Gate** — an opening in the left fence at the map's vertical centre (`y ≈ 66`),
  aligned with the road.

Inside the villa:

- **Tavern** — large building, upper half.
- **Pool** — right of the tavern, impassable.
- **Four small houses** — lower half, each with a green lawn below it, not
  touching the fence. No fences between houses; occasional impassable small
  trees separate them.

Terrain is generated procedurally in code and drawn with canvas primitives —
there is no tile artwork.

---

## 4. Controls

| Key | Action |
|---|---|
| Arrow keys | Move up / down / left / right |
| `A` | Attack — animation plays, nothing is damaged. All terrain and NPCs are invulnerable. |
| `E` | Interact with an adjacent NPC |
| `T` | Toggle Teams menu |
| `I` | Toggle Information screen |
| Mouse / arrows + `Enter` | Navigate dialogue options |
| `Esc` | Close a dialogue |

---

## 5. HUD

Fixed box, top-right, three rows — static display values:

```
Wisdom       + 1
Intelligence + 2
Charisma     + 3
```

---

## 6. Information screen (`I`)

Popup with **5 hard-coded text blocks** explaining how the game works. Content
supplied later; the skeleton ships with placeholders.

---

## 7. NPCs

All NPCs spawn at **random passable positions** across the map at new-game time.

Interacting with `E` opens a dialogue showing the NPC's **portrait, nickname,
profession**, body text, and selectable options — all driven by metadata.

### Standard NPC quest flow (15 NPCs)

1. **Not yet accepted** — two options:
   - **Sweet talk** — opens a check display: **DC 13** if the NPC is currently on
     the player's team, **DC 18** if on the opposing team. The die is *not*
     rolled by the game; the player self-reports by choosing **Success** or
     **Failure**.
     - *Success* → quest is given, state becomes `accepted`.
     - *Failure* → sweet talk is permanently disabled for that NPC; only Bribe
       remains.
   - **Bribe** — costs 1 gold coin, always succeeds. Gold is **not tracked**; no
     currency system exists.
2. **Accepted** — a new option appears: **"I have completed your quest"**. It
   opens a text input for a **6-digit code**. Matching
   `npc-quest-completion-code` sets the state to `completed`; a mismatch closes
   the popup and invites a retry.
3. **Completed** — the NPC permanently shows `npc-quest-completion-message`.

### Warlock

Not assignable to a team; has **7 sequential trials**, one unlocked at a time.

- No Sweet talk / Bribe. The player selects **"I accept the first trial"** (then
  second, third, …) to accept the currently unlocked trial.
- Completion uses the same 6-digit code mechanism, one code per trial.
- **"Ask for a hint"** — a **DC 15 Intelligence** check using the same
  self-reported Success / Failure mechanism. One hint per trial. Once a trial is
  completed, the hint updates to the next incomplete trial.
- Completing **trial 7** triggers the ending.

---

## 8. Ending

On entering the correct code for the Warlock's seventh trial, the screen fades
to black and displays:

> **You WIN. But your prize will arrive next week. Blame UPS.**

---

## 9. Saved state

Written to `localStorage`, restored by **Continue**:

- Chosen faction
- Chanko's tile position and facing
- Team assignment for all 15 NPCs
- NPC spawn positions
- Per-NPC quest state and whether sweet talk has been failed
- Warlock trial states and hint-unlocked flags

> Faction, team assignment and NPC positions are not in the original brief but
> must be saved — without them a restored game would reshuffle the map and
> teams, contradicting the save.

---

## 10. Metadata

`data/npcs.json` — the 15 standard NPCs:

```json
{
  "npc-label": "",
  "npc-nickname": "",
  "npc-profession": "",
  "npc-portrait-reference": "",
  "npc-greeting-text": "",
  "npc-quest-information": "",
  "npc-quest-completion-message": "",
  "npc-quest-state": "not-accepted",
  "npc-quest-completion-code": ""
}
```

`data/warlock.json` — richer structure, seven trials:

```json
{
  "npc-label": "warlock",
  "npc-nickname": "",
  "npc-profession": "",
  "npc-portrait-reference": "assets/portraits/warlock.jpg",
  "npc-greeting-text": "",
  "trials": [
    {
      "index": 1,
      "trial-name": "",
      "trial-information": "",
      "trial-hint": "",
      "trial-completion-message": "",
      "trial-state": "locked",
      "trial-completion-code": ""
    }
  ]
}
```

Quest states: `not-accepted` → `accepted` → `completed`.
Trial states: `locked` → `available` → `accepted` → `completed`.

Content is authored by the project owner after the skeleton is testable; the
skeleton ships with placeholder text so every path is exercisable.

---

## 11. Assets

| Path | Contents |
|---|---|
| `assets/ui/start_screen.jpg` | Start screen background |
| `assets/portraits/*.jpg` | 16 portraits, dialogue only |
| `assets/sprites/player/` | Chanko — idle, 16 walk, 8 attack |
| `assets/sprites/npc/pirate/` | Pirate faction sprite |
| `assets/sprites/npc/viking/` | Viking faction sprite |
| `assets/sprites/npc/warlock/` | Warlock, 4 directions |
| `assets/sprites/sprites.json` | Frame index |
