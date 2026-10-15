// A theme is a palette plus a `world` (see worlds.js: ground and scenery) and, for most, a block `look` (tofu, rock, ice ...). Add a theme by adding an entry here; the picker builds itself.
// vowel/consonant are the two brush colours. "contrast" uses the Okabe-Ito orange/blue pair,
// which stays distinguishable for the common kinds of colour blindness.
export const THEMES = {
  wood: {
    name: 'Wooden Toys', dark: false, world: 'wood',
    vignette: 0.42,
    mat: 'wood', table: '#e9dfc9', light: '#fff0d4', ground: '#b08a5a', env: 0.32, exposure: 0.95,
    block: { base: '#eab864', ink: '#3a2410', grain: '#9a6420', grainA: 0.34, gloss: 0 },
    vowel: '#e5484d', consonant: '#2e7bd6',
    blade: '#ffffff', glow: '#ffd98a',
    chips: ['#e8c07a', '#c98c3a', '#fff1c1', '#a8702e'],
    ui: { fg: '#3a2410', panel: 'rgba(255,247,230,.9)', border: 'rgba(110,70,25,.3)', accent: '#f08a00', accentFg: '#ffffff' },
  },
  kitchen: {
    name: 'Tofu Kitchen', dark: false, world: 'kitchen',
    vignette: 0.32,
    table: '#e6e3dc', light: '#fff4e2', ground: '#d8c9ac', env: 0.4, exposure: 1.0,
    block: { look: 'tofu', base: '#f3ead3', ink: '#5a3a22' },
    vowel: '#e8452c', consonant: '#2f6fb5',
    blade: '#ffffff', glow: '#ffe6a8',
    chips: ['#fff6df', '#f0e2bd', '#d7c79a', '#f7efd9'],
    ui: { fg: '#3d2a1a', panel: 'rgba(255,250,240,.92)', border: 'rgba(120,90,50,.3)', accent: '#e8452c', accentFg: '#ffffff' },
  },
  garden: {
    name: 'Rock Garden', dark: false, world: 'garden',
    vignette: 0.36,
    table: '#5f8f3c', light: '#fff1c9', ground: '#4d7a30', env: 0.4, exposure: 1.0,
    fog: { color: '#cfe3b4', near: 2, far: 16 },
    block: { look: 'rock', base: '#9a9c9f', ink: '#1d1f22' },
    vowel: '#ffb000', consonant: '#2e7bd6',
    blade: '#ffffff', glow: '#fff0a0',
    chips: ['#b7b9bc', '#8a8c8f', '#d4d5d7', '#6f7174'],
    ui: { fg: '#1f3a14', panel: 'rgba(244,250,232,.92)', border: 'rgba(60,100,30,.3)', accent: '#3f8f2a', accentFg: '#ffffff' },
  },
  snow: {
    name: 'Ice & Snow', dark: false, world: 'snow',
    vignette: 0.3,
    table: '#e7eff8', light: '#eef4ff', ground: '#a9c4e0', env: 0.7, exposure: 1.02,
    fog: { color: '#d7e6f5', near: 2, far: 18 },
    block: { look: 'ice', base: '#b5e3f6', ink: '#0d3a5c' },
    vowel: '#ff5a3c', consonant: '#2d4bd6',
    blade: '#ffffff', glow: '#d8f4ff',
    chips: ['#ffffff', '#d8f1fb', '#a9dcf2', '#e8f6fd'],
    ui: { fg: '#0d3a5c', panel: 'rgba(240,248,255,.92)', border: 'rgba(40,110,170,.3)', accent: '#1d7fd0', accentFg: '#ffffff' },
  },
  candy: {
    name: 'Candy Shop', dark: false, world: 'candy',
    vignette: 0.28,
    table: '#ffc8e0', light: '#fff2fa', ground: '#e8a6ff', env: 0.6, exposure: 1.0,
    block: { look: 'gummy', base: '#ffe9a0', ink: '#6a2150' },
    vowel: '#ff3d8b', consonant: '#14b8a6',
    blade: '#ffffff', glow: '#ffb3dd',
    chips: ['#ff9ccb', '#ffe27a', '#9be7ff', '#c3b4ff'],
    ui: { fg: '#5a1c45', panel: 'rgba(255,240,248,.9)', border: 'rgba(200,80,150,.3)', accent: '#ff3d8b', accentFg: '#ffffff' },
  },
  beach: {
    name: 'Sandcastle Beach', dark: false, world: 'beach',
    vignette: 0.3,
    table: '#e8d3a0', light: '#fff1cf', ground: '#d9b878', env: 0.45, exposure: 1.02,
    fog: { color: '#cdeaf3', near: 4, far: 30 },
    block: { look: 'sand', base: '#e3c58a', ink: '#4a3416' },
    vowel: '#ff5a36', consonant: '#0a6fb5',
    blade: '#ffffff', glow: '#fff0b8',
    chips: ['#f0d9a4', '#d3b273', '#fff2cf', '#bf9c5c'],
    ui: { fg: '#4a3416', panel: 'rgba(255,248,230,.92)', border: 'rgba(150,110,40,.3)', accent: '#0a8fd6', accentFg: '#ffffff' },
  },
  moon: {
    name: 'Moon Base', dark: true, world: 'moon',
    vignette: 0.5,
    table: '#6b6d75', light: '#f2f4ff', ground: '#30303a', env: 0.95, exposure: 1.05,
    fog: { color: '#05060d', near: 1.5, far: 14 },
    block: { look: 'metal', base: '#9aa3b5', ink: '#0d1220' },
    vowel: '#ffb000', consonant: '#35d0ff',
    blade: '#ffffff', glow: '#7df9ff',
    chips: ['#7df9ff', '#b89cff', '#ffffff', '#ffb000'],
    ui: { fg: '#e9efff', panel: 'rgba(20,24,64,.88)', border: 'rgba(125,249,255,.35)', accent: '#7df9ff', accentFg: '#0b1030' },
  },
  contrast: {
    name: 'High Contrast', dark: false, world: 'contrast',
    vignette: 0.18,
    mat: 'flat', table: '#f2f2f2', light: '#ffffff', ground: '#888888', env: 0.2, exposure: 0.95,
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
