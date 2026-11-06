import { SAMPLES, SAMPLE_LECTURES, hitTest, isLine, matchSentence, project } from "./board.js";
import { BoardReadError, readBoard } from "./gemini.js";

const $ = (id) => document.getElementById(id);

const FINGER_TOLERANCE = 24;   // px either side of a line, about a fingertip
const CANVAS_PAD = 26;
const BUBBLE_GAP = 16;
const SWEEP_MS = 2400;
const SWEEP_FRAMES = 6;
const MAX_PHOTO_WIDTH = 1600;
const KEY_STORE = "rabaruang-gemini-key";
const PITCH_LOW = 220;
const PITCH_HIGH = 1100;

const state = {
  mode: "raba",     // raba | sorot
  board: null,
  picture: null,    // canvas holding the photo or the drawn sample
  sample: null,     // sample name when not a real photo
};

/* Storage: may be blocked, so every access is guarded */
function loadKey() {
  try { return localStorage.getItem(KEY_STORE) ?? ""; } catch { return ""; }
}
function saveKey(value) {
  try {
    if (value) localStorage.setItem(KEY_STORE, value);
    else localStorage.removeItem(KEY_STORE);
  } catch { /* the key then lasts only for this visit */ }
}

/* Screens */
function show(id, focusId) {
  for (const screen of document.querySelectorAll("[data-screen]")) screen.hidden = screen.id !== id;
  if (id !== "capture") stopCamera();
  if (id !== "sorot") stopListening();
  if (id !== "raba") stopTone();
  if (focusId) $(focusId).focus();
}

/* Speech */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "id-ID";
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("id"));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

/* Tone */
let audio = null;
function unlockAudio() {
  if (audio) return audio.ctx.resume();
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  audio = { ctx, osc, gain };
}

function playTone(role, height) {
  if (!audio) return;
  const now = audio.ctx.currentTime;
  audio.osc.type = role === "curve" ? "sine" : role === "link" ? "triangle" : "square";
  const pitch = role === "axis" ? 110 : PITCH_LOW + height * (PITCH_HIGH - PITCH_LOW);
  audio.osc.frequency.setTargetAtTime(pitch, now, 0.01);
  audio.gain.gain.setTargetAtTime(role === "axis" ? 0.08 : 0.28, now, 0.01);
}
function stopTone() {
  if (audio) audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.01);
}

let lastPulse = 0;
function pulse() {
  const now = performance.now();
  if (now - lastPulse < 120) return;
  lastPulse = now;
  navigator.vibrate?.(40);
}

/* Camera */
let stream = null;
async function startCamera() {
  const video = $("camera");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    $("shutter").disabled = false;
  } catch {
    $("shutter").disabled = true;
    note("Kamera tidak bisa dibuka. Pakai galeri atau contoh.", true);
  }
}
function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function note(text, problem = false) {
  $("captureNote").textContent = text;
  $("captureNote").classList.toggle("problem", problem);
}

function toCanvas(source, width, height) {
  const scale = Math.min(1, MAX_PHOTO_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Edge strength on a small copy of the frame. Blurry frames score low.
function sharpness(canvas) {
  const w = 240;
  const h = Math.round(canvas.height * w / canvas.width);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const pen = small.getContext("2d", { willReadFrequently: true });
  pen.drawImage(canvas, 0, 0, w, h);
  const { data } = pen.getImageData(0, 0, w, h);
  const gray = (i) => data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const edge = 4 * gray(i) - gray(i - 1) - gray(i + 1) - gray(i - w) - gray(i + w);
      total += edge * edge;
    }
  }
  return total;
}

// Solo capture: the student sweeps instead of aiming, and the app keeps the sharpest frame.
async function sweepCapture() {
  const video = $("camera");
  $("shutter").disabled = true;
  const sweeping = state.mode === "raba";
  if (sweeping) speak("Arahkan ke depan, lalu geser pelan ke kanan.");
  note(sweeping ? "Geser ponsel pelan ke kanan..." : "Tahan ponsel...");
  await wait(sweeping ? 1200 : 200);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < SWEEP_FRAMES; i++) {
    const frame = toCanvas(video, video.videoWidth, video.videoHeight);
    const score = sharpness(frame);
    if (score > bestScore) {
      best = frame;
      bestScore = score;
    }
    pulse();
    await wait(SWEEP_MS / SWEEP_FRAMES);
  }
  $("shutter").disabled = false;
  await readPicture(best);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readPicture(canvas) {
  const key = loadKey();
  if (!key) {
    note("Foto asli butuh kunci AI. Isi kuncinya, atau coba contoh.", true);
    speak("Foto asli butuh kunci AI.");
    openKeyDialog();
    return;
  }
  show("reading", "readingText");
  speak("Membaca papan.");
  try {
    const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    const board = await readBoard(base64, key);
    if (!board.found) {
      await reopenCapture(board.hint || "Papan tidak terlihat. Coba foto lagi.");
      return;
    }
    openBoard(board, canvas, null);
  } catch (error) {
    await reopenCapture(error instanceof BoardReadError ? error.message : "Jawaban AI tidak bisa dibaca. Coba foto lagi.");
  }
}

async function reopenCapture(message) {
  show("capture", "captureTitle");
  note(message, true);
  speak(message);
  await startCamera();
}

function openBoard(board, picture, sample) {
  state.board = board;
  state.picture = picture;
  state.sample = sample;
  if (state.mode === "raba") openRaba();
  else openSorot();
}

/* Drawing */
function drawBoard(pen, view, colors, active, size = 1) {
  pen.lineCap = "round";
  pen.lineJoin = "round";
  for (const line of view.lines) {
    const on = line.source === active;
    const curve = line.source.role === "curve";
    pen.strokeStyle = on ? colors.active : curve ? colors.curve : colors.line;
    pen.lineWidth = ((curve ? 6 : 3.5) + (on ? 4 : 0)) * size;
    pen.beginPath();
    line.points.forEach((point) => pen.lineTo(point.x, point.y));
    pen.stroke();
  }
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  for (const mark of view.marks) {
    const on = mark.source === active;
    pen.fillStyle = on ? colors.active : colors.text;
    pen.strokeStyle = on ? colors.active : colors.text;
    pen.lineWidth = (on ? 4 : 2.5) * size;
    pen.font = `700 ${17 * size}px 'Atkinson Hyperlegible Next', system-ui, sans-serif`;
    if (mark.source.kind === "point") {
      pen.beginPath();
      pen.arc(mark.x, mark.y, (on ? 11 : 8) * size, 0, Math.PI * 2);
      pen.fill();
      pen.fillText(mark.source.label, mark.x + 22 * size, mark.y - 20 * size);
    } else {
      if (mark.source.kind === "box") pen.strokeRect(mark.x - mark.w / 2, mark.y - mark.h / 2, mark.w, mark.h);
      pen.fillText(mark.source.label, mark.x, mark.y, Math.max(mark.w - 8, 60));
    }
  }
}

const CHALK = { curve: "#FFE14D", line: "#FFF9E6", text: "#FFF9E6", active: "#FFFFFF" };
const MARKER = { curve: "#12309A", line: "#12309A", text: "#12309A", active: "#12309A" };

function sizeCanvas(canvas, width, height) {
  const scale = devicePixelRatio;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const pen = canvas.getContext("2d");
  pen.scale(scale, scale);
  return pen;
}

/* Raba: explore the board by finger */
let view = null;
let current = null;
let lastSpoken = { text: "", at: 0 };
let lineLabelTimer = null;

function summaryText() {
  const { board, sample } = state;
  const parts = [board.summary];
  if (board.uncertain) parts.push(`Kurang yakin: ${board.uncertain}.`);
  parts.push(sample ? "Ini papan contoh." : "Hasil baca AI, belum diperiksa.");
  return parts.join(" ");
}

function openRaba() {
  show("raba", "rabaSummary");
  current = null;
  layoutRaba();
  speak(`${summaryText()} Geser jari untuk meraba.`);
  $("rabaNow").textContent = state.board.title + (state.sample ? " (contoh)" : "");
}

function layoutRaba() {
  const area = $("rabaArea");
  const { width, height } = area.getBoundingClientRect();
  if (!width) return;
  view = project(state.board, width, height, CANVAS_PAD);
  drawRaba();
  buildTactile();
}

function drawRaba() {
  const area = $("rabaArea");
  const { width, height } = area.getBoundingClientRect();
  const pen = sizeCanvas($("rabaCanvas"), width, height);
  drawBoard(pen, view, CHALK, current);
}

// Invisible labelled buttons on every line and mark. A screen reader finds them as the
// finger passes, so the board stays readable even if it keeps the drag for itself.
function buildTactile() {
  const layer = $("tactile");
  layer.replaceChildren();
  const size = 44;
  const add = (x, y, w, h, label, role, height) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.style.cssText = `left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px`;
    if (role) button.addEventListener("focus", () => {
      playTone(role, height);
      setTimeout(stopTone, 220);
    });
    layer.append(button);
  };
  const areaHeight = $("rabaArea").getBoundingClientRect().height;
  for (const line of view.lines) {
    const length = line.points.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - line.points[i - 1].x, p.y - line.points[i - 1].y) : 0, 0);
    const steps = Math.max(1, Math.round(length / 56));
    for (let step = 0; step <= steps; step++) {
      const p = pointAlong(line.points, step / steps, length);
      const percent = Math.round(step / steps * 100);
      add(p.x, p.y, size, size, `${line.source.label}, ${percent} persen`, line.source.role, 1 - p.y / areaHeight);
    }
  }
  for (const mark of view.marks) {
    add(mark.x, mark.y, Math.max(mark.w, size), Math.max(mark.h, size), mark.source.spoken);
  }
}

function pointAlong(points, fraction, length) {
  let left = fraction * length;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const part = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= part && part > 0) {
      const t = left / part;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= part;
  }
  return points[points.length - 1];
}

function say(text) {
  const now = performance.now();
  if (text === lastSpoken.text && now - lastSpoken.at < 3000) return;
  lastSpoken = { text, at: now };
  speak(text);
}

function explore(clientX, clientY) {
  const box = $("rabaArea").getBoundingClientRect();
  const x = clientX - box.left;
  const y = clientY - box.top;
  const element = hitTest(view, x, y, FINGER_TOLERANCE);
  if (element && isLine(element)) {
    playTone(element.role, 1 - y / box.height);
    pulse();
  } else {
    stopTone();
  }
  if (element === current) return;
  current = element;
  clearTimeout(lineLabelTimer);
  drawRaba();
  if (!element) return;
  $("rabaNow").textContent = element.spoken ?? element.label;
  if (isLine(element)) {
    lineLabelTimer = setTimeout(() => say(element.label), 450);
  } else {
    navigator.vibrate?.(80);
    say(element.spoken);
  }
}

function leaveBoard() {
  clearTimeout(lineLabelTimer);
  stopTone();
  current = null;
  drawRaba();
}

const rabaArea = $("rabaArea");
rabaArea.addEventListener("pointerdown", (event) => { unlockAudio(); explore(event.clientX, event.clientY); });
rabaArea.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse" && !event.buttons) return;
  explore(event.clientX, event.clientY);
});
rabaArea.addEventListener("pointerup", leaveBoard);
rabaArea.addEventListener("pointercancel", leaveBoard);
rabaArea.addEventListener("click", (event) => {
  const label = event.target.getAttribute?.("aria-label");
  if (label) say(label);
});

addEventListener("resize", () => {
  if (!$("raba").hidden) layoutRaba();
  if (!$("sorot").hidden) layoutSorot();
});

/* Sorot: the lecturer's words sit on the part of the board being discussed */
let focusElement = null;
let recognition = null;
let listening = false;
let lectureTimer = null;

function samplePicture(board) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1000;
  const pen = canvas.getContext("2d");
  pen.fillStyle = "#FFFFFF";
  pen.fillRect(0, 0, 1000, 1000);
  drawBoard(pen, project(board, 1000, 1000, 0), MARKER, null, 2.6);
  return canvas;
}

function openSorot() {
  show("sorot", "sorotTitle");
  $("sorotTitle").textContent = state.board.title + (state.sample ? " (contoh)" : "");
  $("playLecture").hidden = !state.sample;
  focusElement = null;
  $("bubble").hidden = true;
  $("loose").textContent = "Tekan mulai saat dosen bicara.";
  layoutSorot();
}

function layoutSorot() {
  const picture = state.picture;
  const stage = $("stage");
  const width = stage.getBoundingClientRect().width;
  const maxHeight = innerHeight * 0.6;
  const height = Math.min(width * picture.height / picture.width, maxHeight);
  const drawWidth = height * picture.width / picture.height;
  stage.style.width = `${drawWidth}px`;
  stage.style.marginInline = "auto";
  const canvas = $("sorotCanvas");
  const pen = sizeCanvas(canvas, drawWidth, height);
  pen.drawImage(picture, 0, 0, drawWidth, height);
  if (focusElement) highlight(pen, focusElement, drawWidth, height);
  placeBubble(drawWidth, height);
}

function highlight(pen, element, width, height) {
  pen.save();
  pen.globalCompositeOperation = "multiply";
  pen.strokeStyle = pen.fillStyle = "#FFE14D";
  pen.lineCap = pen.lineJoin = "round";
  if (isLine(element)) {
    pen.lineWidth = 22;
    pen.beginPath();
    element.points.forEach((p) => pen.lineTo(p.x / 1000 * width, p.y / 1000 * height));
    pen.stroke();
  } else {
    const w = Math.max(element.w / 1000 * width, 44);
    const h = Math.max(element.h / 1000 * height, 44);
    pen.fillRect(element.x / 1000 * width - w / 2, element.y / 1000 * height - h / 2, w, h);
  }
  pen.restore();
}

function anchorOf(element) {
  if (!isLine(element)) return { x: element.x, y: element.y };
  return element.points[Math.floor(element.points.length / 2)];
}

function placeBubble(width, height) {
  const bubble = $("bubble");
  if (!focusElement || bubble.hidden) return;
  const anchor = anchorOf(focusElement);
  const x = anchor.x / 1000 * width;
  const y = anchor.y / 1000 * height;
  const { offsetWidth: w, offsetHeight: h } = bubble;
  const gap = BUBBLE_GAP + (isLine(focusElement) ? 0 : focusElement.h / 2000 * height);
  const below = y + gap + h <= height;
  const top = below ? y + gap : Math.max(0, y - gap - h);
  const left = Math.min(Math.max(0, x - w / 2), Math.max(0, width - w));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.setProperty("--tail", `${Math.min(Math.max(x - left, 20), w - 20)}px`);
  bubble.classList.toggle("below", below);
  bubble.classList.toggle("above", !below);
}

function heard(sentence) {
  const { element, how } = matchSentence(state.board, sentence);
  const bubble = $("bubble");
  if (how === "named") {
    focusElement = element;
    bubble.className = "";
    bubble.textContent = sentence;
    bubble.hidden = false;
    $("loose").textContent = "";
  } else if (how === "pointing" && focusElement) {
    // "Bagian ini" has no location in the words, so say honestly that this is a guess.
    bubble.className = "pointing";
    bubble.textContent = sentence;
    const guess = document.createElement("small");
    guess.textContent = "Tebakan: masih di bagian yang sama";
    bubble.append(guess);
    bubble.hidden = false;
    $("loose").textContent = "";
  } else {
    bubble.hidden = true;
    $("loose").textContent = sentence;
  }
  layoutSorot();
}

function startListening() {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) {
    $("loose").textContent = "Browser ini tidak bisa mendengar suara. Pakai Chrome.";
    return;
  }
  recognition = new Recognition();
  recognition.lang = "id-ID";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    const latest = event.results[event.results.length - 1];
    heard(latest[0].transcript.trim());
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      $("loose").textContent = "Izin mikrofon ditolak. Izinkan mikrofon di pengaturan browser.";
      stopListening();
    }
  };
  recognition.onend = () => { if (listening) recognition.start(); };
  listening = true;
  recognition.start();
  $("listen").textContent = "Berhenti dengar";
  $("listen").classList.add("on");
  $("loose").textContent = "Mendengarkan...";
}

function stopListening() {
  listening = false;
  recognition?.stop();
  recognition = null;
  clearTimeout(lectureTimer);
  $("listen").textContent = "Mulai dengar dosen";
  $("listen").classList.remove("on");
}

function playLecture() {
  stopListening();
  const lines = SAMPLE_LECTURES[state.sample];
  let index = 0;
  const next = () => {
    if (index >= lines.length) return;
    heard(lines[index]);
    index += 1;
    lectureTimer = setTimeout(next, 2800);
  };
  next();
}

/* Key dialog */
function openKeyDialog() {
  $("keyInput").value = loadKey();
  $("keyDialog").showModal();
}
$("keyDialog").addEventListener("close", () => {
  if ($("keyDialog").returnValue !== "save") return;
  saveKey($("keyInput").value.trim());
  if (!$("capture").hidden) note(loadKey() ? "Kunci tersimpan. Ambil foto lagi." : "");
});
$("keyClear").addEventListener("click", () => {
  saveKey("");
  $("keyInput").value = "";
  $("keyDialog").close();
});

/* Wiring */
async function enterCapture(mode) {
  state.mode = mode;
  unlockAudio();
  show("capture", "captureTitle");
  note("");
  if (mode === "raba") speak("Foto papan. Tombol ambil foto ada di bawah.");
  await startCamera();
}

function useSample(name) {
  const board = SAMPLES[name];
  openBoard(board, samplePicture(board), name);
}

$("goRaba").addEventListener("click", () => enterCapture("raba"));
$("goSorot").addEventListener("click", () => enterCapture("sorot"));
$("openKey").addEventListener("click", openKeyDialog);
$("shutter").addEventListener("click", sweepCapture);
$("gallery").addEventListener("click", () => $("file").click());
$("captureBack").addEventListener("click", () => show("home"));
$("sampleGraph").addEventListener("click", () => useSample("graph"));
$("sampleFlow").addEventListener("click", () => useSample("flow"));
$("rabaBack").addEventListener("click", () => { speechSynthesis.cancel(); enterCapture("raba"); });
$("sorotBack").addEventListener("click", () => enterCapture("sorot"));
$("rabaSummary").addEventListener("click", () => speak(summaryText()));
$("listen").addEventListener("click", () => (listening ? stopListening() : startListening()));
$("playLecture").addEventListener("click", playLecture);

$("file").addEventListener("change", async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  await readPicture(toCanvas(bitmap, bitmap.width, bitmap.height));
});

speechSynthesis?.getVoices();
