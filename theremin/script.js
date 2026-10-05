const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const VOICE_COLORS = ['#d9480f', '#1971c2', '#2f9e44', '#9c36b5', '#e8590c', '#0c8599', '#c2255c', '#5c940d', '#6741d9', '#f08c00'];

const canvas = document.getElementById('pad');
const ctx2d = canvas.getContext('2d');
const startButton = document.getElementById('start');
const multiToggle = document.getElementById('multi');
const discreteToggle = document.getElementById('discrete');
const fieldSelect = document.getElementById('field');
const notesToggle = document.getElementById('show-notes');
const separateToggle = document.getElementById('separate');
const rangeSelect = document.getElementById('range');
const toneSelect = document.getElementById('tone');
const roomToggle = document.getElementById('room');
const readout = document.getElementById('readout');
const guideBar = document.getElementById('guide-bar');
const guideSelect = document.getElementById('guide');
const guideRestart = document.getElementById('guide-restart');
const guideStatus = document.getElementById('guide-status');
const scoreToggleLabel = document.getElementById('score-toggle');
const pianoToggleLabel = document.getElementById('piano-toggle');
const pianoToggle = document.getElementById('piano');
const scoreToggle = document.getElementById('show-score');
const scorePanel = document.getElementById('score-panel');
const scoreEl = document.getElementById('score');

let audio = null;
let master = null;
let roomSend = null;
let waves = null;
let pianoBus = null;
let pianoWave = null;

// Pointers currently on the pad, in the order they arrived:
// id -> { x, y, type, role }. Mouse pointers count while hovering over the pad;
// touch and pen pointers while in contact with it. With separate volume, a
// pointer's role is 'volume' if it's in the volume strip and 'pitch' otherwise.
const pointers = new Map();
// The volume strip works like a fader: it keeps its level when you let go.
let stripVolume = 0.8;
// Sounding voices, keyed by pointer id (multitouch) or 'single'.
const voices = new Map();
let colorIndex = 0;

// Pitch range: the pad spans `noteSpan` semitones starting from `lowMidi`.
// Each semitone gets one column (its pitch, give or take half a semitone), so
// the lowest and highest notes keep a half-column margin at the edges.
let lowMidi = 48;
let noteSpan = 37;

// The pitch field. A modern theremin like the Moog Etherwave is built to be
// linear: every octave takes the same hand distance, so the notes are evenly
// spaced. Without that correction, pitch goes roughly as 1/distance from the
// antenna, so each octave is half as wide as the one below it and the notes
// crowd together toward the high end.
const UNCORRECTED_OCTAVE_SHRINK = 0.5;

function fieldIsLinear() {
  return fieldSelect.value === 'linear';
}

function noteCount() {
  return noteSpan;
}

// Pad fraction (0 = left edge, 1 = right edge) <-> semitones above the left edge.
function semitonesAt(fraction) {
  const span = noteCount();
  if (fieldIsLinear()) return fraction * span;
  const total = 1 - Math.pow(UNCORRECTED_OCTAVE_SHRINK, span / 12);
  return 12 * Math.log(1 - fraction * total) / Math.log(UNCORRECTED_OCTAVE_SHRINK);
}

function fractionAt(semitones) {
  const span = noteCount();
  if (fieldIsLinear()) return semitones / span;
  const shrink = UNCORRECTED_OCTAVE_SHRINK;
  return (1 - Math.pow(shrink, semitones / 12)) / (1 - Math.pow(shrink, span / 12));
}

// With separate volume, the left of the pad is a volume strip (the theremin's
// volume loop) and pitch uses the rest (the pitch antenna).
function stripWidth() {
  if (!separateToggle.checked) return 0;
  return Math.round(Math.min(Math.max(canvas.clientWidth * 0.18, 56), 120));
}

function midiAt(x) {
  const left = stripWidth();
  const fraction = Math.min(Math.max((x - left) / (canvas.clientWidth - left), 0), 1);
  const midi = lowMidi - 0.5 + semitonesAt(fraction);
  const clamped = Math.min(Math.max(midi, lowMidi), lowMidi + noteCount() - 1);
  return discreteToggle.checked ? Math.round(clamped) : clamped;
}

function xAtMidi(midi) {
  const left = stripWidth();
  return left + fractionAt(midi - lowMidi + 0.5) * (canvas.clientWidth - left);
}

function volumeAt(y) {
  return Math.min(Math.max(1 - y / canvas.clientHeight, 0), 1);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteName(midi) {
  const rounded = Math.round(midi);
  return NOTE_NAMES[((rounded % 12) + 12) % 12] + (Math.floor(rounded / 12) - 1);
}

function setRange(value) {
  const octaves = Number(value);
  noteSpan = octaves * 12 + 1;
  // Keep the range centred around middle C-ish: 1–2 octaves start at C4/C3.
  lowMidi = octaves <= 2 ? 60 - 12 * (octaves - 1) : 48 - 12 * (octaves - 3);
  rangeSelect.value = String(octaves);
}

// --- Audio -----------------------------------------------------------------

// A real theremin's note is the beat between two radio oscillators: their
// signals are mixed and a detector picks out the envelope of the sum, which
// rises and falls once per beat. With one signal `mix` times as strong as the
// other, that envelope over one beat is |1 + mix·e^(iφ)|. A detector that
// only conducts above `threshold` keeps just the tops of the beat, which
// makes narrow peaks with more upper harmonics: brighter and more nasal, much
// like turning up the waveform knob on a modern theremin.
const TONES = {
  classic: { mix: 0.85, threshold: 0 },
  bright: { mix: 0.95, threshold: 1.5 },
  pure: null, // An ideal mixer gives a plain sine.
};

// Reverb send level: on a held note the room sits about 15 dB under the dry
// sound, enough to place the instrument in a space without washing it out.
const ROOM_LEVEL = 0.7;

function toneWave(tone) {
  const harmonics = 32;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  if (!tone) {
    real[1] = 1;
  } else {
    const steps = 2048;
    const beat = new Float32Array(steps);
    for (let j = 0; j < steps; j++) {
      const envelope = Math.sqrt(1 + tone.mix * tone.mix + 2 * tone.mix * Math.cos(2 * Math.PI * j / steps));
      beat[j] = Math.max(envelope - tone.threshold, 0);
    }
    for (let n = 1; n <= harmonics; n++) {
      let sum = 0;
      for (let j = 0; j < steps; j++) sum += beat[j] * Math.cos(2 * Math.PI * n * j / steps);
      real[n] = 2 * sum / steps;
    }
  }
  // Match loudness (RMS) across tones rather than peak level, so switching
  // tone doesn't make the narrow-peaked ones sound quieter.
  const norm = Math.hypot(...real);
  for (let n = 1; n <= harmonics; n++) real[n] /= norm;
  return audio.createPeriodicWave(real, imag, { disableNormalization: true });
}

// A small room: decaying noise that gets darker as it fades, like walls and
// air soaking up the highs first.
function roomImpulse() {
  const rate = audio.sampleRate;
  const decaySeconds = 1.4; // Time to fall by 60 dB.
  const length = Math.round(rate * decaySeconds);
  const preDelay = Math.round(rate * 0.015);
  const impulse = audio.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let smoothed = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / rate;
      const damping = 0.2 + 0.7 * Math.min(t / decaySeconds, 1);
      smoothed += (1 - damping) * (Math.random() * 2 - 1 - smoothed);
      data[i] = smoothed * Math.exp(-6.9 * t / decaySeconds);
    }
  }
  return impulse;
}

function startAudio() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    waves = {};
    for (const [name, tone] of Object.entries(TONES)) waves[name] = toneWave(tone);

    master = audio.createGain();
    master.gain.value = 0.6;
    // The instrument's amplifier and speaker: no deep bass, soft top end. A
    // fixed roll-off also means low notes keep more overtones than high ones,
    // as on the real thing.
    const speakerLow = audio.createBiquadFilter();
    speakerLow.type = 'highpass';
    speakerLow.frequency.value = 70;
    speakerLow.Q.value = 0.5;
    const speakerHigh = audio.createBiquadFilter();
    speakerHigh.type = 'lowpass';
    speakerHigh.frequency.value = 5000;
    speakerHigh.Q.value = 0.5;
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    master.connect(speakerLow).connect(speakerHigh).connect(compressor).connect(audio.destination);

    const room = audio.createConvolver();
    room.buffer = roomImpulse();
    roomSend = audio.createGain();
    roomSend.gain.value = roomToggle.checked ? ROOM_LEVEL : 0;
    speakerHigh.connect(room).connect(roomSend).connect(compressor);

    // The accompanying piano skips the theremin's speaker but shares the room.
    pianoBus = audio.createGain();
    pianoBus.gain.value = 0.5;
    pianoBus.connect(compressor);
    pianoBus.connect(room);
    pianoWave = pianoTone();

    audio.addEventListener('statechange', updateStartButton);
  }
  // Safari only unlocks audio from certain gestures (touchend/click, not
  // touchstart), and can drop back to 'interrupted' after a call or lock, so
  // retry on every gesture and keep the button up until sound is really on.
  if (audio.state !== 'running') audio.resume().catch(() => {});
  playThroughSilentSwitch();
  updateStartButton();
}

function updateStartButton() {
  startButton.hidden = !!audio && audio.state === 'running';
}

// iOS routes Web Audio through the "ambient" session, which the ring/silent
// switch mutes. Ask for the "playback" session instead (Safari 17+); on older
// versions, looping a silent <audio> element has the same effect.
let silentLoop = null;
function playThroughSilentSwitch() {
  if (navigator.audioSession) {
    navigator.audioSession.type = 'playback';
    return;
  }
  if (!silentLoop) {
    silentLoop = new Audio(silentWavUrl());
    silentLoop.loop = true;
    silentLoop.setAttribute('playsinline', '');
  }
  if (silentLoop.paused) silentLoop.play().catch(() => {});
}

function silentWavUrl() {
  const rate = 8000;
  const samples = rate / 10;
  const view = new DataView(new ArrayBuffer(44 + samples));
  const text = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
}

class Voice {
  constructor(color) {
    this.color = color;
    this.osc = audio.createOscillator();
    this.osc.setPeriodicWave(waves[toneSelect.value]);
    this.gain = audio.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.gain).connect(master);
    this.osc.start();
    this.midi = null;
    this.volume = 0;
    this.sounding = false;
  }

  update(midi, volume) {
    const now = audio.currentTime;
    const freq = midiToFreq(midi);
    const param = this.osc.frequency;
    if (!this.sounding || discreteToggle.checked) {
      // Coming out of silence, or in discrete mode: jump straight to the note.
      if (!this.sounding || midi !== this.midi) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(freq, now);
      }
    } else {
      // Continuous: glide, but quickly enough to feel attached to the hand, so
      // wobbling a finger gives real vibrato (there's no automatic vibrato).
      param.cancelScheduledValues(now);
      param.setTargetAtTime(freq, now, 0.012);
    }
    // Squared so the bottom of the pad fades out gradually rather than abruptly.
    this.gain.gain.setTargetAtTime(volume * volume * 0.35, now, 0.015);
    this.midi = midi;
    this.volume = volume;
    this.sounding = true;
  }

  silence() {
    if (!this.sounding) return;
    this.gain.gain.setTargetAtTime(0, audio.currentTime, 0.03);
    this.sounding = false;
  }

  dispose() {
    this.silence();
    this.osc.stop(audio.currentTime + 0.3);
  }
}

function nextColor() {
  return VOICE_COLORS[colorIndex++ % VOICE_COLORS.length];
}

// Bring the set of voices in line with the set of pointers.
function sync() {
  if (!audio || audio.state === 'closed') return;
  const pitched = pitchPointers();
  const volumeHands = [...pointers.values()].filter((p) => p.role === 'volume');
  if (volumeHands.length) stripVolume = volumeAt(volumeHands.pop().y);

  const wanted = new Map();
  if (multiToggle.checked) {
    for (const [id, p] of pitched) wanted.set(id, p);
  } else if (pitched.length) {
    // Single voice follows the most recent finger; lifting it falls back to
    // whichever finger is still down.
    wanted.set('single', pitched[pitched.length - 1][1]);
  }

  for (const [key, voice] of voices) {
    if (!wanted.has(key)) {
      if (key === 'single') {
        voice.silence();
      } else {
        voice.dispose();
        voices.delete(key);
      }
    }
  }
  for (const [key, p] of wanted) {
    let voice = voices.get(key);
    if (!voice) {
      voice = new Voice(key === 'single' ? '#d9480f' : nextColor());
      voices.set(key, voice);
    }
    voice.update(midiAt(p.x), separateToggle.checked ? stripVolume : volumeAt(p.y));
  }
  updateReadout();
}

function pitchPointers() {
  return [...pointers.entries()].filter(([, p]) => p.role === 'pitch');
}

function setStripVolume(volume) {
  stripVolume = Math.min(Math.max(volume, 0), 1);
  sync();
}

function resetVoices() {
  for (const voice of voices.values()) voice.dispose();
  voices.clear();
  colorIndex = 0;
  sync();
}

function updateReadout() {
  const parts = [];
  for (const voice of voices.values()) {
    if (!voice.sounding) continue;
    const name = noteName(voice.midi);
    const cents = Math.round((voice.midi - Math.round(voice.midi)) * 100);
    const centsText = discreteToggle.checked || cents === 0 ? '' : ` ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`;
    parts.push(`<span style="color:${voice.color}">${name}${centsText} · ${midiToFreq(voice.midi).toFixed(1)} Hz · ${Math.round(voice.volume * 100)}%</span>`);
  }
  readout.innerHTML = parts.length ? parts.join(' &nbsp; ') : '&nbsp;';
}

// --- Input -----------------------------------------------------------------

function localPoint(event, role) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return { x, y, type: event.pointerType, role: role || (x < stripWidth() ? 'volume' : 'pitch') };
}

function isHoverPointer(event) {
  return event.pointerType === 'mouse';
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  startAudio();
  if (!isHoverPointer(event)) {
    // Keep tracking a finger that slides off the edge (its position is clamped).
    try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* already gone */ }
  }
  pointers.set(event.pointerId, localPoint(event));
  sync();
});

canvas.addEventListener('pointermove', (event) => {
  if (!audio) return;
  const existing = pointers.get(event.pointerId);
  if (isHoverPointer(event) || existing) {
    // A finger keeps the role it started with, so sliding a pitch finger
    // into the strip doesn't suddenly turn it into a volume control. The
    // mouse is one hand doing both jobs, so its role follows where it is.
    const role = isHoverPointer(event) ? null : existing.role;
    pointers.set(event.pointerId, localPoint(event, role));
    sync();
  }
});

function release(event) {
  if (isHoverPointer(event) && event.type === 'pointerup') return;
  if (pointers.delete(event.pointerId)) sync();
}

canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', (event) => {
  // Captured touches keep playing past the edge (clamped); a hovering mouse
  // stops as soon as it leaves the pad.
  if (isHoverPointer(event)) release(event);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
// A mouse can't be in the strip and on the pitch side at once, so the scroll
// wheel, or a two-finger swipe on a trackpad, also moves the volume.
canvas.addEventListener('wheel', (event) => {
  if (!separateToggle.checked) return;
  event.preventDefault();
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  setStripVolume(stripVolume - pixels / canvas.clientHeight);
}, { passive: false });
startButton.addEventListener('click', startAudio);
// Any tap on the page is a chance to unlock audio on iOS.
document.addEventListener('touchend', startAudio, true);
document.addEventListener('click', startAudio, true);

// The pointer leaving the window or the tab hiding shouldn't leave a note droning.
window.addEventListener('blur', () => { pointers.clear(); sync(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pointers.clear(); sync(); }
});

multiToggle.addEventListener('change', resetVoices);
discreteToggle.addEventListener('change', sync);
fieldSelect.addEventListener('change', sync);
function assignRoles() {
  for (const p of pointers.values()) p.role = p.x < stripWidth() ? 'volume' : 'pitch';
  resetVoices();
}
separateToggle.addEventListener('change', assignRoles);
rangeSelect.addEventListener('change', () => { setRange(rangeSelect.value); sync(); });
toneSelect.addEventListener('change', () => {
  if (!audio) return;
  for (const voice of voices.values()) voice.osc.setPeriodicWave(waves[toneSelect.value]);
});
roomToggle.addEventListener('change', () => {
  if (roomSend) roomSend.gain.setTargetAtTime(roomToggle.checked ? ROOM_LEVEL : 0, audio.currentTime, 0.05);
});

// --- Guided play -----------------------------------------------------------

// Within this many semitones of the written note counts as in tune.
const GUIDE_TOLERANCE = 0.4;
// Below this volume counts as silent, for rests.
const SILENT_BELOW = 0.05;
// A theremin slides between notes, so near each end of a note the player
// may already be gliding away from it or still gliding in: up to this long,
// and never more than this share of a short note.
const GLIDE_SECONDS = 0.25;
const GLIDE_SHARE = 0.35;

// The piece being played: its notes as { midi, start, beats } (midi is null
// for a rest), and how far into it the player has got, in beats.
let guide = null;
let lastFrame = null;
// Each song's built timeline, kept so a restart reuses the engraved score.
const pieces = {};
// The player's own range, to go back to after a piece.
let freeRange = null;

function startGuide() {
  const song = SONGS.find((s) => s.id === guideSelect.value);
  if (!song) {
    stopGuide();
    return;
  }
  if (!guide) freeRange = rangeSelect.value;
  silencePiano();
  startAudio();
  const piece = pieces[song.id] || (pieces[song.id] = buildPiece(song));
  guide = {
    song, piece, notes: piece.notes, length: piece.length,
    beat: 0, elapsed: 0, started: false, done: false, status: '',
    pianoNext: 0, pianoActive: [],
  };
  pianoToggleLabel.hidden = !piece.piano.length;

  // Fit the pad to the piece, with a semitone to spare either side.
  lowMidi = piece.low - 1;
  noteSpan = piece.high - piece.low + 3;
  rangeSelect.disabled = true;
  // The notes fall down the pitch side, so height has to be free there.
  separateToggle.checked = true;
  separateToggle.disabled = true;
  notesToggle.checked = true;
  guideRestart.hidden = false;
  guideStatus.hidden = false;
  scoreToggleLabel.hidden = false;
  assignRoles();
  showScore();
}

function stopGuide() {
  silencePiano();
  guide = null;
  pianoToggleLabel.hidden = true;
  guideSelect.value = '';
  rangeSelect.disabled = false;
  separateToggle.disabled = false;
  guideRestart.hidden = true;
  guideStatus.hidden = true;
  scoreToggleLabel.hidden = true;
  scorePanel.hidden = true;
  if (freeRange) setRange(freeRange);
  sync();
}

function guideNote() {
  return guide.notes.find((n) => guide.beat >= n.start && guide.beat < n.start + n.beats) || null;
}

// The sounding voice nearest the given pitch, if any.
function nearestVoice(midi) {
  let best = null;
  for (const voice of voices.values()) {
    if (!voice.sounding || voice.volume < SILENT_BELOW) continue;
    if (!best || Math.abs(voice.midi - midi) < Math.abs(best.midi - midi)) best = voice;
  }
  return best;
}

// Silent means the pitch finger is lifted or the volume is all the way down.
function isSilent() {
  return ![...voices.values()].some((v) => v.sounding && v.volume >= SILENT_BELOW);
}

function onPitch(midi) {
  const voice = nearestVoice(midi);
  return !!voice && Math.abs(voice.midi - midi) <= GUIDE_TOLERANCE;
}

// Somewhere on the slide between two pitches (or on either end of it).
function between(from, to) {
  const voice = nearestVoice(to);
  return !!voice && voice.midi >= Math.min(from, to) - GUIDE_TOLERANCE && voice.midi <= Math.max(from, to) + GUIDE_TOLERANCE;
}

// Whether the player is doing what's written at this point in the note:
// on the note (or silent, for a rest), or, close to either end of it,
// gliding between it and its neighbour.
function onTrack(note) {
  if (note.midi === null ? isSilent() : onPitch(note.midi)) return true;
  const index = guide.notes.indexOf(note);
  const prev = guide.notes[index - 1];
  const next = guide.notes[index + 1];
  const secondsPerBeat = 60 / guide.song.bpm;
  const glide = Math.min(GLIDE_SECONDS, note.beats * secondsPerBeat * GLIDE_SHARE);
  const sinceStart = (guide.beat - note.start) * secondsPerBeat;
  const untilEnd = (note.start + note.beats - guide.beat) * secondsPerBeat;
  if (prev && sinceStart < glide && glidingBetween(prev, note)) return true;
  if (next && untilEnd < glide && glidingBetween(note, next)) return true;
  return false;
}

// Between two neighbouring notes: sliding from one to the other, or, next to
// a rest, letting go a moment early or late, or coming in a moment late.
function glidingBetween(a, b) {
  if (a.midi === null || b.midi === null) {
    const pitch = a.midi ?? b.midi;
    return pitch === null || isSilent() || onPitch(pitch);
  }
  return between(a.midi, b.midi);
}

// Move through the piece at its tempo, but only while the player is doing
// what's written: on the note for a note, and silent for a rest. Otherwise it
// waits.
function tickGuide(seconds) {
  // Nothing moves until sound is on, so the piano's opening isn't lost.
  if (!guide || guide.done || !audio || audio.state !== 'running') return;
  const note = guideNote();
  if (!isSilent()) guide.started = true;
  if (note && onTrack(note)) {
    // Stop at the end of the note, so a short note can't be skipped in one frame.
    const end = note.start + note.beats;
    guide.beat = Math.min(guide.beat + seconds * guide.song.bpm / 60, end);
  }
  // Time spent getting ready before the first sound doesn't count.
  if (guide.started) guide.elapsed += seconds;
  playPiano(guide.beat);
  if (guide.beat >= guide.length) {
    guide.done = true;
    // Let the last chord ring a while, then lift.
    setTimeout(silencePiano, 3000);
  }
  setGuideStatus(guideMessage(note));
  followScore();
}

function guideMessage(note) {
  const song = guide.song;
  if (guide.done) {
    return `Fine. ${song.title} runs ${formatTime(guide.length * 60 / song.bpm)} at tempo; you played it in ${formatTime(guide.elapsed)}.`;
  }
  if (!guide.started) {
    const first = guide.notes.find((n) => n.midi !== null);
    return `${song.title}: find the first note, ${NOTE_NAMES[first.midi % 12]}, to begin.`;
  }
  if (!note) return '';
  if (note.midi === null) return onTrack(note) ? 'Rest' : 'Rest — lift your finger or bring the volume down';
  const name = NOTE_NAMES[note.midi % 12];
  if (onPitch(note.midi)) return `${name} ✓`;
  if (onTrack(note)) return isSilent() ? `Play ${name}` : `${name} — gliding`;
  const voice = nearestVoice(note.midi);
  if (voice && Math.abs(voice.midi - note.midi) < 1) {
    const cents = Math.round((voice.midi - note.midi) * 100);
    return `Find ${name} — you're ${Math.abs(cents)}¢ ${cents > 0 ? 'sharp' : 'flat'}`;
  }
  return `Find ${name}`;
}

// The score's dynamics, as a suggestion on the volume strip: a dashed line at
// the suggested level (green when the volume is near it), labelled with the
// marking in force, and upcoming markings falling toward the line. They never
// hold the music up.
function drawGuideDynamics(nowY, beatHeight, h, strip) {
  const plan = guide.piece.volumePlan;
  const { level, dynamic, change } = plannedVolume(plan, guide.beat);
  const y = (1 - level) * h;
  const near = Math.abs(stripVolume - level) < 0.1;
  ctx2d.save();
  ctx2d.strokeStyle = near ? '#2f9e44' : '#343a40';
  ctx2d.lineWidth = 2;
  ctx2d.setLineDash([5, 4]);
  ctx2d.beginPath();
  ctx2d.moveTo(0, y);
  ctx2d.lineTo(strip, y);
  ctx2d.stroke();
  ctx2d.setLineDash([]);
  ctx2d.fillStyle = near ? '#2f9e44' : '#343a40';
  ctx2d.font = 'italic bold 15px Georgia, serif';
  ctx2d.textAlign = 'right';
  ctx2d.textBaseline = 'bottom';
  const label = [dynamic, change === '<' ? 'cresc.' : change === '>' ? 'dim.' : ''].filter(Boolean).join(' ');
  if (label) ctx2d.fillText(label, strip - 4, y - 3);
  // Markings still to come, falling toward the line.
  ctx2d.fillStyle = '#868e96';
  ctx2d.textAlign = 'right';
  ctx2d.textBaseline = 'middle';
  for (const m of plan.marks) {
    if (m.kind === 'wedge' || m.from <= guide.beat) continue;
    const my = nowY - (m.from - guide.beat) * beatHeight;
    if (my < 0) break;
    ctx2d.fillText(m.mark, strip - 4, my);
  }
  ctx2d.restore();
}

// Rests fall down the volume strip, where silence is played.
function drawGuideRest(note, isCurrent, nowY, beatHeight, h, strip) {
  const bottom = Math.min(nowY - (note.start - guide.beat) * beatHeight, nowY);
  const top = nowY - (note.start + note.beats - guide.beat) * beatHeight + 2;
  if (bottom < 0 || top > nowY || bottom - top < 1) return;
  const color = isCurrent ? (onTrack(note) ? '#2f9e44' : '#d9480f') : '#495057';
  ctx2d.globalAlpha = isCurrent ? 0.6 : 0.3;
  ctx2d.fillStyle = color;
  ctx2d.fillRect(6, Math.max(top, 0), strip - 12, bottom - Math.max(top, 0));
  ctx2d.globalAlpha = 1;
  if (bottom - Math.max(top, 0) >= 16) {
    ctx2d.save();
    ctx2d.fillStyle = '#fff';
    ctx2d.font = 'bold 12px Arial, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('rest', strip / 2, (Math.max(top, 0) + bottom) / 2);
    ctx2d.restore();
  }
}

function setGuideStatus(text) {
  if (text !== guide.status) guideStatus.textContent = guide.status = text;
}

function formatTime(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function drawGuide(w, h, strip) {
  const nowY = Math.round(h * 0.8);
  const beatHeight = Math.min(Math.max(h / 8, 36), 80);
  const current = guide.done ? null : guideNote();
  const inTune = current && current.midi !== null && onTrack(current);

  // Below the line is what's been played.
  ctx2d.fillStyle = 'rgba(0, 0, 0, 0.04)';
  ctx2d.fillRect(strip, nowY, w - strip, h - nowY);

  for (const note of guide.notes) {
    if (note.midi === null) {
      drawGuideRest(note, note === current, nowY, beatHeight, h, strip);
      continue;
    }
    const bottom = nowY - (note.start - guide.beat) * beatHeight;
    // A small gap at the end of each note, so repeated notes read as two.
    const top = nowY - (note.start + note.beats - guide.beat) * beatHeight + 2;
    if (bottom < 0 || top > h) continue;
    const left = xAtMidi(note.midi - 0.5);
    const width = xAtMidi(note.midi + 0.5) - left;
    const barWidth = Math.max(width - 4, 6);
    const x = left + (width - barWidth) / 2;
    const color = note === current ? (inTune ? '#2f9e44' : '#d9480f') : '#1971c2';
    // Played part, faded, below the line; the rest in full above it.
    ctx2d.globalAlpha = 0.2;
    ctx2d.fillStyle = color;
    ctx2d.fillRect(x, Math.max(top, nowY), barWidth, Math.max(bottom - Math.max(top, nowY), 0));
    ctx2d.globalAlpha = note === current ? 0.85 : 0.5;
    ctx2d.fillRect(x, Math.max(top, 0), barWidth, Math.max(Math.min(bottom, nowY) - Math.max(top, 0), 0));
    ctx2d.globalAlpha = 1;
  }

  drawGuideDynamics(nowY, beatHeight, h, strip);

  ctx2d.fillStyle = '#333';
  ctx2d.fillRect(0, nowY - 1, w, 2);

  if (current && current.midi !== null) {
    // Mark where to play, and name the note.
    const x = xAtMidi(current.midi);
    ctx2d.fillStyle = inTune ? '#2f9e44' : '#d9480f';
    ctx2d.fillRect(x - 1, nowY, 2, h - nowY);
    ctx2d.save();
    ctx2d.font = 'bold 14px Arial, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'top';
    ctx2d.fillText(NOTE_NAMES[current.midi % 12], Math.min(Math.max(x, strip + 12), w - 12), nowY + 6);
    ctx2d.restore();
  }

  // Progress through the piece.
  ctx2d.fillStyle = 'rgba(25, 113, 194, 0.5)';
  ctx2d.fillRect(strip, 0, (w - strip) * Math.min(guide.beat / guide.length, 1), 3);
}

if (SONGS.length) {
  for (const song of SONGS) guideSelect.add(new Option(`${song.title} (${song.composer})`, song.id));
  guideBar.hidden = false;
  document.getElementById('guide-hint').hidden = false;
}
guideSelect.addEventListener('change', startGuide);
guideRestart.addEventListener('click', startGuide);

// --- Piano -------------------------------------------------------------------

// A plain synthesized piano for the accompaniment: a bright attack whose upper
// partials die away first, and a decay that's longer for low notes.
function pianoTone() {
  const harmonics = [0, 1, 0.55, 0.3, 0.22, 0.12, 0.08, 0.05, 0.03, 0.02];
  return audio.createPeriodicWave(new Float32Array(harmonics.length), new Float32Array(harmonics));
}

class PianoNote {
  constructor(midi, velocity, now = audio.currentTime) {
    const freq = midiToFreq(midi);
    this.osc = audio.createOscillator();
    this.osc.setPeriodicWave(pianoWave);
    this.osc.frequency.value = freq;
    // A second string, slightly out of tune with the first.
    this.osc2 = audio.createOscillator();
    this.osc2.setPeriodicWave(pianoWave);
    this.osc2.frequency.value = freq * 1.0012;
    this.tone = audio.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.3;
    const bright = Math.min(freq * (4 + 6 * velocity), 12000);
    this.tone.frequency.setValueAtTime(bright, now);
    this.tone.frequency.setTargetAtTime(Math.max(freq * 2, 400), now + 0.02, 0.4);
    this.gain = audio.createGain();
    const peak = 0.11 * velocity;
    // Low notes ring for several seconds, high ones under one.
    const decay = Math.min(Math.max(2.4 - (midi - 36) * 0.045, 0.5), 2.6);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    this.gain.gain.setTargetAtTime(peak * 0.4, now + 0.004, 0.08);
    this.gain.gain.setTargetAtTime(0, now + 0.15, decay);
    this.osc.connect(this.tone);
    this.osc2.connect(this.tone);
    this.tone.connect(this.gain).connect(pianoBus);
    this.osc.start(now);
    this.osc2.start(now);
    this.stopAt = now + 0.15 + decay * 6;
    this.osc.stop(this.stopAt);
    this.osc2.stop(this.stopAt);
  }

  // The damper falls.
  release(now = audio.currentTime) {
    if (now >= this.stopAt) return;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0, now, 0.06);
    this.osc.stop(now + 0.4);
    this.osc2.stop(now + 0.4);
  }
}

// Play the accompaniment up to the guide's place: strike every note it has
// reached, and lift each one when the guide passes its end. When the guide
// waits for the player, the piano waits too, its notes ringing on.
function playPiano(beat) {
  const notes = guide.piece.piano;
  if (!notes.length || !pianoBus) return;
  while (guide.pianoNext < notes.length && notes[guide.pianoNext].start <= beat + 1e-6) {
    const note = notes[guide.pianoNext++];
    if (!pianoToggle.checked) continue;
    // Follow the score's dynamics, softened so the piano stays behind the player.
    const level = plannedVolume(guide.piece.volumePlan, note.start).level;
    guide.pianoActive.push({ end: note.start + note.beats, sound: new PianoNote(note.midi, 0.3 + 0.7 * level) });
  }
  guide.pianoActive = guide.pianoActive.filter((n) => {
    if (n.end > beat + 1e-6) return true;
    n.sound.release();
    return false;
  });
}

function silencePiano() {
  if (!guide) return;
  for (const n of guide.pianoActive) n.sound.release();
  guide.pianoActive = [];
}

// --- Score viewer ------------------------------------------------------------

// OpenSheetMusicDisplay (~1.3MB, vendored alongside Isochords) is only
// fetched the first time a piece's score is shown.
let osmd = null;
let osmdLoading = null;
let scorePiece = null; // the piece currently engraved
let scoreSteps = []; // beat at which each cursor step falls
let scoreIndex = 0;

function loadOsmd() {
  if (window.opensheetmusicdisplay) return Promise.resolve();
  if (!osmdLoading) {
    osmdLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '../isochords/vendor/opensheetmusicdisplay.min.js';
      script.onload = resolve;
      script.onerror = () => { osmdLoading = null; reject(new Error("Couldn't load the score renderer.")); };
      document.head.appendChild(script);
    });
  }
  return osmdLoading;
}

async function showScore() {
  if (!guide || !scoreToggle.checked) {
    scorePanel.hidden = true;
    return;
  }
  scorePanel.hidden = false;
  const piece = guide.piece;
  try {
    await loadOsmd();
  } catch (e) {
    scorePanel.hidden = true;
    return;
  }
  if (!guide || guide.piece !== piece) return; // switched away while loading
  if (!osmd) {
    osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(scoreEl, {
      autoResize: false, // re-rendered below, keeping the cursor in place
      autoBeam: true,
      drawTitle: false,
      drawComposer: false,
      drawPartNames: false,
      // OSMD's own cursor-following scrolls the page; the score box is
      // scrolled by hand instead.
      followCursor: false,
    });
  }
  if (scorePiece !== piece) {
    await osmd.load(pieceMusicXml(piece));
    scorePiece = piece;
    renderScore();
    // Walk the cursor once to learn the beat of each step. Timestamps are in
    // whole notes and only readable after a step, so the first is pinned at 0.
    osmd.cursor.reset();
    scoreSteps = [0];
    while (!osmd.cursor.iterator.EndReached) {
      osmd.cursor.next();
      if (osmd.cursor.iterator.EndReached) break;
      scoreSteps.push(osmd.cursor.iterator.currentTimeStamp.RealValue * 4);
    }
    if (scoreSteps.some((b) => !isFinite(b))) scoreSteps = [];
  }
  osmd.cursor.reset();
  scoreIndex = 0;
  scorePanel.scrollTop = 0;
  followScore();
}

function renderScore() {
  osmd.zoom = scoreEl.clientWidth < 600 ? 0.55 : 0.8;
  osmd.render();
  osmd.cursor.show();
}

// Move the score's cursor up to the guide's place, keeping it in view by
// scrolling the score box only (never the page).
function followScore() {
  if (!osmd || !guide || scorePiece !== guide.piece || scorePanel.hidden) return;
  let moved = false;
  while (scoreIndex + 1 < scoreSteps.length && scoreSteps[scoreIndex + 1] <= guide.beat + 1e-6) {
    osmd.cursor.next();
    scoreIndex++;
    moved = true;
  }
  if (moved) scrollScoreToCursor();
}

function scrollScoreToCursor() {
  const el = osmd.cursor.cursorElement;
  if (!el) return;
  const offset = el.getBoundingClientRect().top - scorePanel.getBoundingClientRect().top;
  const margin = 40;
  if (offset < margin || offset > scorePanel.clientHeight - margin) {
    scorePanel.scrollTop += offset - scorePanel.clientHeight / 3;
  }
}

// Re-engrave at the new width, then walk the cursor back to where it was.
let scoreResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(scoreResizeTimer);
  scoreResizeTimer = setTimeout(() => {
    if (!osmd || !scorePiece || scorePanel.hidden) return;
    renderScore();
    osmd.cursor.reset();
    for (let i = 0; i < scoreIndex; i++) osmd.cursor.next();
    scrollScoreToCursor();
  }, 300);
});

scoreToggle.addEventListener('change', showScore);
pianoToggle.addEventListener('change', () => { if (!pianoToggle.checked) silencePiano(); });

// --- Drawing ---------------------------------------------------------------

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw(time) {
  // Advance guided play by real time, capped so a hidden tab doesn't jump ahead.
  if (lastFrame !== null) tickGuide(Math.min((time - lastFrame) / 1000, 0.1));
  lastFrame = time;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * (window.devicePixelRatio || 1))) resize();
  const n = noteCount();

  const strip = stripWidth();
  if (strip) {
    // Pitch side is flat: height does nothing there.
    ctx2d.fillStyle = '#fffcf7';
    ctx2d.fillRect(strip, 0, w - strip, h);
    // Volume strip, filled up to the current level.
    ctx2d.fillStyle = '#f4f4f4';
    ctx2d.fillRect(0, 0, strip, h);
    const level = (1 - stripVolume) * h;
    ctx2d.fillStyle = 'rgba(217, 72, 15, 0.18)';
    ctx2d.fillRect(0, level, strip, h - level);
    ctx2d.fillStyle = '#d9480f';
    ctx2d.fillRect(0, Math.round(level) - 1, strip, 2);
    ctx2d.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx2d.fillRect(strip, 0, 1, h);
    ctx2d.save();
    ctx2d.fillStyle = '#888';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'bottom';
    ctx2d.font = '12px Arial, sans-serif';
    ctx2d.fillText('volume', strip / 2, h - 6);
    ctx2d.fillText(`${Math.round(stripVolume * 100)}%`, strip / 2, Math.max(level - 4, 20));
    ctx2d.restore();
  } else {
    // Volume shading: silent at the bottom, loud at the top.
    const fade = ctx2d.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, '#fff7ec');
    fade.addColorStop(1, '#ffffff');
    ctx2d.fillStyle = fade;
    ctx2d.fillRect(0, 0, w, h);
  }

  const active = new Set();
  for (const voice of voices.values()) if (voice.sounding) active.add(Math.round(voice.midi));

  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'bottom';
  for (let i = 0; notesToggle.checked && i < n; i++) {
    const midi = lowMidi + i;
    const pc = midi % 12;
    const x = xAtMidi(midi - 0.5);
    const col = xAtMidi(midi + 0.5) - x;
    if (BLACK_KEYS.has(pc)) {
      ctx2d.fillStyle = 'rgba(0, 0, 0, 0.06)';
      ctx2d.fillRect(x, 0, col, h);
    }
    if (discreteToggle.checked && active.has(midi)) {
      ctx2d.fillStyle = 'rgba(217, 72, 15, 0.12)';
      ctx2d.fillRect(x, 0, col, h);
    }
    // One column per semitone, like keys: a hairline between every pair (so
    // E|F and B|C don't merge into one wide white key), darker at each C.
    if (i > 0) {
      ctx2d.fillStyle = pc === 0 ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.08)';
      ctx2d.fillRect(Math.round(x), 0, 1, h);
    }
    // Label every key whose column is wide enough for its name, and skip the
    // rest; in the uncorrected field the crowded top keys go unlabelled.
    const label = NOTE_NAMES[pc];
    ctx2d.font = `${pc === 0 ? 'bold ' : ''}12px Arial, sans-serif`;
    if (ctx2d.measureText(label).width + 4 <= col) {
      ctx2d.fillStyle = pc === 0 ? '#555' : BLACK_KEYS.has(pc) ? '#bbb' : '#999';
      ctx2d.fillText(label, x + col / 2, h - 6);
    }
  }

  if (guide) drawGuide(w, h, strip);

  ctx2d.save();
  ctx2d.fillStyle = '#bbb';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'top';
  ctx2d.font = '12px Arial, sans-serif';
  ctx2d.fillText('louder ↑', 8, 8);
  ctx2d.textAlign = 'right';
  ctx2d.fillText('higher →', w - 8, 8);
  ctx2d.restore();

  for (const [key, voice] of voices) {
    if (!voice.sounding) continue;
    const p = key === 'single' ? pitchPointers().pop()?.[1] : pointers.get(key);
    if (!p) continue;
    const x = Math.min(Math.max(p.x, 0), w);
    const y = Math.min(Math.max(p.y, 0), h);
    const radius = 10 + voice.volume * 22;
    ctx2d.beginPath();
    ctx2d.arc(x, y, radius, 0, Math.PI * 2);
    ctx2d.fillStyle = voice.color + '33';
    ctx2d.fill();
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = voice.color;
    ctx2d.stroke();
    if (discreteToggle.checked) {
      // Show where the quantised pitch actually sits.
      const noteX = xAtMidi(voice.midi);
      ctx2d.fillStyle = voice.color;
      ctx2d.fillRect(noteX - 1, 0, 2, h);
    }
  }

  requestAnimationFrame(draw);
}

setRange(window.innerWidth < 600 ? 2 : 3);
resize();
window.addEventListener('resize', resize);
requestAnimationFrame(draw);
