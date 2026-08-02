'use strict';

// raspi-chat - A development page for previewing the chat theme.
// Extracted from public/theme-lab.html.

var PALETTES = [
  { id: 'dark-current', name: 'Scuro (attuale)', dot: '#0d1119',
    vars: { '--bg-top': '#0d1119', '--bg-bottom': '#070a10', '--surface': 'rgba(16,22,32,.9)', '--border': 'rgba(230,235,244,.14)', '--ink': '#f1f4f9', '--muted': '#9aa5b4', '--primary': '#5b8def' } },
  { id: 'light-current', name: 'Chiaro (attuale)', dot: '#eef0f3',
    vars: { '--bg-top': '#eef0f3', '--bg-bottom': '#dfe2e6', '--surface': 'rgba(255,255,255,.9)', '--border': 'rgba(23,29,38,.12)', '--ink': '#1c222c', '--muted': '#5a6472', '--primary': '#2f6fe0' } },
  { id: 'anthracite', name: 'Antracite', dot: '#20242b',
    vars: { '--bg-top': '#20242b', '--bg-bottom': '#181b21', '--surface': 'rgba(37,41,49,.92)', '--border': 'rgba(255,255,255,.10)', '--ink': '#eef0f3', '--muted': '#9299a3', '--primary': '#8b93a1' } },
  { id: 'pure-bw', name: 'Bianco/Nero puro', dot: '#000000',
    vars: { '--bg-top': '#000000', '--bg-bottom': '#000000', '--surface': '#141414', '--border': 'rgba(255,255,255,.14)', '--ink': '#ffffff', '--muted': '#8a8a8a', '--primary': '#ffffff' } },
  { id: 'warm-gray', name: 'Grigio caldo', dot: '#f4f1ec',
    vars: { '--bg-top': '#f4f1ec', '--bg-bottom': '#e9e4db', '--surface': 'rgba(255,253,250,.92)', '--border': 'rgba(40,35,28,.12)', '--ink': '#2a261f', '--muted': '#7a7266', '--primary': '#3f6f5f' } },
  { id: 'cool-slate', name: 'Ardesia fredda', dot: '#1a2530',
    vars: { '--bg-top': '#1a2530', '--bg-bottom': '#121a22', '--surface': 'rgba(28,38,48,.92)', '--border': 'rgba(196,214,230,.14)', '--ink': '#e8eef4', '--muted': '#8fa0b0', '--primary': '#57b8c9' } }
];

var FONTS = [
  { name: 'Avenir Next (attuale)', value: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif' },
  { name: 'System UI', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { name: 'Inter-like', value: '"Inter", "Helvetica Neue", Arial, sans-serif' },
  { name: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
  { name: 'Mono', value: '"SF Mono", "Courier New", monospace' }
];

var paletteWrap = document.getElementById('palette-swatches');
PALETTES.forEach(function(p) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch-btn';
  btn.dataset.id = p.id;
  var dot = document.createElement('span');
  dot.className = 'swatch-dot';
  dot.style.background = p.dot;
  btn.appendChild(dot);
  btn.appendChild(document.createTextNode(p.name));
  btn.onclick = function() { applyPalette(p); };
  paletteWrap.appendChild(btn);
});

function applyPalette(p) {
  Object.keys(p.vars).forEach(function(k) { document.documentElement.style.setProperty(k, p.vars[k]); });
  document.querySelectorAll('.swatch-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.id === p.id); });
  var hue = document.getElementById('hue-range');
  hue.value = 219;
  document.getElementById('hue-value').textContent = '219°';
}
applyPalette(PALETTES[0]);

var fontSelect = document.getElementById('font-select');
FONTS.forEach(function(f) {
  var opt = document.createElement('option');
  opt.value = f.value; opt.textContent = f.name;
  fontSelect.appendChild(opt);
});
fontSelect.onchange = function() { document.documentElement.style.setProperty('--font', fontSelect.value); };

document.getElementById('shape-select').onchange = function(e) {
  document.body.setAttribute('data-shape', e.target.value);
};

var hueRange = document.getElementById('hue-range');
hueRange.oninput = function() {
  document.getElementById('hue-value').textContent = hueRange.value + '°';
  document.documentElement.style.setProperty('--primary', 'hsl(' + hueRange.value + ', 70%, 58%)');
};
