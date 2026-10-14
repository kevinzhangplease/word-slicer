# Word Slicer

A reading game for kids. A word appears on a cutting board; drag a knife across it to slice it into
syllables (`in · sti · tu · tion`), then paint the vowels and consonants with two brushes. Press **Check**
to find out how you did.

Static site: no build step, no dependencies to install. Open `index.html` through any static server.

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
node scripts/check-words.mjs  # validates the word list
```

## How to play

| Tool | Key | What it does |
| --- | --- | --- |
| Knife | `1` | Hold and drag across the word to cut. Cuts snap to the nearest letter gap. Tap a piece to hear it. |
| Vowel brush | `2` | Drag over letters to paint them as vowels. |
| Consonant brush | `3` | Drag over letters to paint them as consonants. |
| Eraser | `4` | Removes paint. |

`Z` undo last cut · `H` hear the word · `Enter` check · `N` new word.

Settings (saved in the browser): **Level** (Easy 2 syllables, Medium 3, Hard 4+, Mixed),
**Tasks** (slice + paint, slice only, paint only), **Theme** (Wooden Toys, Candy, Ocean, Space,
High Contrast), sound on/off. The High Contrast theme uses an orange/blue brush pair that stays
distinguishable for common kinds of colour blindness.

## How it works

- **Physics** – real 2D rigid bodies via [Matter.js](https://brm.io/matter-js/) (vendored in `vendor/`).
  A letter tile is treated as a ~20 cm toy block, so gravity is 9.8 m/s² scaled to the tile size. Mass comes
  from piece size, and every cut hands the new halves the parent's linear and angular momentum plus a kick
  from the swipe. Free-fall acceleration measured in a browser run matched the configured value within 0.3%.
- **Lighting** – one fixed light source (top-left). Bevels, highlights and drop shadows are computed
  relative to it, so highlights stay put while blocks tumble; shadows grow and blur with height.
- **Words** – a hand-checked list in `js/words.js` (syllables joined with `-`, `|` for accepted alternative
  splits). Level is derived from the syllable count. Syllabification is not reliably automatable, which is
  why this is a curated list rather than a generated one.
- **Vowels** – `a e i o u`, plus `y` when it is not the start of a syllable before a vowel (`hap-py`: vowel,
  `yel-low`: consonant). `w` is always a consonant.
- **Sound** – effects are synthesised with Web Audio. Syllables are read with the browser's speech
  synthesis, so voice quality depends on the device.

Two deliberate fudges for readability: pieces stay on the board (walls), and a piece that comes to rest on
its side or upside down hops itself upright.

## Layout

```
index.html  style.css
js/  main · game (state, tools, checking, UI) · physics · input · render · lighting · fx · audio · speech · themes · words
vendor/matter.min.js
scripts/check-words.mjs
```
