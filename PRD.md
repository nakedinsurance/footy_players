# PRD: Football Lineup Viewer

## Context
Display a matchday lineup for two soccer teams facing each other. Each team has 11 starters (positioned on a pitch), 8 substitutes, and 1 coach. Data lives in a local JSON file edited in a code editor. No backend, no API. Static viewer.

---

## Tech Stack
- **Framework**: React + Vite
- **Styling**: Tailwind CSS
- **Data**: `src/data/match.json` — edited manually

---

## Data Model (`match.json`)

```json
{
  "match": {
    "home": "Team A",
    "away": "Team B",
    "date": "2026-04-17",
    "venue": "Stadium Name"
  },
  "teams": {
    "home": {
      "name": "Team A",
      "formation": "4-3-3",
      "color": "#FF0000",
      "coach": { "name": "Coach Name" },
      "starters": [
        { "number": 1, "name": "Player Name", "position": "GK" }
      ],
      "substitutes": [
        { "number": 12, "name": "Player Name", "position": "MF" }
      ]
    },
    "away": { /* same shape */ }
  }
}
```

**Position values**: `GK`, `CB`, `LB`, `RB`, `LWB`, `RWB`, `CDM`, `CM`, `CAM`, `LM`, `RM`, `LW`, `RW`, `CF`, `ST`

---

## Phases

### Phase 1 — Project Setup + Data Model
**Goal**: Scaffold working app with sample data loaded.

Tasks:
- Init Vite + React project
- Install Tailwind CSS
- Create `src/data/match.json` with full sample lineup (2 teams, 11 starters + 8 subs + coach each)
- Create `useMatchData` hook that imports JSON
- Render raw JSON to screen to verify data loads

**Done when**: `npm run dev` shows match data on screen.

---

### Phase 2 — Pitch + Starting XI
**Goal**: Render a football pitch with both teams' starters positioned correctly.

Tasks:
- `<Pitch>` component: SVG or CSS div styled as green rectangle with pitch markings (centre circle, penalty boxes, halfway line)
- `<PlayerToken>` component: circle with jersey number + name label below
- Formation parser: map formation string (e.g. `"4-3-3"`) to row layout `[GK, DEF[], MID[], FWD[]]`
- Home team renders top half, away team renders bottom half (mirrored)
- Player tokens positioned using percentage-based coordinates within pitch

**Done when**: Both teams' 11 players visible on pitch in correct formation rows.

---

### Phase 3 — Substitutes Bench + Coach
**Goal**: Display subs and coach for both teams alongside the pitch.

Tasks:
- `<Bench>` component: vertical list of substitute players with number, name, position badge
- `<Coach>` component: separate row/card at bottom of bench labelled "Coach"
- Layout: pitch centred, home bench on left, away bench on right
- Team name + formation label above each bench

**Done when**: Both benches (8 subs + 1 coach) visible beside pitch.

---

### Phase 4 — Polish + Responsiveness
**Goal**: Production-quality UI.

Tasks:
- Team colours applied to player tokens (jersey colour from JSON)
- Match header: home team vs away team, date, venue
- Responsive layout: stacks vertically on mobile (pitch top, benches below side-by-side)
- Formation label displayed under team name on pitch
- Player token hover state: tooltip with full name + position
- Colour contrast check for token text vs team colour

**Done when**: App looks clean on desktop and mobile, colours correct, hover works.

---

## File Structure

```
src/
  data/
    match.json          ← edit here to update lineups
  components/
    Pitch.jsx
    PlayerToken.jsx
    Bench.jsx
    Coach.jsx
    MatchHeader.jsx
  hooks/
    useMatchData.js
  App.jsx
  main.jsx
```

---

## Verification (per phase)

| Phase | Test |
|-------|------|
| 1 | `npm run dev` — raw data visible |
| 2 | Both 11-player XIs on pitch in formation rows |
| 3 | Subs list + coach card visible beside pitch |
| 4 | Resize window — mobile layout stacks; hover shows tooltip |
