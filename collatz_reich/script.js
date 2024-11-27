const BPM = 180;
const LOUD_FREQUENCY = 1500;
const SOFT_FREQUENCY = 1000;
const LOUD_VOLUME = 0.3;
const SOFT_VOLUME = 0.1;
const CLAP_DURATION = 0.05;
// Clapping Music is at 160-184 BPM with eighth notes
const CLAP_INTERVAL = 60 / BPM / 2;
const STEREO_PAN = 0.8; // How far to pan left/right (-1 to 1)
const AUDIO_URLS = {
  left: "https://cdn.freesound.org/previews/404/404549_5121236-lq.mp3",
  right: "https://cdn.freesound.org/previews/11/11876_32690-lq.mp3",
};
let audioBuffers = {};

let audioContext;
let isPlaying = false;
let scheduledCallbacks = []; // Store all scheduled timeouts

const LEFT_VOLUME_MULTIPLIER = 1.15; // Makes left channel 15% louder

async function loadAudioSamples() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    const [leftBuffer, rightBuffer] = await Promise.all([
      fetch(AUDIO_URLS.left)
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer)),
      fetch(AUDIO_URLS.right)
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer)),
    ]);

    audioBuffers.left = leftBuffer;
    audioBuffers.right = rightBuffer;
    return true;
  } catch (error) {
    console.error("Error loading audio samples:", error);
    return false;
  }
}

function createClap(isLoud, isPanLeft) {
  if (!audioContext || !isPlaying || !audioBuffers.left || !audioBuffers.right)
    return;

  const source = audioContext.createBufferSource();
  const gainNode = audioContext.createGain();
  const panNode = audioContext.createStereoPanner();

  source.buffer = isPanLeft ? audioBuffers.left : audioBuffers.right;

  source.connect(gainNode);
  gainNode.connect(panNode);
  panNode.connect(audioContext.destination);

  const baseVolume = isLoud ? LOUD_VOLUME : SOFT_VOLUME;
  const volume = isPanLeft ? baseVolume * LEFT_VOLUME_MULTIPLIER : baseVolume;
  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

  panNode.pan.value = isPanLeft ? -STEREO_PAN : STEREO_PAN;

  source.start();
}

function playPattern(currentLineIndex, binary, startTime, isLeft) {
  for (let i = 0; i < binary.length; i++) {
    const clapTime = startTime + i * CLAP_INTERVAL;

    const timeoutId = setTimeout(() => {
      if (!isPlaying) return;

      if (binary[i] === "1") {
        createClap(true, isLeft);
      }
      updateDisplay(currentLineIndex, i, isLeft);
    }, (clapTime - audioContext.currentTime) * 1000);

    scheduledCallbacks.push(timeoutId);
  }
}

function formatSequence(sequence, maxNumLength) {
  return sequence
    .map(
      (item) => `${item.num.toString().padStart(maxNumLength)}: ${item.binary}`
    )
    .join("\n");
}

function playSequence(startLeft, startRight) {
  const { leftSequence, rightSequence } = displaySequences(
    startLeft,
    startRight
  );

  // Schedule left sequence
  let leftStartTime = audioContext.currentTime + 0.1;
  for (let i = 0; i < leftSequence.length; i++) {
    playPattern(i, leftSequence[i].binary, leftStartTime, true);
    leftStartTime += leftSequence[i].binary.length * CLAP_INTERVAL;
  }

  // Schedule right sequence independently
  let rightStartTime = audioContext.currentTime + 0.1;
  for (let i = 0; i < rightSequence.length; i++) {
    playPattern(i, rightSequence[i].binary, rightStartTime, false);
    rightStartTime += rightSequence[i].binary.length * CLAP_INTERVAL;
  }
}

function updateDisplay(lineIndex, digitIndex, isLeft) {
  const column = isLeft ? window.leftColumn : window.rightColumn;
  const sequence = isLeft ? window.leftSequence : window.rightSequence;

  if (!column || !sequence || lineIndex >= sequence.length) return;

  const maxNumLength = Math.max(
    ...sequence.map((item) => item.num.toString().length)
  );
  const lines = column.textContent.split("\n");

  // Reset all highlighting
  lines.forEach((_, i) => {
    if (sequence[i]) {
      lines[i] = formatSequence([sequence[i]], maxNumLength);
    }
  });

  // Add new highlighting
  if (lines[lineIndex]) {
    const [num, binary] = lines[lineIndex].split(": ");
    const binaryDigits = binary.split("");
    binaryDigits[digitIndex] = `<strong>${binaryDigits[digitIndex]}</strong>`;
    lines[lineIndex] = `${num.toString().padStart(maxNumLength)}: ${binaryDigits.join("")}`;
  }

  column.innerHTML = lines.join("\n");
}

function collatz(n) {
  if (n % 2 === 0) return n / 2;
  return 3 * n + 1;
}

function toBinary(n) {
  return (n >>> 0).toString(2); // Remove padStart to eliminate leading zeros
}

function displaySequences(startLeft, startRight) {
  const leftSequence = [];
  const rightSequence = [];

  let currentLeft = startLeft;
  while (currentLeft !== 1) {
    leftSequence.push({ num: currentLeft, binary: toBinary(currentLeft) });
    currentLeft = collatz(currentLeft);
  }
  leftSequence.push({ num: 1, binary: toBinary(1) });

  let currentRight = startRight;
  while (currentRight !== 1) {
    rightSequence.push({ num: currentRight, binary: toBinary(currentRight) });
    currentRight = collatz(currentRight);
  }
  rightSequence.push({ num: 1, binary: toBinary(1) });

  const sequenceDiv = document.getElementById("sequence");
  const leftColumn = document.createElement("div");
  const rightColumn = document.createElement("div");

  leftColumn.className = "sequence-column";
  rightColumn.className = "sequence-column";

  // Find the longest number for padding
  const leftMaxNumLength = Math.max(
    ...leftSequence.map((item) => item.num.toString().length)
  );
  const rightMaxNumLength = Math.max(
    ...rightSequence.map((item) => item.num.toString().length)
  );

  leftColumn.textContent = formatSequence(leftSequence, leftMaxNumLength);
  rightColumn.textContent = formatSequence(rightSequence, rightMaxNumLength);

  sequenceDiv.innerHTML = "";
  sequenceDiv.appendChild(leftColumn);
  sequenceDiv.appendChild(rightColumn);

  window.leftColumn = leftColumn;
  window.rightColumn = rightColumn;
  window.leftSequence = leftSequence;
  window.rightSequence = rightSequence;

  return { leftSequence, rightSequence };
}

async function play() {
  // Clear any existing timeouts first
  scheduledCallbacks.forEach((timeoutId) => clearTimeout(timeoutId));
  scheduledCallbacks = [];

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const startLeft = parseInt(document.getElementById("startNumLeft").value);
  const startRight = parseInt(document.getElementById("startNumRight").value);
  if (startLeft < 1 || startRight < 1) return;

  // Load samples if not already loaded
  if (!audioBuffers.left || !audioBuffers.right) {
    const loaded = await loadAudioSamples();
    if (!loaded) {
      console.error("Failed to load audio samples");
      return;
    }
  }

  isPlaying = true;
  playSequence(startLeft, startRight);

  document.getElementById("play").innerHTML = "Play/<strong>Stop</strong>";
}

function stop() {
  isPlaying = false;

  // Clear all scheduled timeouts
  scheduledCallbacks.forEach((timeoutId) => clearTimeout(timeoutId));
  scheduledCallbacks = []; // Reset the array

  // Close audio context but don't clear display
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  updateDisplay(-1, -1, true);
  updateDisplay(-1, -1, false);

  document.getElementById("play").innerHTML = "<strong>Play</strong>/Stop";
}

document.getElementById("play").addEventListener("click", async () => {
  if (isPlaying) {
    stop();
  } else {
    await play();
  }
});

// Add input event listeners
document.getElementById("startNumLeft").addEventListener("input", () => {
  const startLeft = parseInt(document.getElementById("startNumLeft").value);
  const startRight = parseInt(document.getElementById("startNumRight").value);
  if (startLeft > 0 && startRight > 0) {
    displaySequences(startLeft, startRight);
  }
});

document.getElementById("startNumRight").addEventListener("input", () => {
  const startLeft = parseInt(document.getElementById("startNumLeft").value);
  const startRight = parseInt(document.getElementById("startNumRight").value);
  if (startLeft > 0 && startRight > 0) {
    displaySequences(startLeft, startRight);
  }
});

// Initial display
const startLeft = parseInt(document.getElementById("startNumLeft").value);
const startRight = parseInt(document.getElementById("startNumRight").value);
if (startLeft > 0 && startRight > 0) {
  displaySequences(startLeft, startRight);
}

function getCollatzLength(n) {
  let length = 0;
  let current = n;
  while (current !== 1) {
    length += toBinary(current).length;
    current = collatz(current);
  }
  length += 1; // Add length of 1
  return length;
}

function findSimilarNumbers(targetLength, excludeNum, tolerance = 0.2) {
  let attempts = 0;
  let num;

  do {
    num = Math.floor(Math.random() * 100) + 1;
    attempts++;
  } while (
    (Math.abs(getCollatzLength(num) - targetLength) > tolerance * targetLength ||
    num === excludeNum) &&
    attempts < 50
  );

  return num;
}

document.getElementById("randomize").addEventListener("click", () => {
  // Stop any current playback
  if (isPlaying) {
    stop();
  }

  let num1, num2;
  let attempts = 0;
  const maxAttempts = 1000;

  do {
    // Generate first random number
    num1 = Math.floor(Math.random() * 100) + 1;
    const targetLength = getCollatzLength(num1);

    // Find a second number with similar sequence length
    num2 = findSimilarNumbers(targetLength, num1);
    
    attempts++;
  } while (
    Math.abs(getCollatzLength(num1) - getCollatzLength(num2)) > 
    getCollatzLength(num1) * 0.2 && 
    attempts < maxAttempts
  );

  // Update inputs
  document.getElementById("startNumLeft").value = num1;
  document.getElementById("startNumRight").value = num2;

  // Display new sequences
  displaySequences(num1, num2);
});
