import { Game } from './game.js';

const canvas = document.getElementById('stage');
if (!window.Matter) {
  document.getElementById('hint').textContent = 'Could not load the physics engine. Please reload the page.';
} else {
  const start = () => { window.__game = new Game(canvas); };
  // Let the web font load first so the first frame already uses it (falls back after 1.5 s).
  const fonts = document.fonts && document.fonts.load ? document.fonts.load('700 40px Lexend') : Promise.resolve();
  Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).catch(() => {}).then(start);
}
