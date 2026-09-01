const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Chord qualities as semitone intervals above the root.
const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];
const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const DOM7 = [0, 4, 7, 10];

const BPM = 84;
const SEC_PER_BEAT = 60 / BPM;

// --- Preset chord progressions -------------------------------------------
// Each chord: { root, quality, beats, melody, roman, key }
//   root/quality: pitch class 0-11 + interval array, as before
//   beats: duration; melody: optional MIDI note number for the tune on top
//     (absolute, not a pitch class, so the line keeps its shape across octaves)
//   roman: scale-degree label to display (e.g. "I", "ii7"), relative to `key`
//   key: pitch class of the currently sounding tonic, for the "in <key>" tag
function chord(root, quality, beats, melody, roman, key) {
  return { root, quality, beats, melody, roman, key };
}

function chordName(root, quality) {
  const name = NOTE_NAMES[root];
  if (quality === MAJOR) return name;
  if (quality === MINOR) return `${name}m`;
  if (quality === MAJ7) return `${name}maj7`;
  if (quality === MIN7) return `${name}m7`;
  if (quality === DOM7) return `${name}7`;
  return name;
}

const PRESETS = {
  canon: {
    label: "Canon in D",
    loopLength: 8,
    // Pachelbel's Canon in D: the ground bass (D-A-B-F#-G-D-G-A, I-V-vi-iii-IV-I-IV-V)
    // with its familiar step-wise melodic theme on top, in the original key,
    // looped twice. The melody notes are all chord tones, same as the original.
    chords: [
      chord(2, MAJOR, 2, 78, "I", 2), // D, melody F#5
      chord(9, MAJOR, 2, 76, "V", 2), // A, melody E5
      chord(11, MINOR, 2, 74, "vi", 2), // Bm, melody D5
      chord(6, MINOR, 2, 73, "iii", 2), // F#m, melody C#5
      chord(7, MAJOR, 2, 71, "IV", 2), // G, melody B4
      chord(2, MAJOR, 2, 69, "I", 2), // D, melody A4
      chord(7, MAJOR, 2, 71, "IV", 2), // G, melody B4
      chord(9, MAJOR, 2, 73, "V", 2), // A, melody C#5
      chord(2, MAJOR, 2, 78, "I", 2),
      chord(9, MAJOR, 2, 76, "V", 2),
      chord(11, MINOR, 2, 74, "vi", 2),
      chord(6, MINOR, 2, 73, "iii", 2),
      chord(7, MAJOR, 2, 71, "IV", 2),
      chord(2, MAJOR, 2, 69, "I", 2),
      chord(7, MAJOR, 2, 71, "IV", 2),
      chord(9, MAJOR, 2, 73, "V", 2),
    ],
  },
  jazz: {
    label: "ii–V–I in C",
    loopLength: 3,
    // Dm7 - G7 - Cmaj7, the paper's own worked example (Figure 10), looped twice.
    chords: [
      chord(2, MIN7, 3, null, "ii7", 0), // Dm7
      chord(7, DOM7, 3, null, "V7", 0), // G7
      chord(0, MAJ7, 4, null, "Imaj7", 0), // Cmaj7
      chord(2, MIN7, 3, null, "ii7", 0),
      chord(7, DOM7, 3, null, "V7", 0),
      chord(0, MAJ7, 4, null, "Imaj7", 0),
    ],
  },
  modulation: {
    label: "Modulation by a Fifth",
    loopLength: 12,
    // I-IV-V-I in C, then the same shape shifted a fifth to G, then back to C.
    chords: [
      chord(0, MAJOR, 2, null, "I", 0), // C
      chord(5, MAJOR, 2, null, "IV", 0), // F
      chord(7, MAJOR, 2, null, "V", 0), // G
      chord(0, MAJOR, 2, null, "I", 0), // C
      chord(7, MAJOR, 2, null, "I", 7), // G (pivot: becomes the new tonic)
      chord(0, MAJOR, 2, null, "IV", 7), // C
      chord(2, MAJOR, 2, null, "V", 7), // D
      chord(7, MAJOR, 2, null, "I", 7), // G
      chord(0, MAJOR, 2, null, "I", 0), // C (pivot: back to the original key)
      chord(5, MAJOR, 2, null, "IV", 0), // F
      chord(7, MAJOR, 2, null, "V", 0), // G
      chord(0, MAJOR, 2, null, "I", 0), // C
    ],
  },
};

function expandChord(c) {
  const notes = c.quality.map((interval) => ({
    pitchClass: (c.root + interval) % 12,
    octave: 3,
  }));
  notes.push({ pitchClass: c.root, octave: 2 }); // bass doubling of the root
  if (c.melody != null) {
    notes.push({ pitchClass: c.melody % 12, octave: Math.floor(c.melody / 12) - 1 });
  }
  return notes;
}

// --- Tonnetz lattice -------------------------------------------------------
// pitchClass(a, b) = (7a + 4b) mod 12: +1 column = perfect fifth, +1 row = major third.
const A_MIN = 0;
const A_MAX = 8;
const B_MIN = -2;
const B_MAX = 3;
const COL_WIDTH = 60;
const ROW_HEIGHT = COL_WIDTH * (Math.sqrt(3) / 2);

function pitchClassAt(a, b) {
  return (((7 * a + 4 * b) % 12) + 12) % 12;
}

function nodeX(a, b) {
  return (a + 0.5 * b) * COL_WIDTH;
}

function nodeY(a, b) {
  return (B_MAX - b) * ROW_HEIGHT;
}

const nodes = []; // { a, b, pitchClass, x, y }
for (let b = B_MIN; b <= B_MAX; b++) {
  for (let a = A_MIN; a <= A_MAX; a++) {
    nodes.push({ a, b, pitchClass: pitchClassAt(a, b), x: nodeX(a, b), y: nodeY(a, b) });
  }
}

function findNode(a, b) {
  return nodes.find((n) => n.a === a && n.b === b);
}

const triangles = []; // { corners: [pc,pc,pc], points: "x,y x,y x,y", dir: 'up'|'down' }
const edgeKeys = new Set();
const edges = []; // { a: node, b: node }

function addEdge(n1, n2) {
  const key = [n1.a, n1.b, n2.a, n2.b].sort().join(",");
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({ n1, n2 });
}

for (let b = B_MIN; b <= B_MAX; b++) {
  for (let a = A_MIN; a < A_MAX; a++) {
    const root = findNode(a, b);
    const fifth = findNode(a + 1, b);
    if (!root || !fifth) continue;

    // Upward triangle: major triad (root, major third above, perfect fifth above).
    const majorThird = findNode(a, b + 1);
    if (majorThird) {
      triangles.push({
        corners: [root.pitchClass, majorThird.pitchClass, fifth.pitchClass],
        points: `${root.x},${root.y} ${fifth.x},${fifth.y} ${majorThird.x},${majorThird.y}`,
        dir: "up",
      });
      addEdge(root, majorThird);
      addEdge(majorThird, fifth);
    }

    // Downward triangle: minor triad (root, minor third above, perfect fifth above).
    const minorThird = findNode(a + 1, b - 1);
    if (minorThird) {
      triangles.push({
        corners: [root.pitchClass, minorThird.pitchClass, fifth.pitchClass],
        points: `${root.x},${root.y} ${fifth.x},${fifth.y} ${minorThird.x},${minorThird.y}`,
        dir: "down",
      });
      addEdge(root, minorThird);
      addEdge(minorThird, fifth);
    }

    addEdge(root, fifth);
  }
}

// --- SVG rendering setup ----------------------------------------------------
const svg = document.getElementById("tonnetz");

const xs = nodes.map((n) => n.x);
const ys = nodes.map((n) => n.y);
const PAD = 36;
const minX = Math.min(...xs) - PAD;
const minY = Math.min(...ys) - PAD;
const width = Math.max(...xs) - Math.min(...xs) + PAD * 2;
const height = Math.max(...ys) - Math.min(...ys) + PAD * 2;
svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

const triangleGroup = svgEl("g", { id: "triangles" });
const lineGroup = svgEl("g", { id: "lines" });
const noteGroup = svgEl("g", { id: "notes" });
svg.appendChild(triangleGroup);
svg.appendChild(lineGroup);
svg.appendChild(noteGroup);

triangles.forEach((t) => {
  const poly = svgEl("polygon", {
    points: t.points,
    class: `triad triad-${t.dir}`,
  });
  triangleGroup.appendChild(poly);
  t.el = poly;
});

edges.forEach((e) => {
  const line = svgEl("line", {
    x1: e.n1.x,
    y1: e.n1.y,
    x2: e.n2.x,
    y2: e.n2.y,
    class: "interval-line",
  });
  lineGroup.appendChild(line);
  e.el = line;
});

const MAX_CIRCLES = 6; // real MIDI stacks many octaves of one tone class
nodes.forEach((n) => {
  const g = svgEl("g", { class: "note-node" });
  const dot = svgEl("circle", { cx: n.x, cy: n.y, r: 3, class: "idle-dot" });
  g.appendChild(dot);
  n.dot = dot;
  n.circles = [];
  for (let i = 0; i < MAX_CIRCLES; i++) {
    const c = svgEl("circle", { cx: n.x, cy: n.y, r: 0, class: "note-circle" });
    c.style.opacity = 0;
    g.appendChild(c);
    n.circles.push(c);
  }
  const label = svgEl("text", { x: n.x, y: n.y - 9, class: "note-label" });
  label.textContent = NOTE_NAMES[n.pitchClass];
  g.appendChild(label);
  noteGroup.appendChild(g);
});

// --- Playback state ----------------------------------------------------------
let audioContext = null;
let playbackRate = 1; // 1 = the tempo each piece is written at
let replayCurrent = null; // lets a tempo change restart whatever is playing
let masterGain = null;
let isPlaying = false;
let scheduledCallbacks = [];
const activeCounts = {}; // "pitchClass_octave" -> count of currently sounding notes

const CIRCLE_OPACITY = 0.55; // "each individual circle is somewhat transparent"
const MAX_NOTES = 4000; // guard against pathological MIDI files

function ensureAudio() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.8;
  // Real MIDI can stack a lot of simultaneous notes; keep the sum from clipping.
  const compressor = audioContext.createDynamicsCompressor();
  masterGain.connect(compressor);
  compressor.connect(audioContext.destination);
}

function octaveRadius(octave) {
  // "The radius of a circle is indicative of the note's corresponding octave.
  // Lower notes are represented by larger circles ... Conversely, higher notes
  // are shown as smaller circles." Mapped across the whole MIDI octave range so
  // arbitrary files render sensibly, not just the built-in demos.
  return Math.max(4, Math.min(20, 19 - octave * 1.7));
}

function activateNote(pitchClass, octave) {
  const key = `${pitchClass}_${octave}`;
  activeCounts[key] = (activeCounts[key] || 0) + 1;
  requestRender();
}

function deactivateNote(pitchClass, octave) {
  const key = `${pitchClass}_${octave}`;
  if (activeCounts[key]) activeCounts[key]--;
  if (activeCounts[key] <= 0) delete activeCounts[key];
  requestRender();
}

function activeOctavesByPitchClass() {
  const byPitchClass = Array.from({ length: 12 }, () => []);
  for (const key in activeCounts) {
    const split = key.indexOf("_");
    byPitchClass[Number(key.slice(0, split))].push(Number(key.slice(split + 1)));
  }
  byPitchClass.forEach((octaves) => octaves.sort((a, b) => a - b));
  return byPitchClass;
}

// "At each redraw, the current state of sound is visualized." Coalescing into one
// frame keeps dense MIDI from re-rendering once per individual note event.
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const byPitchClass = activeOctavesByPitchClass();

  nodes.forEach((n) => {
    const octaves = byPitchClass[n.pitchClass];
    n.dot.style.opacity = octaves.length ? 0 : 1;
    n.circles.forEach((circle, i) => {
      if (i < octaves.length) {
        circle.setAttribute("r", octaveRadius(octaves[i]));
        circle.style.opacity = CIRCLE_OPACITY;
      } else {
        circle.style.opacity = 0;
      }
    });
  });

  triangles.forEach((t) => {
    const complete = t.corners.every((pitchClass) => byPitchClass[pitchClass].length > 0);
    t.el.style.opacity = complete ? 1 : 0;
  });

  edges.forEach((e) => {
    const both =
      byPitchClass[e.n1.pitchClass].length > 0 && byPitchClass[e.n2.pitchClass].length > 0;
    e.el.style.opacity = both ? 1 : 0;
  });
}

function midiFor(pitchClass, octave) {
  return 12 * (octave + 1) + pitchClass;
}

function freqForMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Velocity shapes what you hear, matching the paper's playback of the MIDI audio.
// It is deliberately not mapped to the visuals: the paper describes brightness as
// coming from multiple octaves of a tone class sounding at once, not from velocity.
function scheduleTone(midi, startTime, duration, velocity) {
  const gain = audioContext.createGain();
  const osc = audioContext.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freqForMidi(midi);
  osc.connect(gain);
  gain.connect(masterGain);

  const peak = 0.13 * (velocity / 127);
  const attack = 0.02;
  const release = 0.12;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + attack);
  gain.gain.setValueAtTime(peak, startTime + Math.max(attack, duration - release));
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function scheduleNote(note, clockStart) {
  const pitchClass = ((note.midi % 12) + 12) % 12;
  const octave = Math.floor(note.midi / 12) - 1;
  const startTime = clockStart + note.start;

  scheduleTone(note.midi, startTime, note.duration, note.velocity);

  const onId = setTimeout(() => {
    if (isPlaying) activateNote(pitchClass, octave);
  }, Math.max(0, (startTime - audioContext.currentTime) * 1000));

  const offId = setTimeout(() => {
    if (isPlaying) deactivateNote(pitchClass, octave);
  }, Math.max(0, (startTime + note.duration - audioContext.currentTime) * 1000));

  scheduledCallbacks.push(onId, offId);
}

// --- MIDI file parsing -------------------------------------------------------
// Parsing is delegated to @tonejs/midi (vendored in vendor/), which resolves the
// tempo map for us and hands back notes already timed in seconds.
function notesFromMidiFile(arrayBuffer) {
  let midi;
  try {
    midi = new Midi(arrayBuffer);
  } catch (err) {
    throw new Error("That doesn't look like a MIDI file.");
  }

  const notes = [];
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      notes.push({
        midi: note.midi,
        velocity: Math.round(note.velocity * 127),
        start: note.time,
        duration: Math.max(0.05, note.duration),
      });
    });
  });

  if (!notes.length) throw new Error("No notes found in that MIDI file.");
  notes.sort((a, b) => a.start - b.start);
  return { notes, truncated: notes.length > MAX_NOTES };
}

// --- UI wiring ---------------------------------------------------------------
const nowPlayingEl = document.getElementById("now-playing");
const chordRomanEl = document.getElementById("chord-roman");
const chordNameEl = document.getElementById("chord-name");
const chordKeyEl = document.getElementById("chord-key");
const progressionStripEl = document.getElementById("progression-strip");
let progressionChips = [];

function buildProgressionStrip(preset) {
  progressionStripEl.innerHTML = "";
  progressionChips = preset.chords.slice(0, preset.loopLength).map((c) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = c.roman;
    progressionStripEl.appendChild(chip);
    return chip;
  });
}

function clearChordDisplay() {
  chordRomanEl.textContent = "";
  chordNameEl.textContent = "";
  chordKeyEl.textContent = "";
  progressionStripEl.innerHTML = "";
  progressionChips = [];
}

function showChord(c, index, loopLength) {
  chordRomanEl.textContent = c.roman;
  chordNameEl.textContent = chordName(c.root, c.quality);
  chordKeyEl.textContent = `in ${NOTE_NAMES[c.key]} major`;
  progressionChips.forEach((chip, i) => {
    chip.classList.toggle("current", i === index % loopLength);
  });
}

function startPlayback(notes, label) {
  ensureAudio();
  isPlaying = true;
  nowPlayingEl.textContent = label;

  const clockStart = audioContext.currentTime + 0.2;
  // playbackRate stretches or compresses every onset and duration together, so
  // the audio, the grid and the score cursor all slow down in step.
  const playable = notes.slice(0, MAX_NOTES).map((note) => ({
    midi: note.midi,
    velocity: note.velocity,
    start: note.start / playbackRate,
    duration: note.duration / playbackRate,
  }));
  playable.forEach((note) => scheduleNote(note, clockStart));

  const end = playable.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
  scheduledCallbacks.push(setTimeout(stop, (end + 0.4) * 1000));
  return clockStart;
}

function playPreset(key) {
  stop();
  hideScore(); // the synthetic progressions have no score
  document.getElementById("track-note").textContent = "";
  replayCurrent = () => playPreset(key);

  const preset = PRESETS[key];
  document.querySelectorAll(".preset").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === key);
  });
  buildProgressionStrip(preset);

  // Flatten the progression into plain timed notes, the same shape a MIDI file
  // parses into, so both paths share one scheduler.
  const notes = [];
  const chordStarts = [];
  let offset = 0;
  preset.chords.forEach((c) => {
    const duration = c.beats * SEC_PER_BEAT;
    chordStarts.push({ chord: c, start: offset });
    expandChord(c).forEach((n) => {
      notes.push({
        midi: midiFor(n.pitchClass, n.octave),
        velocity: 80,
        start: offset,
        duration,
      });
    });
    offset += duration;
  });

  const clockStart = startPlayback(notes, `Now playing: ${preset.label}`);

  chordStarts.forEach((entry, index) => {
    const delay = (clockStart + entry.start / playbackRate - audioContext.currentTime) * 1000;
    const id = setTimeout(() => {
      if (isPlaying) showChord(entry.chord, index, preset.loopLength);
    }, Math.max(0, delay));
    scheduledCallbacks.push(id);
  });
}

function playMidiFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = notesFromMidiFile(reader.result);
    } catch (err) {
      stop();
      nowPlayingEl.textContent = err.message;
      return;
    }
    stop();
    replayCurrent = () => playMidiFile(file);
    hideScore(); // a loaded MIDI file brings no score with it
    document.getElementById("track-note").textContent = "";
    const suffix = parsed.truncated ? ` (first ${MAX_NOTES} notes)` : "";
    startPlayback(parsed.notes, `Now playing: ${file.name}${suffix}`);
  };
  reader.onerror = () => {
    stop();
    nowPlayingEl.textContent = "Couldn't read that file.";
  };
  reader.readAsArrayBuffer(file);
}

// --- Score view --------------------------------------------------------------
// OpenSheetMusicDisplay is ~1.3MB, so it is only fetched the first time someone
// plays a piece that has a score. The synthetic progressions never pay for it.
const scorePanel = document.getElementById("score-panel");
const scoreEl = document.getElementById("score");
let osmd = null;
let osmdLoading = null;
let cursorSteps = []; // seconds at which the cursor should advance
let cursorIndex = 0;
let followRaf = null;

function loadOsmdLibrary() {
  if (window.opensheetmusicdisplay) return Promise.resolve();
  if (osmdLoading) return osmdLoading;
  osmdLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/opensheetmusicdisplay.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Couldn't load the score renderer."));
    document.head.appendChild(script);
  });
  return osmdLoading;
}

async function renderScore(track) {
  await loadOsmdLibrary();
  if (!osmd) {
    osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(scoreEl, {
      autoResize: true,
      drawTitle: false,
      drawPartNames: false,
      // OSMD's own cursor-following scrolls the page, yanking the viewport down
      // to the score. We scroll the score box ourselves instead, below.
      followCursor: false,
    });
  }
  // OSMD detects a zipped .mxl by its "PK" signature, but wants it as a binary
  // string rather than a typed array.
  const buffer = await (await fetch(`tracks/${track.id}.mxl`)).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  await osmd.load(binary);
  osmd.render();

  // show() initialises the iterator; its timestamps are NaN before that.
  osmd.cursor.show();

  // Walk the cursor once to learn when each step falls, in seconds. Timestamps
  // are in whole notes, so x4 gives quarters. The timestamp is only readable
  // after advancing, so the opening step is pinned to zero.
  const secondsPerQuarter = 60 / track.bpm;
  osmd.cursor.reset();
  cursorSteps = [0];
  while (!osmd.cursor.iterator.EndReached) {
    osmd.cursor.next();
    if (osmd.cursor.iterator.EndReached) break;
    const whole = osmd.cursor.iterator.currentTimeStamp.RealValue;
    cursorSteps.push(whole * 4 * secondsPerQuarter);
  }
  osmd.cursor.reset();
  cursorIndex = 0;

  // If the timestamps don't come back usable, still play the piece — just
  // without a moving cursor.
  if (cursorSteps.some((t) => !isFinite(t))) cursorSteps = [];
}

// Keep the cursor in view by scrolling the score box only. Touching
// scrollTop here never moves the page itself.
function scrollCursorIntoView() {
  const el = osmd && osmd.cursor && osmd.cursor.cursorElement;
  if (!el) return;
  const cursorTop = el.getBoundingClientRect().top;
  const panel = scorePanel.getBoundingClientRect();
  const offset = cursorTop - panel.top;
  const margin = 48;
  if (offset < margin || offset > scorePanel.clientHeight - margin) {
    scorePanel.scrollTop += offset - scorePanel.clientHeight / 3;
  }
}

function followScore(clockStart) {
  cancelAnimationFrame(followRaf);
  const step = () => {
    if (!isPlaying || !osmd) return;
    const elapsed = audioContext.currentTime - clockStart;
    let moved = false;
    while (
      cursorIndex < cursorSteps.length - 1 &&
      cursorSteps[cursorIndex + 1] / playbackRate <= elapsed
    ) {
      osmd.cursor.next();
      cursorIndex++;
      moved = true;
    }
    if (moved) scrollCursorIntoView();
    followRaf = requestAnimationFrame(step);
  };
  followRaf = requestAnimationFrame(step);
}

// Stops the cursor but leaves the score on screen, so it stays readable once
// the piece ends.
function stopFollowing() {
  cancelAnimationFrame(followRaf);
  followRaf = null;
}

// Only used when switching to something that has no score of its own.
function hideScore() {
  stopFollowing();
  scorePanel.hidden = true;
  if (osmd && osmd.cursor) osmd.cursor.hide();
}

async function playTrack(track) {
  stop();
  replayCurrent = () => playTrack(track);
  nowPlayingEl.textContent = `Loading ${track.title}…`;
  document.querySelectorAll(".track").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.track === track.id);
  });

  let data;
  try {
    data = await (await fetch(`tracks/${track.id}.json`)).json();
    scorePanel.hidden = false;
    await renderScore(data); // carries bpm; the index entry does not
  } catch (err) {
    stop();
    nowPlayingEl.textContent = err.message || "Couldn't load that piece.";
    return;
  }

  const notes = data.notes.map(([midi, velocity, start, duration]) => ({
    midi,
    velocity,
    start,
    duration,
  }));
  const clockStart = startPlayback(notes, `Now playing: ${data.composer} — ${data.title}`);

  const noteEl = document.getElementById("track-note");
  noteEl.textContent = `${data.note} `;
  if (data.source) {
    const link = document.createElement("a");
    link.href = data.source;
    link.target = "_blank";
    link.rel = "noopener";
    link.dataset.umamiEvent = "bach-digital-source";
    link.textContent = "Sources on Bach Digital";
    noteEl.appendChild(link);
  }

  followScore(clockStart);
}

function stop() {
  isPlaying = false;
  // The score stays on screen after the music ends; only the cursor stops.
  stopFollowing();
  document.querySelectorAll(".track").forEach((btn) => btn.classList.remove("active"));
  scheduledCallbacks.forEach((id) => clearTimeout(id));
  scheduledCallbacks = [];
  for (const key in activeCounts) delete activeCounts[key];
  render();

  nowPlayingEl.textContent = "";
  document.querySelectorAll(".preset").forEach((btn) => btn.classList.remove("active"));
  clearChordDisplay();

  if (audioContext) {
    audioContext.close();
    audioContext = null;
    masterGain = null;
  }
}

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => playPreset(btn.dataset.preset));
});
document.getElementById("stop").addEventListener("click", stop);

const fileInput = document.getElementById("midi-file");
document.getElementById("load-midi").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) playMidiFile(fileInput.files[0]);
  fileInput.value = "";
});

// Populate the piece buttons from the track index.
fetch("tracks/index.json")
  .then((r) => r.json())
  .then((tracks) => {
    const row = document.getElementById("tracks");
    tracks.forEach((track) => {
      const btn = document.createElement("button");
      btn.className = "track";
      btn.dataset.track = track.id;
      btn.textContent = track.label || track.title;
      btn.title = track.note;
      btn.addEventListener("click", () => playTrack(track));
      row.appendChild(btn);
    });
  })
  .catch(() => {});

const panel = document.getElementById("tonnetz-panel");
["dragenter", "dragover"].forEach((type) => {
  panel.addEventListener(type, (e) => {
    e.preventDefault();
    panel.classList.add("drop-target");
  });
});
["dragleave", "drop"].forEach((type) => {
  panel.addEventListener(type, () => panel.classList.remove("drop-target"));
});
panel.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) playMidiFile(e.dataTransfer.files[0]);
});

const tempoInput = document.getElementById("tempo");
const tempoLabel = document.getElementById("tempo-label");

function showTempo() {
  tempoLabel.textContent = `${playbackRate.toFixed(2)}×`;
}

tempoInput.addEventListener("input", () => {
  playbackRate = parseFloat(tempoInput.value);
  showTempo();
});
// Restart on release rather than on every slider tick.
tempoInput.addEventListener("change", () => {
  if (isPlaying && replayCurrent) replayCurrent();
});
showTempo();

// The paper's running visualization is unlabelled; names are an opt-in aid here.
const labelToggle = document.getElementById("show-labels");
labelToggle.addEventListener("change", () => {
  svg.classList.toggle("show-labels", labelToggle.checked);
});
svg.classList.toggle("show-labels", labelToggle.checked);

render();
