let audioCtx = null;
const activeVoices = new Map(); // id -> { oscillators, gainNodes, ... }
const pressedKeyCodes = new Map(); // code -> info

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Khởi tạo AudioContext ngay từ cú click / phím đầu tiên để triệt tiêu delay
['pointerdown', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => getAudioContext(), { once: true });
});

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Bắt đầu phát nốt (ngân dài khi giữ, hỗ trợ cả Piano và Guitar độc lập)
function startNote(voiceId, midi, isGuitar = false) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if (activeVoices.has(voiceId)) {
    stopNote(voiceId);
  }

  const freq = midiToFreq(midi);

  if (!isGuitar) {
    // Synth Piano
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);

    activeVoices.set(voiceId, {
      oscillators: [osc1, osc2],
      gainNode: gain
    });
  } else {
    // Guitar gảy dây: Dùng Sawtooth + Triangle qua Filter kép
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq, now);

    // Bộ lọc lowpass tạo độ nảy móng gảy
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 5.5, 7500), now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.2, 120), now + 0.35);

    // Envelope gảy nảy tiếng tức thì 0.002s, ngân vang tự nhiên
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);

    const timer = setTimeout(() => {
      stopNote(voiceId);
    }, 2850);

    activeVoices.set(voiceId, {
      oscillators: [osc1, osc2],
      gainNode: gain,
      timer: timer
    });
  }
}

// Buông nốt tắt tiếng tự nhiên
function stopNote(voiceId) {
  if (!activeVoices.has(voiceId)) return;

  const ctx = getAudioContext();
  const voice = activeVoices.get(voiceId);
  const now = ctx.currentTime;

  if (voice.timer) {
    clearTimeout(voice.timer);
  }

  try {
    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(Math.max(voice.gainNode.gain.value, 0.0001), now);
    voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  } catch (e) {}

  setTimeout(() => {
    voice.oscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
  }, 110);

  activeVoices.delete(voiceId);
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
const guideEl = document.getElementById('keyboard-guide');
const legendTitleEl = document.getElementById('legend-title');

/* ========================================================
   1. PIANO LOGIC & MAPPING
   ======================================================== */
const pianoEl = document.getElementById('piano');
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_OFFSETS = [1, 3, null, 6, 8, 10, null];

const PIANO_KEY_MAP = {
  // Trắng: A S D F G H J K L -> Z X C V B
  'KeyA': 48, 'KeyS': 50, 'KeyD': 52, 'KeyF': 53, 'KeyG': 55, 'KeyH': 57, 'KeyJ': 59,
  'KeyK': 60, 'KeyL': 62, 'KeyZ': 64, 'KeyX': 65, 'KeyC': 67, 'KeyV': 69, 'KeyB': 71,

  // Đen: Q W E R T Y U I O P
  'KeyQ': 49, 'KeyW': 51, 'KeyE': 54, 'KeyR': 56, 'KeyT': 58,
  'KeyY': 61, 'KeyU': 63, 'KeyI': 66, 'KeyO': 68, 'KeyP': 70
};

const PIANO_HINTS = {
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
    badge.textContent = PIANO_HINTS[midi] || '';

    key.appendChild(label);
    key.appendChild(sub);
    key.appendChild(badge);

    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      key.setPointerCapture(e.pointerId);
      pressPianoNote(midi, key);
    });
    key.addEventListener('pointerup', () => releasePianoNote(midi, key));
    key.addEventListener('pointercancel', () => releasePianoNote(midi, key));

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
        badge.textContent = PIANO_HINTS[midi] || '';

        bk.appendChild(label);
        bk.appendChild(badge);

        bk.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          bk.setPointerCapture(e.pointerId);
          pressPianoNote(midi, bk);
        });
        bk.addEventListener('pointerup', () => releasePianoNote(midi, bk));
        bk.addEventListener('pointercancel', () => releasePianoNote(midi, bk));

        pianoEl.appendChild(bk);
      }
    });
    whiteIndex += 7;
  }
}
buildPiano();

function pressPianoNote(midi, el) {
  startNote(`p_${midi}`, midi, false);
  if (el) el.classList.add('active');

  if (currentMode === 'quiz' && currentTarget) {
    checkAnswer(midi);
  }
}

function releasePianoNote(midi, el) {
  stopNote(`p_${midi}`);
  if (el) el.classList.remove('active');
}

/* ========================================================
   2. GUITAR LOGIC & INTERFACE
   ======================================================== */
const STRING_OPEN = [64, 59, 55, 50, 45, 40];
const STRING_NAMES = ['E', 'B', 'G', 'D', 'A', 'E'];
const GUITAR_OPEN_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
const FRET_COUNT = 12;
const fretboardEl = document.getElementById('fretboard');

function buildGuitar() {
  fretboardEl.innerHTML = '';
  STRING_OPEN.forEach((openMidi, sIdx) => {
    const row = document.createElement('div');
    row.className = 'string-row';
    row.dataset.string = sIdx;

    // Hộp gảy dây buông bên trái
    const openBox = document.createElement('div');
    openBox.className = 'open-label-box';
    openBox.title = `Gảy dây buông ${STRING_NAMES[sIdx]} (Phím [${sIdx + 1}])`;
    
    const noteSpan = document.createElement('span');
    noteSpan.className = 'open-note';
    noteSpan.textContent = STRING_NAMES[sIdx];

    const keySpan = document.createElement('span');
    keySpan.className = 'open-key';
    keySpan.textContent = `[${sIdx + 1}]`;

    openBox.appendChild(noteSpan);
    openBox.appendChild(keySpan);

    // Click/Chạm gảy dây buông
    openBox.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      openBox.setPointerCapture(e.pointerId);
      pressGuitarString(sIdx, 0, openMidi, openBox);
    });
    openBox.addEventListener('pointerup', () => releaseGuitarString(sIdx, 0, openBox));
    openBox.addEventListener('pointercancel', () => releaseGuitarString(sIdx, 0, openBox));

    row.appendChild(openBox);

    // Các ngăn phím từ ngăn 1 đến 12
    for (let f = 1; f <= FRET_COUNT; f++) {
      const cell = document.createElement('div');
      cell.className = 'fret-cell';
      if ([3, 5, 7, 9, 12].includes(f)) cell.classList.add('marker');

      const midi = openMidi + f;
      cell.dataset.midi = midi;
      cell.dataset.string = sIdx;
      cell.dataset.fret = f;

      const dot = document.createElement('div');
      dot.className = 'dot';

      const dotName = document.createElement('span');
      dotName.className = 'dot-name';
      dotName.textContent = noteName(midi);

      const dotSol = document.createElement('span');
      dotSol.className = 'dot-solfege';
      dotSol.textContent = noteSolfege(midi);

      dot.appendChild(dotName);
      dot.appendChild(dotSol);
      cell.appendChild(dot);

      // Nhấn giữ nốt trên ngăn phím
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        cell.setPointerCapture(e.pointerId);
        pressGuitarString(sIdx, f, midi, cell);
      });
      cell.addEventListener('pointerup', () => releaseGuitarString(sIdx, f, cell));
      cell.addEventListener('pointercancel', () => releaseGuitarString(sIdx, f, cell));

      row.appendChild(cell);
    }
    fretboardEl.appendChild(row);
  });

  // Hàng số thứ tự ngăn phím
  const numRow = document.createElement('div');
  numRow.className = 'fret-numbers';
  for (let f = 1; f <= FRET_COUNT; f++) {
    const s = document.createElement('span');
    s.textContent = f;
    numRow.appendChild(s);
  }
  fretboardEl.appendChild(numRow);
}
buildGuitar();

function pressGuitarString(sIdx, fret, midi, el) {
  const voiceId = `g_${sIdx}_${fret}`;
  startNote(voiceId, midi, true);
  if (el) el.classList.add('active');

  if (currentMode === 'quiz' && currentTarget) {
    checkAnswer(midi);
  }
}

function releaseGuitarString(sIdx, fret, el) {
  const voiceId = `g_${sIdx}_${fret}`;
  stopNote(voiceId);
  if (el) el.classList.remove('active');
}

/* ========================================================
   3. QUIZ & CHUYỂN ĐỔI CHẾ ĐỘ
   ======================================================== */
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

// Cập nhật dòng hướng dẫn linh hoạt theo nhạc cụ đang chọn
function updateGuideText() {
  if (currentView === 'piano') {
    legendTitleEl.textContent = 'Đàn ảo Piano';
    guideEl.innerHTML = '🎹 <b>Phím trắng:</b> A S D F G H J K L &rarr; Z X C V B &bull; <b>Phím đen:</b> Q W E R T Y U I O P';
  } else {
    legendTitleEl.textContent = 'Đàn ảo Guitar';
    guideEl.innerHTML = '🎸 <b>Gảy dây buông:</b> Phím số <b>[1] đến [6]</b> (hoặc click tên dây) &bull; <b>Bấm ngăn phím:</b> Chạm / click trực tiếp các ô trên cần đàn!';
  }
}

// Chuyển tab Piano / Guitar
document.querySelectorAll('.pill-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentView = btn.dataset.view;
    document.getElementById('piano-view').classList.toggle('active', currentView === 'piano');
    document.getElementById('guitar-view').classList.toggle('active', currentView === 'guitar');

    updateGuideText();
    if (currentMode === 'quiz') newQuestion();
  });
});

// Chế độ Tự do / Trắc nghiệm
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentMode = btn.dataset.mode;
    const isQuiz = currentMode === 'quiz';

    quizPromptEl.style.display = isQuiz ? 'block' : 'none';
    newQuestionBtn.style.display = isQuiz ? 'inline-block' : 'none';

    // Ẩn/Hiện nốt khi làm bài kiểm tra
    document.querySelectorAll('.white-key .label, .white-key .sub-label, .white-key .key-badge, .black-key .label, .black-key .key-badge').forEach(l => {
      l.style.visibility = isQuiz ? 'hidden' : 'visible';
    });
    document.querySelectorAll('.fret-cell .dot').forEach(d => {
      d.style.visibility = isQuiz ? 'hidden' : 'visible';
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

/* ========================================================
   4. BÀN PHÍM PC (PHÂN TÁCH RIÊNG PIANO VÀ GUITAR RÕ RÀNG)
   ======================================================== */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const code = e.code;

  if (currentView === 'piano') {
    if (PIANO_KEY_MAP[code]) {
      const midi = PIANO_KEY_MAP[code];
      pressedKeyCodes.set(code, { type: 'piano', midi });
      const el = pianoEl.querySelector(`[data-midi="${midi}"]`);
      pressPianoNote(midi, el);
    }
  } else {
    // GUITAR: Bấm phím số 1 đến 6 (cả hàng số trên và Numpad) để gảy dây buông chuẩn xác!
    let stringIdx = -1;
    if (code === 'Digit1' || code === 'Numpad1') stringIdx = 0;
    else if (code === 'Digit2' || code === 'Numpad2') stringIdx = 1;
    else if (code === 'Digit3' || code === 'Numpad3') stringIdx = 2;
    else if (code === 'Digit4' || code === 'Numpad4') stringIdx = 3;
    else if (code === 'Digit5' || code === 'Numpad5') stringIdx = 4;
    else if (code === 'Digit6' || code === 'Numpad6') stringIdx = 5;

    if (stringIdx !== -1) {
      const midi = STRING_OPEN[stringIdx];
      const row = fretboardEl.querySelector(`.string-row[data-string="${stringIdx}"]`);
      const openBox = row ? row.querySelector('.open-label-box') : null;
      pressedKeyCodes.set(code, { type: 'guitar', stringIdx, fret: 0, el: openBox });
      pressGuitarString(stringIdx, 0, midi, openBox);
    }
  }
});

window.addEventListener('keyup', (e) => {
  const code = e.code;
  if (pressedKeyCodes.has(code)) {
    const info = pressedKeyCodes.get(code);
    pressedKeyCodes.delete(code);

    if (info.type === 'piano') {
      const el = pianoEl.querySelector(`[data-midi="${info.midi}"]`);
      releasePianoNote(info.midi, el);
    } else if (info.type === 'guitar') {
      releaseGuitarString(info.stringIdx, info.fret, info.el);
    }
  }
});

window.addEventListener('blur', () => {
  pressedKeyCodes.forEach((info) => {
    if (info.type === 'piano') {
      const el = pianoEl.querySelector(`[data-midi="${info.midi}"]`);
      releasePianoNote(info.midi, el);
    } else if (info.type === 'guitar') {
      releaseGuitarString(info.stringIdx, info.fret, info.el);
    }
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

// Khởi tạo dòng hướng dẫn ban đầu
updateGuideText();
