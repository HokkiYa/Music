let audioCtx = null;
const activeVoices = new Map(); // Lưu trữ: midi -> { oscillators, gainNode }
const pressedKeyCodes = new Map(); // Lưu trữ: e.code -> midi

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Mở AudioContext ngay khi tương tác để triệt tiêu delay
['pointerdown', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => getAudioContext(), { once: true });
});

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Bắt đầu phát nốt (ngân dài khi giữ, hỗ trợ đánh nhiều phím/hợp âm)
function startNote(midi) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if (activeVoices.has(midi)) {
    stopNote(midi);
  }

  const freq = midiToFreq(midi);

  if (currentView === 'piano') {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now); // Bồi âm

    // Attack cực nhanh 0.003s không delay, giữ âm lượng sustain
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);

    activeVoices.set(midi, {
      oscillators: [osc1, osc2],
      gainNode: gain
    });
  } else {
    // Guitar
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4.5, now);
    filter.exponentialRampToValueAtTime(freq, now + 0.35);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.32, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

    osc.connect(filter).connect(gain).connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 1.25);

    activeVoices.set(midi, {
      oscillators: [osc],
      gainNode: gain
    });
  }
}

// Buông phím tắt tiếng tự nhiên
function stopNote(midi) {
  if (!activeVoices.has(midi)) return;

  const ctx = getAudioContext();
  const voice = activeVoices.get(midi);
  const now = ctx.currentTime;

  voice.gainNode.gain.cancelScheduledValues(now);
  voice.gainNode.gain.setValueAtTime(Math.max(voice.gainNode.gain.value, 0.0001), now);
  voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  setTimeout(() => {
    voice.oscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
  }, 130);

  activeVoices.delete(midi);
}

function playTone(type) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  if (type === 'success') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(ctx.destination);
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

/*
  ÁNH XẠ PHÍM BÀN PHÍM VẬT LÝ (e.code):
  - Phím trắng: A S D F G H J K L -> Z X C V B
  - Phím đen: Toàn bộ hàng Q W E R T Y U I O P (10 phím đen liên tục theo thứ tự)
*/
const CODE_TO_MIDI = {
  // Hàng phím trắng (14 phím)
  'KeyA': 48, // C3
  'KeyS': 50, // D3
  'KeyD': 52, // E3
  'KeyF': 53, // F3
  'KeyG': 55, // G3
  'KeyH': 57, // A3
  'KeyJ': 59, // B3
  'KeyK': 60, // C4
  'KeyL': 62, // D4
  'KeyZ': 64, // E4
  'KeyX': 65, // F4
  'KeyC': 67, // G4
  'KeyV': 69, // A4
  'KeyB': 71, // B4

  // Hàng phím đen (10 phím) - Nguyên hàng Q W E R T Y U I O P
  'KeyQ': 49, // C#3
  'KeyW': 51, // D#3
  'KeyE': 54, // F#3
  'KeyR': 56, // G#3
  'KeyT': 58, // A#3
  'KeyY': 61, // C#4
  'KeyU': 63, // D#4
  'KeyI': 66, // F#4
  'KeyO': 68, // G#4
  'KeyP': 70  // A#4
};

// Nhãn hiển thị trên từng phím
const MIDI_TO_HINT = {
  48: 'A', 49: 'Q', 50: 'S', 51: 'W', 52: 'D', 53: 'F', 54: 'E', 55: 'G', 56: 'R', 57: 'H', 58: 'T', 59: 'J',
  60: 'K', 61: 'Y', 62: 'L', 63: 'U', 64: 'Z', 65: 'X', 66: 'I', 67: 'C', 68: 'O', 69: 'V', 70: 'P', 71: 'B'
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

    const badge = document.createElement('div');
    badge.className = 'key-badge';
    badge.textContent = MIDI_TO_HINT[midi] || '';

    key.appendChild(label);
    key.appendChild(sub);
    key.appendChild(badge);

    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      key.setPointerCapture(e.pointerId);
      pressNote(midi, key);
    });
    key.addEventListener('pointerup', () => releaseNote(midi, key));
    key.addEventListener('pointercancel', () => releaseNote(midi, key));

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

        const badge = document.createElement('div');
        badge.className = 'key-badge';
        badge.textContent = MIDI_TO_HINT[midi] || '';

        bk.appendChild(label);
        bk.appendChild(badge);

        bk.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          bk.setPointerCapture(e.pointerId);
          pressNote(midi, bk);
        });
        bk.addEventListener('pointerup', () => releaseNote(midi, bk));
        bk.addEventListener('pointercancel', () => releaseNote(midi, bk));

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
        pressNote(midi, cell);
      });
      cell.addEventListener('pointerup', () => releaseNote(midi, cell));
      cell.addEventListener('pointerleave', () => releaseNote(midi, cell));

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

function pressNote(midi, el) {
  startNote(midi);
  if (el) el.classList.add('active');

  if (currentMode === 'quiz' && currentTarget) {
    checkAnswer(midi);
  }
}

function releaseNote(midi, el) {
  stopNote(midi);
  if (el) el.classList.remove('active');
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

// Chuyển nhạc cụ
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

// Chế độ chơi
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentMode = btn.dataset.mode;
    const isQuiz = currentMode === 'quiz';

    quizPromptEl.style.display = isQuiz ? 'block' : 'none';
    newQuestionBtn.style.display = isQuiz ? 'inline-block' : 'none';

    document.querySelectorAll('.white-key .label, .white-key .sub-label, .white-key .key-badge, .black-key .label, .black-key .key-badge').forEach(l => {
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

// LẮNG NGHE BÀN PHÍM PC VẬT LÝ e.code
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;

  const code = e.code;
  if (CODE_TO_MIDI[code] && currentView === 'piano') {
    const midi = CODE_TO_MIDI[code];
    pressedKeyCodes.set(code, midi);
    
    const el = pianoEl.querySelector(`[data-midi="${midi}"]`);
    pressNote(midi, el);
  }
});

window.addEventListener('keyup', (e) => {
  const code = e.code;
  if (pressedKeyCodes.has(code)) {
    const midi = pressedKeyCodes.get(code);
    pressedKeyCodes.delete(code);

    const el = pianoEl.querySelector(`[data-midi="${midi}"]`);
    releaseNote(midi, el);
  }
});

window.addEventListener('blur', () => {
  pressedKeyCodes.forEach((midi, code) => {
    const el = pianoEl.querySelector(`[data-midi="${midi}"]`);
    releaseNote(midi, el);
  });
  pressedKeyCodes.clear();
});

// Tải ảnh nền trực tiếp từ máy tính
const bgLayer = document.getElementById('bg-layer');
document.getElementById('bg-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      bgLayer.style.backgroundImage = `url('${evt.target.result}')`;
    };
    reader.readAsDataURL(file);
  }
});
