# Word Slicer

A reading game for kids. A word made of wooden letter blocks sits on a cutting board; drag a knife across it
to slice it into syllables (`in · sti · tu · tion`), paint the vowels and consonants with two brushes, and
pick pieces up with the hand, where they stick together like magnets. Press **Check** to find out how you did.

Static site, no build step and nothing to install. Open `index.html` through any static server.

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
node scripts/check-words.mjs  # validates the word list
```

Add `?quality=low` to the URL on a slow device (no antialiasing, small shadow map).

## How to play

| Tool | Key | What it does |
| --- | --- | --- |
| Knife | `1` | Hold and drag across the word to cut. Cuts snap to the nearest letter gap. Tap a piece to hear it. |
| Hand | `2` | Pick up a piece (or a whole stuck-together cluster) and slide it left or right. Push the end of one piece against the end of another and they snap together, which rejoins that gap in the word. **Shake** a piece, or **slice the joint with the knife**, to pull it apart (that cuts the gap again). |
| Vowel brush | `3` | Drag over letters to paint them as vowels. |
| Consonant brush | `4` | Drag over letters to paint them as consonants. |
| Eraser | `5` | Removes paint. |

`Z` undo last cut · `H` hear the word · `Enter` check · `N` new word.

Settings (saved in the browser): **Level** (Easy 2 syllables, Medium 3, Hard 4+, Mixed), **Tasks** (slice +
paint, slice only, paint only), **Theme** (Wooden Toys, Candy, Ocean, Space, High Contrast), sound on/off.
The High Contrast theme uses an orange/blue brush pair that stays distinguishable for common kinds of colour
blindness. **Check** grades the cuts you see: pieces that are neighbours in the word and stuck together count as uncut.

## How it works

- **3D** – [Three.js](https://threejs.org/) r170 (vendored in `vendor/three/`): a perspective camera about 28°
  above a cutting board on a table, true 3D rounded blocks with a wood-grain texture and letter decals,
  one key light with soft shadow maps, image-based reflections for glossy themes. The camera is refitted to
  the screen for every word so the whole board is always in view. Colour is tone-mapped with Three's
  "Neutral" operator so paint colours stay true.
- **Physics** – [cannon-es](https://pmndrs.github.io/cannon-es/) (vendored) rigid bodies in real units. A letter
  tile is a ~20 cm, ~3.3 kg block; gravity is 9.82 m/s² (free fall measured in a browser run: 9.79 m/s²).
  A piece is one compound body, so its mass and inertia come from how many tiles it has. A cut hands each half
  the parent's linear and angular velocity at its own centre of mass, plus a kick from the swipe.
- **Hand** – a kinematic hand body follows the pointer along the table. It is joined to the piece by a
  force-limited lock constraint, so heavy clusters lag and swing, collisions push back, and letting go keeps
  the momentum (a flick throws the piece). A held piece lifts just over a tile height so it clears the others,
  and eases back down as it approaches a face it can attach to.
- **Magnets** – every piece has a north face on its right and a south face on its left. Opposite poles attract
  and like poles repel, with a softened inverse-square force applied at four pole points per face, so the
  torque that flattens two faces against each other comes from the physics. Pieces that meet closely and
  slowly snap flush and are welded into a cluster (if they are neighbours in the word, that gap is rejoined); the bond's load is read from the constraint solver.
  Magnets only act on pieces that have been picked up (while held and for five seconds after), so freshly cut
  pieces do not drag each other back together.
- **Words** – a hand-checked list in `js/words.js` (syllables joined with `-`, `|` for accepted alternative
  splits). Level is derived from the syllable count. Syllabification is not reliably automatable, which is
  why this is a curated list rather than a generated one.
- **Vowels** – `a e i o u`, plus `y` when it is not the start of a syllable before a vowel (`hap-py`: vowel,
  `yel-low`: consonant). `w` is always a consonant.
- **Font** – block letters use Atkinson Hyperlegible (bundled), designed so that lowercase `l`, capital `I` and `1`
  look different.
- **Sound** – effects are synthesised with Web Audio. Syllables are read with the browser's speech synthesis,
  so voice quality depends on the device.

Deliberate rules, for readability and playability:

1. Blocks never rotate and never move toward or away from the viewer. They fall, slide left and right, and are
   lifted by the hand, so letters always stay upright and face you.
2. The board is very grippy (friction 2.0 against the blocks), so blocks stop where they land.
3. Every cut slides the two sides of the row apart by a few centimetres (as rigid groups, so stuck clusters are
   not torn) so a cut is always visible. The pop after a cut peaks below a block's height so a piece cannot
   hop over its neighbour.
4. Pieces are kept on the board by invisible walls.
5. Magnets are switched on by picking a piece up (above), and pulling stuck pieces apart is a shake or a knife
   stroke, because a mouse cannot pull two magnets apart the way two hands can. A bond also breaks if a
   cluster is slammed hard enough.
6. Letters are decals on the block faces, not extruded 3D text.

## Layout

```
index.html  style.css
js/  main · game (state, tools, checking, UI) · scene (Three.js) · overlay (cursors, marks, particles)
     physics (cannon-es, hand) · magnets · input · fx · audio · speech · themes · words · lighting · constants
vendor/  three/  cannon-es.js  fonts/ (Atkinson Hyperlegible, OFL)
scripts/check-words.mjs
```
