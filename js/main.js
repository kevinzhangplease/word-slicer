import { Game } from './game.js';

const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');

function start() {
  try {
    window.__game = new Game(stage, overlay);
  } catch (err) {
    console.error(err);
    document.getElementById('hint').textContent = 'Sorry, this browser could not start 3D graphics.';
  }
}

// Let the web font load first so the first frame already uses it (falls back after 1.5 s).
const fonts = document.fonts && document.fonts.load ? document.fonts.load('700 40px "Atkinson Hyperlegible"') : Promise.resolve();
Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).catch(() => {}).then(start);
