/* game.js - StoneTap (version avec intégration Telegram WebApp)
   - Session 60s, vitesse augmente toutes les 5s
   - Click/tap pour détruire pierres avant qu'elles n'atteignent le sol
   - "Obtenir 10 pièces" ouvre la pub fournie et crédite 10 pièces une fois par navigateur
   - À chaque montée de niveau, envoie un payload JSON via Telegram.WebApp.sendData (si utilisé dans Telegram)
*/

/* ---------- Config ---------- */
const CANVAS_ID = 'gameCanvas';
const LEVEL_TIME = 60; // secondes
const SPEED_INCREASE_INTERVAL = 5; // sec
const BASE_SPAWN_RATE = 800; // ms (spawn initial)
const BASE_GRAVITY = 80; // px / sec^2 (base drop rate)
const COINS_KEY = 'stonetap_coins_v1';
const LEVEL_KEY = 'stonetap_level_v1';
const USED_AD_KEY = 'stonetap_used_ad_v1';

/* ---------- DOM ---------- */
const canvas = document.getElementById(CANVAS_ID);
const ctx = canvas.getContext('2d');
const btnStart = document.getElementById('btnStart');
const btnGetCoins = document.getElementById('btnGetCoins');
const btnReset = document.getElementById('btnReset');
const elCoins = document.getElementById('coins');
const elLevel = document.getElementById('level');
const elTime = document.getElementById('time');
const elScore = document.getElementById('score');

/* ---------- State ---------- */
let screenW = canvas.width;
let screenH = canvas.height;
let coins = Number(localStorage.getItem(COINS_KEY)) || 0;
let level = Number(localStorage.getItem(LEVEL_KEY)) || 1;
let usedAd = localStorage.getItem(USED_AD_KEY) === '1';
let running = false;
let gameStartTimestamp = 0;
let elapsed = 0;
let lastFrame = 0;
let spawnTimer = 0;
let entities = [];
let score = 0;
let timeLeft = LEVEL_TIME;
let gravity = BASE_GRAVITY;
let spawnRate = BASE_SPAWN_RATE;

/* ---------- Styles per level ---------- */
function styleForLevel(lv){
  const palettes = [
    ['#8B5CF6','#06B6D4','#F472B6'],
    ['#F97316','#F59E0B','#10B981'],
    ['#EF4444','#F43F5E','#7C3AED'],
    ['#06B6D4','#60A5FA','#34D399'],
    ['#FDE68A','#FCA5A5','#A78BFA'],
    ['#22C55E','#06B6D4','#F97316'],
  ];
  const idx = (lv-1) % palettes.length;
  return {
    colors: palettes[idx],
    border: `rgba(255,255,255,${Math.max(0.05, 0.12 - (lv*0.01))})`,
    shapeVariance: Math.min(0.7, 0.15 + lv*0.02),
    sparkle: lv >= 3
  };
}

/* ---------- Helpers ---------- */
function saveState(){
  localStorage.setItem(COINS_KEY, String(coins));
  localStorage.setItem(LEVEL_KEY, String(level));
}
function updateHUD(){
  elCoins.textContent = coins;
  elLevel.textContent = level;
  elScore.textContent = score;
  elTime.textContent = Math.ceil(timeLeft);
}
function rand(min,max){ return Math.random()*(max-min)+min; }
function now(){ return performance.now(); }

/* ---------- Entities (stones) ---------- */
class Stone {
  constructor(x, y, size, color, vx=0, vy=0, rotation=0){
    this.x = x; this.y = y;
    this.size = size;
    this.color = color;
    this.vx = vx; this.vy = vy;
    this.rotation = rotation;
    this.radius = size/2;
  }
  update(dt){
    this.vy += gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rotation += 0.02 * dt * 60;
  }
  draw(ctx){
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.color;
    roundRect(ctx, -this.size/2, -this.size/2, this.size, this.size, Math.max(4, this.size*0.12));
    ctx.fill();
    ctx.lineWidth = Math.max(1, this.size*0.03);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();
    // crack lines
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, this.size*0.02);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.moveTo(-this.size*0.2, -this.size*0.15);
    ctx.lineTo(this.size*0.1, this.size*0.25);
    ctx.moveTo(-this.size*0.25, this.size*0.2);
    ctx.lineTo(this.size*0.25, -this.size*0.2);
    ctx.stroke();
    ctx.restore();
  }
  containsPoint(px, py){
    return px >= (this.x - this.size/2) &&
           px <= (this.x + this.size/2) &&
           py >= (this.y - this.size/2) &&
           py <= (this.y + this.size/2);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- Game flow ---------- */
function startGame(){
  if(running) return;
  if(coins <= 0){ alert("Pas assez de pièces — clique sur la pub pour en obtenir."); return; }
  coins -= 1;
  saveState();
  running = true;
  gameStartTimestamp = now();
  elapsed = 0;
  lastFrame = now();
  spawnTimer = 0;
  entities = [];
  score = 0;
  timeLeft = LEVEL_TIME;
  gravity = BASE_GRAVITY + (level-1)*8;
  spawnRate = Math.max(220, BASE_SPAWN_RATE - (level-1)*60);
  updateHUD();
  requestAnimationFrame(loop);
}

function endGame(success){
  running = false;
  if(success){
    level += 1;
    saveState();
    // envoi au bot via Telegram WebApp si utilisé dans Telegram
    try{
      if(window.Telegram && window.Telegram.WebApp){
        const payload = { event: "level_up", level: level, score: score, timestamp: Date.now() };
        Telegram.WebApp.sendData(JSON.stringify(payload));
      }
    }catch(e){ console.warn("Telegram sendData failed", e); }
    alert(`Bravo ! Tu as terminé le niveau. Nouveau niveau: ${level}`);
  } else {
    alert("Tu as perdu une vie. Recommence si tu veux.");
  }
  updateHUD();
}

/* ---------- Spawning ---------- */
function spawnStone(){
  const style = styleForLevel(level);
  const palette = style.colors;
  const color = palette[Math.floor(Math.random()*palette.length)];
  const w = rand(screenW*0.08, screenW*0.17);
  const x = rand(w/2, screenW - w/2);
  const y = -w;
  const vx = rand(-30,30);
  const vy = rand(20,80);
  const s = new Stone(x,y,w,color,vx,vy, rand(-0.5,0.5));
  entities.push(s);
}

/* ---------- Main loop ---------- */
function loop(){
  if(!running) return;
  const cur = now();
  const dt = Math.min(0.05, (cur - lastFrame)/1000);
  lastFrame = cur;
  elapsed = (cur - gameStartTimestamp)/1000;
  timeLeft = Math.max(0, LEVEL_TIME - elapsed);

  const speedMultiplier = 1 + Math.floor(elapsed / SPEED_INCREASE_INTERVAL) * 0.05;

  spawnTimer += dt*1000;
  const effectiveSpawnRate = spawnRate / speedMultiplier;
  if(spawnTimer >= effectiveSpawnRate){
    spawnTimer = 0;
    spawnStone();
  }

  for(let i = entities.length-1; i >=0; i--){
    const e = entities[i];
    e.update(dt * speedMultiplier);
    if(e.y - e.size/2 > screenH){
      running = false;
      entities.splice(i,1);
      updateHUD();
      endGame(false);
      return;
    }
  }

  ctx.clearRect(0,0,screenW,screenH);
  const g = ctx.createLinearGradient(0,0,0,screenH);
  g.addColorStop(0,'rgba(255,255,255,0.03)');
  g.addColorStop(1,'rgba(0,0,0,0.15)');
  ctx.fillStyle = g; ctx.fillRect(0,0,screenW,screenH);

  for(const e of entities) e.draw(ctx);

  if(timeLeft <= 0){
    running = false;
    endGame(true);
    return;
  }

  updateHUD();
  requestAnimationFrame(loop);
}

/* ---------- Input handling ---------- */
function handlePointer(px, py){
  if(!running) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (px - rect.left) * scaleX;
  const y = (py - rect.top) * scaleY;
  for(let i = entities.length-1; i >=0; i--){
    const e = entities[i];
    if(e.containsPoint(x,y)){
      entities.splice(i,1);
      score += 1 + Math.floor(level/2);
      updateHUD();
      spawnClickBurst(x,y,e.size, e.color);
      return;
    }
  }
}

function spawnClickBurst(x,y,size,color){
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.arc(x,y, size*0.8, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

/* ---------- Events ---------- */
canvas.addEventListener('pointerdown', (ev)=>{
  handlePointer(ev.clientX, ev.clientY);
});

btnStart.addEventListener('click', ()=> startGame());

btnGetCoins.addEventListener('click', ()=>{
  try {
    window.open(AD_URL, '_blank', 'noopener');
  } catch(e){
    window.location.href = AD_URL;
  }
  if(!usedAd){
    coins += 10;
    usedAd = true;
    localStorage.setItem(USED_AD_KEY, '1');
    saveState();
    updateHUD();
    alert("Tu as reçu 10 pièces !");
  } else {
    alert("Tu as déjà obtenu les 10 pièces via cette pub (par navigateur).");
  }
});

btnReset.addEventListener('click', ()=>{
  if(confirm("Réinitialiser progression (niveau + pièces) ? Cette action est irréversible pour ce navigateur.")){
    coins = 0;
    level = 1;
    usedAd = false;
    localStorage.removeItem(COINS_KEY);
    localStorage.removeItem(LEVEL_KEY);
    localStorage.removeItem(USED_AD_KEY);
    saveState();
    updateHUD();
  }
});

/* ---------- Resize handling ---------- */
function fitCanvas(){
  const ratio = window.devicePixelRatio || 1;
  const container = canvas.getBoundingClientRect();
  canvas.width = Math.floor(container.width * ratio);
  canvas.height = Math.floor(container.width * 1.5 * ratio);
  screenW = canvas.width;
  screenH = canvas.height;
}
window.addEventListener('resize', ()=>{
  fitCanvas();
});
fitCanvas();

/* ---------- Init ---------- */
function init(){
  coins = Number(localStorage.getItem(COINS_KEY)) || coins;
  level = Number(localStorage.getItem(LEVEL_KEY)) || level;
  usedAd = (localStorage.getItem(USED_AD_KEY) === '1') || usedAd;
  updateHUD();

  // Telegram WebApp ready if present
  try {
    if(window.Telegram && window.Telegram.WebApp){
      Telegram.WebApp.ready();
      // On peut récupérer initData si besoin : Telegram.WebApp.initData
      // Lors d'un level up on enverra sendData (voir endGame)
    }
  } catch(e){ console.warn('Telegram WebApp non disponible'); }
}
init();
