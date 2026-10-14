// A theme is one palette object. 3D fields: mat (block material kind), table, light, ground, env, exposure, boardMat. Add a theme by adding an entry here; the picker builds itself.
// vowel/consonant are the two brush colours. "contrast" uses the Okabe-Ito orange/blue pair,
// which stays distinguishable for the common kinds of colour blindness.
export const THEMES = {
  wood: {
    name: 'Wooden Toys', dark: false,
    bgTop: '#f3dfb4', bgBottom: '#cfa56b', vignette: 0.42,
    mat: 'wood', table: '#e9dfc9', light: '#fff0d4', ground: '#b08a5a', env: 0.32, exposure: 0.95, boardMat: 'wood',
    board: { top: '#d9a468', bottom: '#b07a40', grain: '#6b3f17', edge: '#6a4018' },
    block: { base: '#eab864', ink: '#3a2410', grain: '#9a6420', grainA: 0.34, gloss: 0 },
    vowel: '#e5484d', consonant: '#2e7bd6',
    blade: '#ffffff', glow: '#ffd98a',
    chips: ['#e8c07a', '#c98c3a', '#fff1c1', '#a8702e'],
    ui: { fg: '#3a2410', panel: 'rgba(255,247,230,.9)', border: 'rgba(110,70,25,.3)', accent: '#f08a00', accentFg: '#ffffff' },
  },
  candy: {
    name: 'Candy', dark: false,
    bgTop: '#ffd9ec', bgBottom: '#c3b4ff', vignette: 0.28,
    mat: 'candy', table: '#ffd2ea', light: '#fff2fa', ground: '#e8a6ff', env: 0.55, exposure: 1.0, boardMat: 'smooth',
    board: { top: '#cdbcff', bottom: '#a994f2', grain: '#8f78e8', edge: '#7a62d6' },
    block: { base: '#ffe9a8', ink: '#6a2150', grain: '#ffffff', grainA: 0, gloss: 0.6 },
    vowel: '#ff3d8b', consonant: '#14b8a6',
    blade: '#ffffff', glow: '#ffb3dd',
    chips: ['#ff9ccb', '#ffe27a', '#9be7ff', '#c3b4ff'],
    ui: { fg: '#5a1c45', panel: 'rgba(255,240,248,.9)', border: 'rgba(200,80,150,.3)', accent: '#ff3d8b', accentFg: '#ffffff' },
  },
  ocean: {
    name: 'Ocean', dark: false,
    bgTop: '#c4ecff', bgBottom: '#4aa3d8', vignette: 0.4,
    mat: 'gloss', table: '#6cc0ec', light: '#f4fbff', ground: '#5aa7d8', env: 0.5, exposure: 1.0, boardMat: 'wood',
    board: { top: '#ecd8ae', bottom: '#c9a96f', grain: '#9c7b3f', edge: '#8c6b33' },
    block: { base: '#ffffff', ink: '#0b3b5a', grain: '#cfe9f7', grainA: 0.18, gloss: 0.32 },
    vowel: '#ff8c1a', consonant: '#0a6fb5',
    blade: '#ffffff', glow: '#bfeaff',
    chips: ['#ffffff', '#bfeaff', '#7cc8f2', '#f2e2b8'],
    ui: { fg: '#0b3b5a', panel: 'rgba(235,248,255,.9)', border: 'rgba(10,111,181,.3)', accent: '#0a8fd6', accentFg: '#ffffff' },
  },
  space: {
    name: 'Space', dark: true,
    bgTop: '#0b1030', bgBottom: '#2a1650', vignette: 0.55,
    mat: 'neon', table: '#141a44', light: '#cfd8ff', ground: '#40307a', env: 0.25, exposure: 1.05, boardMat: 'smooth',
    board: { top: '#454d86', bottom: '#2a3060', grain: '#7a84d6', edge: '#141838' },
    block: { base: '#5a63a8', ink: '#f2f6ff', grain: '#8c96e6', grainA: 0.1, gloss: 0.22 },
    vowel: '#ffb000', consonant: '#35d0ff',
    blade: '#ffffff', glow: '#7df9ff',
    chips: ['#7df9ff', '#b89cff', '#ffffff', '#ffb000'],
    ui: { fg: '#e9efff', panel: 'rgba(20,24,64,.88)', border: 'rgba(125,249,255,.35)', accent: '#7df9ff', accentFg: '#0b1030' },
    neon: true,
  },
  contrast: {
    name: 'High Contrast', dark: false,
    bgTop: '#ffffff', bgBottom: '#dcdcdc', vignette: 0.18,
    mat: 'flat', table: '#f2f2f2', light: '#ffffff', ground: '#888888', env: 0.2, exposure: 0.95, boardMat: 'smooth',
    board: { top: '#c9c9c9', bottom: '#9a9a9a', grain: '#555555', edge: '#2b2b2b' },
    block: { base: '#ffffff', ink: '#000000', grain: '#dddddd', grainA: 0, gloss: 0, outline: '#000000' },
    vowel: '#e69f00', consonant: '#0072b2',
    blade: '#ffffff', glow: '#ffffff',
    chips: ['#000000', '#e69f00', '#0072b2', '#ffffff'],
    ui: { fg: '#000000', panel: 'rgba(255,255,255,.96)', border: 'rgba(0,0,0,.8)', accent: '#0072b2', accentFg: '#ffffff' },
  },
};

export function applyThemeCSS(theme) {
  const r = document.documentElement.style;
  r.setProperty('--fg', theme.ui.fg);
  r.setProperty('--panel', theme.ui.panel);
  r.setProperty('--border', theme.ui.border);
  r.setProperty('--accent', theme.ui.accent);
  r.setProperty('--accent-fg', theme.ui.accentFg);
  r.setProperty('--vig', String(theme.vignette));
  r.setProperty('--vowel', theme.vowel);
  r.setProperty('--cons', theme.consonant);
  document.documentElement.dataset.dark = theme.dark ? '1' : '0';
}
