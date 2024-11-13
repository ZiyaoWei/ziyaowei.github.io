const BPM = 180;
const LOUD_FREQUENCY = 1500;
const SOFT_FREQUENCY = 1000;
const LOUD_VOLUME = 0.3;
const SOFT_VOLUME = 0.1;
const CLAP_DURATION = 0.05;
const CLAP_INTERVAL = 60 / BPM;  // Clapping Music is at 160-184 BPM

let audioContext;
let isPlaying = false;

function createClap(isLoud) {
  const clap = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  clap.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  clap.frequency.value = isLoud ? LOUD_FREQUENCY : SOFT_FREQUENCY;
  const volume = isLoud ? LOUD_VOLUME : SOFT_VOLUME;
  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + CLAP_DURATION);
  
  clap.start();
  clap.stop(audioContext.currentTime + CLAP_DURATION);
}

function playPattern(currentLineIndex, binary, startTime) {
  
  for(let i = 0; i < binary.length; i++) {
    const clapTime = startTime + i * CLAP_INTERVAL;
    if(clapTime > audioContext.currentTime) {
      audioContext.resume().then(() => {
        if(isPlaying) {
          setTimeout(() => {
            createClap(binary[i] === '1');
            
            // Reset all lines to normal
            let allLines = document.getElementById('sequence').innerHTML
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/<\/?strong>/g, '')
              .split('\n');
            
            allLines.forEach((line, index) => {
              if (index === currentLineIndex) {
                // Parse the current line, removing any existing HTML
                const [num, bin] = line.replace(/<[^>]*>/g, '').split(': ');
                // Create the bold version with current digit highlighted
                const binaryDigits = bin.split('');
                binaryDigits[i] = `<strong>${binaryDigits[i]}</strong>`;
                allLines[index] = `<strong>${num}</strong>: ${binaryDigits.join('')}`;
              }
            });
            
            document.getElementById('sequence').innerHTML = allLines.join('\n');
          }, (clapTime - audioContext.currentTime) * 1000);
        }
      });
    }
  }
  return startTime + binary.length * CLAP_INTERVAL;
}

function collatz(n) {
  if(n % 2 === 0) return n / 2;
  return 3 * n + 1;
}

function toBinary(n) {
  return (n >>> 0).toString(2); // Ensure unsigned 32-bit integer
}

async function playSequence(start) {
  let current = start;
  let sequence = '';
  let startTime = audioContext.currentTime + 0.1;
  
  var i = 0;
  while(current !== 1 && isPlaying) {
    const binary = toBinary(current);
    sequence += `${current}: ${binary}\n`;
    document.getElementById('sequence').innerHTML = sequence;
    startTime = playPattern(i, binary, startTime);
    current = collatz(current);
    i++;
  }
  
  if(isPlaying) {
    const binary = toBinary(1);
    sequence += `1: ${binary}`;
    document.getElementById('sequence').innerHTML = sequence;
    playPattern(binary, startTime);
  }
}

document.getElementById('play').addEventListener('click', () => {
  if(!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  const start = parseInt(document.getElementById('startNum').value);
  if(start < 1) return;
  
  isPlaying = true;
  playSequence(start);
});

document.getElementById('stop').addEventListener('click', () => {
  isPlaying = false;
  document.getElementById('sequence').innerHTML = '';
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
});