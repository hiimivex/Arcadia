// Compteur d'images/s : valeur du moteur, en orange quand le jeu ralentit
window.hud.on(d => {
  document.body.className = d.size || 'm';
  document.documentElement.style.setProperty('--a', d.accent || '#39e5c8');
  document.getElementById('fps').textContent = Math.round(d.fps || 0);
  document.getElementById('sp').textContent = d.speed ? Math.round(d.speed) + ' %' : '';
  document.getElementById('box').classList.toggle('low', d.speed && d.speed < 95);
});
