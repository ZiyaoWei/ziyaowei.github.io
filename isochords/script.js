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
// Each chord: { root: pitch class 0-11, quality: interval array, beats: duration }
function chord(root, quality, beats) {
  return { root, quality, beats };
}

const PRESETS = {
  canon: {
    label: "Canon in C",
    // Pachelbel's Canon progression, I-V-vi-iii-IV-I-IV-V, transposed to C, looped twice.
    chords: [
      chord(0, MAJOR, 2), // C
      chord(7, MAJOR, 2), // G
      chord(9, MINOR, 2), // Am
      chord(4, MINOR, 2), // Em
      chord(5, MAJOR, 2), // F
      chord(0, MAJOR, 2), // C
      chord(5, MAJOR, 2), // F
      chord(7, MAJOR, 2), // G
      chord(0, MAJOR, 2),
      chord(7, MAJOR, 2),
      chord(9, MINOR, 2),
      chord(4, MINOR, 2),
      chord(5, MAJOR, 2),
      chord(0, MAJOR, 2),
      chord(5, MAJOR, 2),
      chord(7, MAJOR, 2),
    ],
  },
  jazz: {
    label: "ii–V–I in C",
    // Dm7 - G7 - Cmaj7, the paper's own worked example (Figure 10), looped twice.
    chords: [
      chord(2, MIN7, 3), // Dm7
      chord(7, DOM7, 3), // G7
      chord(0, MAJ7, 4), // Cmaj7
      chord(2, MIN7, 3),
      chord(7, DOM7, 3),
      chord(0, MAJ7, 4),
    ],
  },
  modulation: {
    label: "Modulation by a Fifth",
    // I-IV-V-I in C, then the same shape shifted a fifth to G, then back to C.
    chords: [
      chord(0, MAJOR, 2), // C
      chord(5, MAJOR, 2), // F
      chord(7, MAJOR, 2), // G
      chord(0, MAJOR, 2), // C
      chord(7, MAJOR, 2), // G
      chord(0, MAJOR, 2), // C
      chord(2, MAJOR, 2), // D
      chord(7, MAJOR, 2), // G
      chord(0, MAJOR, 2), // C
      chord(5, MAJOR, 2), // F
      chord(7, MAJOR, 2), // G
      chord(0, MAJOR, 2), // C
    ],
  },
};

function expandChord(c) {
  const notes = c.quality.map((interval) => ({
    pitchClass: (c.root + interval) % 12,
    octave: 4,
  }));
  notes.push({ pitchClass: c.root, octave: 3 }); // bass doubling of the root
  return notes;
}

// --- Tonnetz lattice -------------------------------------------------------
// pitchClass(a, b) = (7a + 4b) mod 12: +1 column = perfect fifth, +1 row = major third.
const A_MIN = 0;
const A_MAX = 7;
const B_MIN = -1;
const B_MAX = 2;
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

const MAX_CIRCLES = 3;
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
let isPlaying = false;
let scheduledCallbacks = [];
const activeCounts = {}; // "pitchClass_octave" -> count of currently sounding notes

function octaveRadius(octave) {
  // Lower octaves (bigger, lower-pitched notes) get bigger circles.
  return Math.max(6, 20 - octave * 3);
}

function activateNote(pitchClass, octave) {
  const key = `${pitchClass}_${octave}`;
  activeCounts[key] = (activeCounts[key] || 0) + 1;
  render();
}

function deactivateNote(pitchClass, octave) {
  const key = `${pitchClass}_${octave}`;
  if (activeCounts[key]) activeCounts[key]--;
  if (activeCounts[key] <= 0) delete activeCounts[key];
  render();
}

function activeOctavesFor(pitchClass) {
  const result = [];
  for (const key in activeCounts) {
    const [pc, oct] = key.split("_").map(Number);
    if (pc === pitchClass) result.push(oct);
  }
  return result;
}

function isPitchClassActive(pitchClass) {
  for (const key in activeCounts) {
    if (Number(key.split("_")[0]) === pitchClass) return true;
  }
  return false;
}

function render() {
  nodes.forEach((n) => {
    const octaves = activeOctavesFor(n.pitchClass);
    n.dot.style.opacity = octaves.length ? 0 : 1;
    n.circles.forEach((c, i) => {
      if (i < octaves.length) {
        c.setAttribute("r", octaveRadius(octaves[i]));
        c.style.opacity = 0.55;
      } else {
        c.style.opacity = 0;
      }
    });
  });

  triangles.forEach((t) => {
    const active = t.corners.every(isPitchClassActive);
    t.el.style.opacity = active ? 1 : 0;
  });

  edges.forEach((e) => {
    const active = isPitchClassActive(e.n1.pitchClass) && isPitchClassActive(e.n2.pitchClass);
    e.el.style.opacity = active ? 1 : 0;
  });
}

function midiFor(pitchClass, octave) {
  return 12 * (octave + 1) + pitchClass;
}

function freqFor(pitchClass, octave) {
  const midi = midiFor(pitchClass, octave);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playTone(freq, duration) {
  const gain = audioContext.createGain();
  const osc = audioContext.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audioContext.destination);

  const now = audioContext.currentTime;
  const attack = 0.02;
  const release = 0.15;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + attack);
  gain.gain.setValueAtTime(0.15, now + Math.max(attack, duration - release));
  gain.gain.linearRampToValueAtTime(0, now + duration);

  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function scheduleNote(note, startTime, duration) {
  const freq = freqFor(note.pitchClass, note.octave);

  const onDelay = (startTime - audioContext.currentTime) * 1000;
  const onId = setTimeout(() => {
    if (!isPlaying) return;
    playTone(freq, duration);
    activateNote(note.pitchClass, note.octave);
  }, Math.max(0, onDelay));

  const offDelay = (startTime + duration - audioContext.currentTime) * 1000;
  const offId = setTimeout(() => {
    if (!isPlaying) return;
    deactivateNote(note.pitchClass, note.octave);
  }, Math.max(0, offDelay));

  scheduledCallbacks.push(onId, offId);
}

function playPreset(key) {
  stop();

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  isPlaying = true;

  const preset = PRESETS[key];
  document.getElementById("now-playing").textContent = `Now playing: ${preset.label}`;
  document.querySelectorAll(".preset").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === key);
  });

  let t = audioContext.currentTime + 0.15;
  preset.chords.forEach((c) => {
    const notes = expandChord(c);
    const duration = c.beats * SEC_PER_BEAT;
    notes.forEach((note) => scheduleNote(note, t, duration));
    t += duration;
  });

  const endDelay = (t - audioContext.currentTime) * 1000;
  const endId = setTimeout(() => {
    stop();
  }, endDelay);
  scheduledCallbacks.push(endId);
}

function stop() {
  isPlaying = false;
  scheduledCallbacks.forEach((id) => clearTimeout(id));
  scheduledCallbacks = [];
  for (const key in activeCounts) delete activeCounts[key];
  render();

  document.getElementById("now-playing").textContent = "";
  document.querySelectorAll(".preset").forEach((btn) => btn.classList.remove("active"));

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => playPreset(btn.dataset.preset));
});
document.getElementById("stop").addEventListener("click", stop);

render();
