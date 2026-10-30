const dots = [
  [8,12,0,3.2],[14,82,.6,2.8],[22,46,1.4,3.6],[6,63,2.1,3],
  [30,8,.9,2.6],[18,28,1.8,3.4],[36,90,.3,3.1],[44,20,2.5,2.9],
  [12,95,1.1,3.3],[52,66,.5,2.7],[60,15,1.6,3.5],[68,88,2.3,3],
  [76,40,.8,2.8],[84,72,1.9,3.2],[90,24,.2,3.6],[40,55,2.7,2.9],
  [25,74,1.3,3.1],[72,6,.7,2.6],[56,34,2,3.4],[82,92,1,2.7]
];
for (const [top,left,delay,duration] of dots) {
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.cssText = `top:${top}%;left:${left}%;animation-delay:-${delay}s;animation-duration:${duration}s`;
  document.getElementById('dots').append(dot);
}

const head = document.getElementById('typed-head');
const tail = document.getElementById('typed-tail');
const caret = document.getElementById('caret');
const scriptsButton = document.getElementById('scripts-button');
const homeActions = document.getElementById('home-actions');
const views = document.getElementById('views');
const home = document.getElementById('home');
const scripts = document.getElementById('scripts');
const scriptCard = document.querySelector('.script-card');
const showcaseVideo = document.getElementById('showcase-video');
let typingTimer;
let focusTimer;

async function typeTitle() {
  clearTimeout(typingTimer);
  head.textContent = '';
  tail.textContent = '';
  caret.hidden = false;
  homeActions.hidden = true;
  await document.fonts.ready;
  let count = 0;
  function tick() {
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = 'cuties.cat'[count];
    (count < 6 ? head : tail).append(letter);
    count++;
    if (count < 10) typingTimer = setTimeout(tick, 65);
    else typingTimer = setTimeout(() => {
      caret.hidden = true;
      homeActions.hidden = false;
    }, 180);
  }
  typingTimer = setTimeout(tick, 150);
}

typeTitle();

function showScripts(open) {
  if (!open) setPreview(false);
  clearTimeout(focusTimer);
  clearTimeout(typingTimer);
  views.classList.toggle('show-scripts', open);
  home.inert = open;
  home.setAttribute('aria-hidden', String(open));
  scripts.inert = !open;
  scripts.setAttribute('aria-hidden', String(!open));
  if (!open) typeTitle();
  focusTimer = setTimeout(() => {
    document.querySelector(open ? '#scripts-title' : 'h1').focus({preventScroll:true});
  }, 280);
}

scriptsButton.addEventListener('click', () => showScripts(true));
document.getElementById('back-button').addEventListener('click', () => showScripts(false));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && views.classList.contains('show-scripts')) showScripts(false);
});

function setPreview(open) {
  scriptCard.classList.toggle('is-preview', open);
  scriptCard.querySelector('.showcase').setAttribute('aria-hidden', String(!open));
  if (open) showcaseVideo.play().catch(() => {});
  else showcaseVideo.pause();
}

scriptCard.addEventListener('pointerenter', event => {
  if (event.pointerType === 'mouse') setPreview(true);
});
scriptCard.addEventListener('pointerleave', () => {
  if (!scriptCard.contains(document.activeElement)) setPreview(false);
});
scriptCard.addEventListener('focusin', () => setPreview(true));
scriptCard.addEventListener('focusout', event => {
  if (!scriptCard.contains(event.relatedTarget)) setPreview(false);
});
