# Map name vocabulary attribution

The offline OCR vocabulary in `map-name-data.js` is a reduced list of unique
street/map-name pairs based on the OSMS Data Explorer public map dataset. The
trackable-map index in `map-monster-data.js` is derived from OSMS Data Explorer's
`data/current/maps.json`, retaining titles whose map records have one or more
monster spawn points (`mob_positions`). It was generated from the published
dataset on 2026-11-02:

- [OSMS Data Explorer](https://osmsdataexplorer.com/)
- [OSMS Data Explorer public dataset license](https://creativecommons.org/licenses/by/4.0/)

The list was reduced to unique pairs for OCR matching. The dataset is
unofficial and not affiliated with Nexon. MapleStory map names and other game
content are © Nexon and are not covered by the dataset license.

The monster map index is a bundled snapshot. Unknown map data is not treated as
proof that a map has no monsters; refresh this file when the OSMS map dataset
changes. OSMS describes its data as extracted from the game client and not
guaranteed to appear in-game.
