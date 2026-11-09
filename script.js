
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playNote(midi) {
  ensureAudio();
  const freq = midiToFreq(midi);
  const now = audioCtx.currentTime;

  if (currentView === 'piano') {

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now); // Overtone

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.25);
    osc2.stop(now + 1.25);
  } else {
   
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4.5, now);
    filter.frequency.exponentialRampToValueAtTime(freq, now + 0.35);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.32, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

    osc.connect(filter).connect(gain).connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 1.05);
  }
}

function playTone(type) {
  ensureAudio();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  if (type === 'success') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.08); // A5
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = ['Đô', 'Đô#', 'Rê', 'Rê#', 'Mi', 'Fa', 'Fa#', 'Son', 'Son#', 'La', 'La#', 'Si'];

function noteName(midi) {
  return NOTE_NAMES[midi % 12];
}

function noteSolfege(midi) {
  return SOLFEGE[midi % 12];
}

let currentView = 'piano';
let currentMode = 'free';
let score = 0;
let streak = 0;
let currentTarget = null;

const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const feedbackEl = document.getElementById('feedback');
const quizPromptEl = document.getElementById('quiz-prompt');
const quizTargetEl = document.getElementById('quiz-target');
const newQuestionBtn = document.getElementById('new-question');

const pianoEl = document.getElementById('piano');
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_OFFSETS = [1, 3, null, 6, 8, 10, null];
const KEY_MAP = {

  'a': 48, 's': 50, 'd': 52, 'f': 53, 'g': 55, 'h': 57, 'j': 59,
  'k': 60, 'l': 62, ';': 64, "'": 65,

  'w': 49, 'e': 51, 't': 54, 'y': 56, 'u': 58,
  'o': 61, 'p': 63, ']': 66
};

function buildPiano() {
  pianoEl.innerHTML = '';
  const startMidi = 48; // C3
  const octaves = 2;
  const whiteKeys = [];

  for (let o = 0; o < octaves; o++) {
    WHITE_OFFSETS.forEach(off => {
      whiteKeys.push(startMidi + o * 12 + off);
    });
  }

  const totalWhite = whiteKeys.length;
  whiteKeys.forEach(midi => {
    const key = document.createElement('div');
    key.className = 'white-key';
    key.dataset.midi = midi;

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = noteName(midi) + Math.floor(midi / 12 - 1);

    const sub = document.createElement('div');
    sub.className = 'sub-label';
    sub.textContent = noteSolfege(midi);

    key.appendChild(label);
    key.appendChild(sub);
    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleNotePlayed(midi, key);
    });
    pianoEl.appendChild(key);
  });

  const whiteWidthPct = 100 / totalWhite;
  let whiteIndex = 0;

  for (let o = 0; o < octaves; o++) {
    BLACK_OFFSETS.forEach((off, i) => {
      if (off !== null) {
        const midi = startMidi + o * 12 + off;
        const bk = document.createElement('div');
        bk.className = 'black-key';
        bk.dataset.midi = midi;

        const leftPct = (whiteIndex + i + 1) * whiteWidthPct - (whiteWidthPct * 0.32);
        bk.style.left = leftPct + '%';

        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = noteName(midi);

        bk.appendChild(label);
        bk.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleNotePlayed(midi, bk);
        });
        pianoEl.appendChild(bk);
      }
    });
    whiteIndex += 7;
  }
}
buildPiano();

const STRING_OPEN = [64, 59, 55, 50, 45, 40];
const STRING_LABELS = ['E', 'B', 'G', 'D', 'A', 'E'];
const FRET_COUNT = 12;
const fretboardEl = document.getElementById('fretboard');

function buildGuitar() {
  fretboardEl.innerHTML = '';
  STRING_OPEN.forEach((openMidi, sIdx) => {
    const row = document.createElement('div');
    row.className = 'string-row';

    const label = document.createElement('div');
    label.className = 'open-label';
    label.textContent = STRING_LABELS[sIdx];
    row.appendChild(label);

    for (let f = 0; f <= FRET_COUNT; f++) {
      const cell = document.createElement('div');
      cell.className = 'fret-cell';
      if ([3, 5, 7, 9, 12].includes(f)) cell.classList.add('marker');

      const midi = openMidi + f;
      cell.dataset.midi = midi;

      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.textContent = noteName(midi);

      cell.appendChild(dot);
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handleNotePlayed(midi, cell);
      });
      row.appendChild(cell);
    }
    fretboardEl.appendChild(row);
  });

  const numRow = document.createElement('div');
  numRow.className = 'fret-numbers';
  const spacer = document.createElement('span');
  spacer.className = 'open-label';
  numRow.appendChild(spacer);

  for (let f = 0; f <= FRET_COUNT; f++) {
    const s = document.createElement('span');
    s.textContent = f;
    numRow.appendChild(s);
  }
  fretboardEl.appendChild(numRow);
}
buildGuitar();

function handleNotePlayed(midi, el) {
  playNote(midi);
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 250);

  if (currentMode === 'quiz' && currentTarget) {
    checkAnswer(midi);
  }
}

function checkAnswer(midi) {
  const isCorrect = noteName(midi) === noteName(currentTarget.midi);

  if (isCorrect) {
    score += 10;
    streak += 1;
    playTone('success');
    feedbackEl.textContent = `Chính xác! Đó là nốt ${noteName(midi)} (${noteSolfege(midi)}).`;
    feedbackEl.className = 'feedback ok';
    setTimeout(newQuestion, 800);
  } else {
    streak = 0;
    playTone('wrong');
    feedbackEl.textContent = `Chưa đúng, bạn vừa chọn nốt ${noteName(midi)}. Thử lại nhé!`;
    feedbackEl.className = 'feedback bad';
  }

  scoreEl.textContent = score;
  streakEl.textContent = streak;
}

function newQuestion() {
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback';

  let midi;
  if (currentView === 'piano') {
    const cells = pianoEl.querySelectorAll('[data-midi]');
    const list = Array.from(cells);
    midi = parseInt(list[Math.floor(Math.random() * list.length)].dataset.midi, 10);
  } else {
    const cells = fretboardEl.querySelectorAll('.fret-cell[data-midi]');
    const list = Array.from(cells);
    midi = parseInt(list[Math.floor(Math.random() * list.length)].dataset.midi, 10);
  }

  currentTarget = { midi };
  quizTargetEl.textContent = `${noteName(midi)} (${noteSolfege(midi)})`;
}

document.querySelectorAll('.pill-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentView = btn.dataset.view;
    document.getElementById('piano-view').classList.toggle('active', currentView === 'piano');
    document.getElementById('guitar-view').classList.toggle('active', currentView === 'guitar');

    if (currentMode === 'quiz') newQuestion();
  });
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentMode = btn.dataset.mode;
    const isQuiz = currentMode === 'quiz';

    quizPromptEl.style.display = isQuiz ? 'block' : 'none';
    newQuestionBtn.style.display = isQuiz ? 'inline-block' : 'none';

    // Ẩn tên nốt khi làm bài kiểm tra
    document.querySelectorAll('.white-key .label, .white-key .sub-label, .black-key .label').forEach(l => {
      l.style.visibility = isQuiz ? 'hidden' : 'visible';
    });
    document.querySelectorAll('.fret-cell .dot').forEach(d => {
      d.style.color = isQuiz ? 'transparent' : '#FFFFFF';
    });

    feedbackEl.textContent = '';
    if (isQuiz) {
      score = 0;
      streak = 0;
      scoreEl.textContent = 0;
      streakEl.textContent = 0;
      newQuestion();
    }
  });
});

newQuestionBtn.addEventListener('click', () => {
  if (currentMode === 'quiz') newQuestion();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (KEY_MAP[key] && currentView === 'piano') {
    const midi = KEY_MAP[key];
    const el = pianoEl.querySelector(`[data-midi="${midi}"]`);
    if (el) handleNotePlayed(midi, el);
  }
});
