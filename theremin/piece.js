// Turns a song from songs.js into what guided play and the score viewer need:
// a timeline of notes in playing order, the dynamics as a volume plan, and
// MusicXML for the engraved score.

const PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Accidentals: # and ## sharpen, b and bb flatten, n is a natural.
const ACCIDENTALS = { '##': 2, '#': 1, n: 0, b: -1, bb: -2 };
// Advisory volume for each dynamic, as a share of the volume strip.
const DYNAMIC_LEVELS = { pp: 0.2, p: 0.35, mp: 0.5, mf: 0.6, f: 0.8, ff: 0.95 };

// "C#5/2~" -> { midi: 73, beats: 2, tie: true, step: 'C', alter: 1, octave: 5 }
function parseToken(token) {
  const [pitch, length] = token.replace(/~$/, '').split('/');
  const beats = Number(length);
  const tie = token.endsWith('~');
  if (!(beats > 0)) throw new Error(`Bad note "${token}"`);
  if (pitch === 'r') return { midi: null, beats, tie: false };
  const match = /^([A-G])(##|#|bb|b|n)?(-?\d)$/.exec(pitch);
  if (!match) throw new Error(`Bad note "${token}"`);
  const step = match[1];
  const octave = Number(match[3]);
  const alter = ACCIDENTALS[match[2] || 'n'];
  // An explicit natural is kept so the score can print it.
  return { midi: PITCH_CLASSES[step] + alter + 12 * (octave + 1), beats, tie, step, alter, octave, natural: match[2] === 'n' };
}

// "p@1.5 <@3.5-4.75" -> marks at absolute beats, offset by the bar's start.
function parseMarks(text, offset) {
  const marks = [];
  for (const token of (text || '').trim().split(/\s+/).filter(Boolean)) {
    const [mark, at] = token.split('@');
    if (mark === '<' || mark === '>') {
      const [from, to] = at.split('-').map(Number);
      marks.push({ kind: 'wedge', mark, from: offset + from, to: offset + to });
    } else {
      marks.push({ kind: mark in DYNAMIC_LEVELS ? 'dynamic' : 'words', mark, from: offset + Number(at) });
    }
  }
  return marks;
}

function buildPiece(song) {
  const measures = [];
  const marks = [];
  let start = 0;
  for (const id of song.form) {
    const bar = song.bars[id];
    const meter = bar.meter || 4;
    let at = start;
    const notes = bar.voice.trim().split(/\s+/).map((token) => {
      const note = { ...parseToken(token), start: at };
      at += note.beats;
      return note;
    });
    if (Math.abs(at - start - meter) > 1e-9) throw new Error(`Bar ${id} holds ${at - start} beats, not ${meter}`);
    measures.push({ id, start, meter, notes });
    marks.push(...parseMarks(bar.marks, start));
    start += meter;
  }

  // What the player plays: tied notes merged into one.
  const notes = [];
  for (const measure of measures) {
    for (const note of measure.notes) {
      const prev = notes[notes.length - 1];
      if (prev && prev.tie && prev.midi === note.midi) {
        prev.beats += note.beats;
        prev.tie = note.tie;
      } else {
        notes.push({ midi: note.midi, start: note.start, beats: note.beats, tie: note.tie });
      }
    }
  }
  // The accompaniment, as notes in playing order.
  const piano = [];
  if (song.piano) {
    for (const measure of measures) {
      for (const token of (song.piano[measure.id] || '').trim().split(/\s+/).filter(Boolean)) {
        const [timing, chord] = token.split(':');
        const [at, beats] = timing.split('/').map(Number);
        for (const pitch of chord.split(',')) {
          piano.push({ midi: parseToken(`${pitch}/1`).midi, start: measure.start + at, beats });
        }
      }
    }
    piano.sort((a, b) => a.start - b.start);
  }

  const pitches = notes.filter((n) => n.midi !== null).map((n) => n.midi);
  return {
    piano,
    song,
    measures,
    notes,
    marks,
    length: start,
    low: Math.min(...pitches),
    high: Math.max(...pitches),
    volumePlan: volumePlan(marks),
  };
}

// The dynamics as a target volume over time: each marking sets a level, a
// hairpin swells or fades a little over its length, and a written cresc. or
// dim. does the same over the next bar. Returns points to interpolate between.
function volumePlan(marks) {
  const sorted = [...marks].sort((a, b) => a.from - b.from);
  const firstDynamic = sorted.find((m) => m.kind === 'dynamic');
  let level = firstDynamic ? DYNAMIC_LEVELS[firstDynamic.mark] : DYNAMIC_LEVELS.mf;
  const points = [{ beat: 0, level }];
  for (const m of sorted) {
    if (m.kind === 'dynamic') {
      level = DYNAMIC_LEVELS[m.mark];
      points.push({ beat: m.from, level, step: true });
    } else if (rampOf(m)) {
      points.push({ beat: m.from, level });
      level = Math.min(Math.max(level + (rampOf(m).up ? 0.1 : -0.1), 0.1), 1);
      points.push({ beat: rampOf(m).to, level });
    }
  }
  return { points, marks: sorted };
}

// A hairpin, or a written cresc. or dim. (which lasts a bar), as a ramp.
function rampOf(m) {
  if (m.kind === 'wedge') return { up: m.mark === '<', to: m.to };
  if (m.mark === 'cresc.' || m.mark === 'dim.') return { up: m.mark === 'cresc.', to: m.from + 4 };
  return null;
}

// The advisory volume at a beat, the dynamic marking in force, and whether a
// swell ('<') or fade ('>') is under way.
function plannedVolume(plan, beat) {
  const { points, marks } = plan;
  let i = 0;
  while (i + 1 < points.length && points[i + 1].beat <= beat) i++;
  const here = points[i];
  const next = points[i + 1];
  let level = here.level;
  if (next && !next.step && next.beat > here.beat) {
    level += (next.level - here.level) * (beat - here.beat) / (next.beat - here.beat);
  }
  let dynamic = '';
  let change = '';
  for (const m of marks) {
    if (m.from > beat) break;
    if (m.kind === 'dynamic') dynamic = m.mark;
    const ramp = rampOf(m);
    if (ramp && beat < ramp.to) change = ramp.up ? '<' : '>';
  }
  return { level, dynamic, change };
}

// --- MusicXML ---------------------------------------------------------------

const DIVISIONS = 4; // per quarter: a sixteenth is 1
const NOTE_TYPES = { 4: ['whole', 0], 3: ['half', 1], 2: ['half', 0], 1.5: ['quarter', 1], 1: ['quarter', 0], 0.75: ['eighth', 1], 0.5: ['eighth', 0], 0.25: ['16th', 0] };
const ACCIDENTAL_NAMES = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The voice part as MusicXML, bar for bar in playing order, so the score's
// timeline lines up with guided play.
function pieceMusicXml(piece) {
  const { song } = piece;
  const keyAlter = {};
  for (const letter of song.key >= 0 ? SHARP_ORDER.slice(0, song.key) : FLAT_ORDER.slice(0, -song.key)) {
    keyAlter[letter] = song.key >= 0 ? 1 : -1;
  }
  const directionsIn = (from, to) => piece.marks.flatMap((m) => {
    const out = [];
    if (m.from >= from && m.from < to) out.push({ at: m.from, m, stop: false });
    if (m.kind === 'wedge' && m.to > from && m.to <= to) out.push({ at: m.to, m, stop: true });
    return out;
  });
  const directionXml = ({ m, stop }, offset) => {
    let type;
    if (m.kind === 'wedge') type = `<wedge type="${stop ? 'stop' : m.mark === '<' ? 'crescendo' : 'diminuendo'}"/>`;
    else if (m.kind === 'dynamic') type = `<dynamics><${m.mark}/></dynamics>`;
    else type = `<words font-style="italic">${escapeXml(m.mark)}</words>`;
    const off = offset ? `<offset>${Math.round(offset * DIVISIONS)}</offset>` : '';
    return `<direction placement="above"><direction-type>${type}</direction-type>${off}</direction>`;
  };

  let meter = null;
  const measures = piece.measures.map((measure, index) => {
    let xml = `<measure number="${index + 1}">`;
    if (index === 0 || measure.meter !== meter) {
      xml += '<attributes>';
      if (index === 0) xml += `<divisions>${DIVISIONS}</divisions><key><fifths>${song.key}</fifths></key>`;
      xml += `<time><beats>${measure.meter}</beats><beat-type>4</beat-type></time>`;
      if (index === 0) xml += '<clef><sign>G</sign><line>2</line></clef>';
      xml += '</attributes>';
      meter = measure.meter;
    }
    const end = measure.start + measure.meter;
    const pending = directionsIn(measure.start, end).sort((a, b) => a.at - b.at);
    const shown = {}; // accidentals in force this bar, by letter and octave
    let prevTie = index > 0 && piece.measures[index - 1].notes.slice(-1)[0].tie;
    for (const note of measure.notes) {
      // Markings that fall on or inside this note go just before it.
      while (pending.length && pending[0].at < note.start + note.beats) {
        const d = pending.shift();
        xml += directionXml(d, Math.max(d.at - note.start, 0));
      }
      const [type, dots] = NOTE_TYPES[note.beats] || [];
      if (!type) throw new Error(`No single note lasts ${note.beats} beats`);
      xml += '<note>';
      if (note.midi === null) {
        xml += '<rest/>';
      } else {
        xml += `<pitch><step>${note.step}</step>${note.alter ? `<alter>${note.alter}</alter>` : ''}<octave>${note.octave}</octave></pitch>`;
      }
      xml += `<duration>${note.beats * DIVISIONS}</duration>`;
      if (prevTie) xml += '<tie type="stop"/>';
      if (note.tie) xml += '<tie type="start"/>';
      xml += `<voice>1</voice><type>${type}</type>${'<dot/>'.repeat(dots)}`;
      if (note.midi !== null) {
        const where = note.step + note.octave;
        const inForce = where in shown ? shown[where] : keyAlter[note.step] || 0;
        if (note.alter !== inForce && !prevTie) xml += `<accidental>${ACCIDENTAL_NAMES[note.alter]}</accidental>`;
        shown[where] = note.alter;
      }
      if (prevTie || note.tie) {
        xml += `<notations>${prevTie ? '<tied type="stop"/>' : ''}${note.tie ? '<tied type="start"/>' : ''}</notations>`;
      }
      xml += '</note>';
      prevTie = note.tie;
    }
    for (const d of pending) xml += directionXml(d, 0);
    return xml + '</measure>';
  });

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
    + '<score-partwise version="3.1">'
    + `<work><work-title>${escapeXml(song.title)}</work-title></work>`
    + `<identification><creator type="composer">${escapeXml(song.composer)}</creator></identification>`
    + '<part-list><score-part id="P1"><part-name>Theremin</part-name></score-part></part-list>'
    + `<part id="P1">${measures.join('')}</part></score-partwise>`;
}
