/** Generate ERVENOW notification sound files (WAV + MP3 alias copy). */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "public", "assets", "sounds");
fs.mkdirSync(dir, { recursive: true });

function writeWav(file, freq, dur) {
  const sr = 44100;
  const n = Math.floor(sr * dur);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 5);
    const s = Math.sin(2 * Math.PI * freq * t) * env * 0.35;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(s * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

const sounds = [
  ["EW_NOTIFY", 523, 0.22],
  ["EW_BROADCAST", 392, 0.45],
  ["EW_ALERT", 784, 0.35],
];

for (const [name, freq, dur] of sounds) {
  const wav = path.join(dir, `${name}.wav`);
  const mp3 = path.join(dir, `${name}.mp3`);
  writeWav(wav, freq, dur);
  fs.copyFileSync(wav, mp3);
  console.log(`created ${name}.wav + ${name}.mp3`);
}
