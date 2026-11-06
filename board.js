// A board is what the AI reads from a photo. Coordinates are 0-1000 of the image.
// lines: { id, label, role: "axis" | "curve" | "link", points: [{x, y}], keywords }
// marks: { id, label, spoken, kind: "point" | "box" | "text" | "formula", x, y, w, h, keywords }

const parabola = Array.from({ length: 25 }, (_, i) => {
  const x = i / 4;
  return { x: Math.round(120 + x * 130), y: Math.round(860 - (6 * x - x * x) * 80) };
});

export const SAMPLES = {
  graph: {
    found: true,
    hint: "",
    kind: "graph",
    title: "Harga terhadap waktu",
    summary: "Grafik dengan satu kurva. Harga naik dari titik A ke puncak di titik B, lalu turun ke titik C.",
    uncertain: "",
    lines: [
      { id: "x", label: "Sumbu waktu", role: "axis", points: [{ x: 120, y: 860 }, { x: 950, y: 860 }], keywords: ["waktu", "sumbu x", "mendatar"] },
      { id: "y", label: "Sumbu harga", role: "axis", points: [{ x: 120, y: 860 }, { x: 120, y: 80 }], keywords: ["harga", "sumbu y", "tegak"] },
      { id: "curve", label: "Kurva harga", role: "curve", points: parabola, keywords: ["kurva", "parabola", "garis lengkung"] },
    ],
    marks: [
      { id: "a", label: "A", spoken: "Titik A, harga 5", kind: "point", x: 250, y: 460, w: 60, h: 60, keywords: ["titik a"] },
      { id: "b", label: "B", spoken: "Titik B, harga 9, ini puncaknya", kind: "point", x: 510, y: 140, w: 60, h: 60, keywords: ["titik b", "puncak", "maksimum", "tertinggi"] },
      { id: "c", label: "C", spoken: "Titik C, harga 5", kind: "point", x: 770, y: 460, w: 60, h: 60, keywords: ["titik c"] },
      { id: "f", label: "y = 6x - x²", spoken: "Rumus: y sama dengan enam x dikurangi x kuadrat", kind: "formula", x: 790, y: 90, w: 300, h: 80, keywords: ["rumus", "persamaan", "fungsi"] },
    ],
  },
  flow: {
    found: true,
    hint: "",
    kind: "flowchart",
    title: "Alur daftar ulang",
    summary: "Diagram alur dengan empat langkah dan satu pertanyaan. Mulai di atas, selesai di bawah.",
    uncertain: "",
    lines: [
      { id: "l1", label: "Panah ke pertanyaan", role: "link", points: [{ x: 420, y: 170 }, { x: 420, y: 280 }], keywords: [] },
      { id: "l2", label: "Panah ya, ke isi KRS", role: "link", points: [{ x: 420, y: 430 }, { x: 420, y: 530 }], keywords: ["jawaban ya"] },
      { id: "l3", label: "Panah ke selesai", role: "link", points: [{ x: 420, y: 640 }, { x: 420, y: 760 }], keywords: [] },
      { id: "l4", label: "Panah tidak, ke bayar UKT", role: "link", points: [{ x: 620, y: 355 }, { x: 740, y: 355 }], keywords: ["jawaban tidak"] },
    ],
    marks: [
      { id: "start", label: "Mulai", spoken: "Mulai", kind: "box", x: 420, y: 115, w: 280, h: 110, keywords: ["mulai", "awal"] },
      { id: "ask", label: "Sudah bayar?", spoken: "Pertanyaan: sudah bayar?", kind: "box", x: 420, y: 355, w: 400, h: 150, keywords: ["sudah bayar", "pertanyaan", "keputusan"] },
      { id: "krs", label: "Isi KRS", spoken: "Isi KRS", kind: "box", x: 420, y: 585, w: 280, h: 110, keywords: ["krs"] },
      { id: "end", label: "Selesai", spoken: "Selesai", kind: "box", x: 420, y: 815, w: 280, h: 110, keywords: ["selesai", "akhir"] },
      { id: "pay", label: "Bayar UKT", spoken: "Bayar UKT, lalu kembali ke pertanyaan", kind: "box", x: 845, y: 355, w: 210, h: 130, keywords: ["ukt", "bayar dulu"] },
    ],
  },
};

export const SAMPLE_LECTURES = {
  graph: [
    "Lihat grafik ini, sumbu mendatar adalah waktu.",
    "Sumbu tegak menunjukkan harga barang.",
    "Mulai dari titik A, harganya masih lima.",
    "Lalu naik sampai puncak di titik B.",
    "Perhatikan bagian ini, setelah itu mulai turun.",
    "Semua itu berasal dari rumus yang di kanan atas.",
  ],
  flow: [
    "Semua mahasiswa mulai dari sini, di kotak mulai.",
    "Lalu ada pertanyaan, sudah bayar atau belum.",
    "Kalau belum, harus bayar UKT dulu.",
    "Kalau sudah, langsung isi KRS.",
    "Setelah itu selesai.",
  ],
};

const POINTING_WORDS = ["ini", "itu", "sini", "situ", "tersebut", "tadi"];

const normalize = (text) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;

// Picks the part of the board a sentence is about. "pointing" means the lecturer
// said something like "ini" with no name, so the words alone cannot say where.
export function matchSentence(board, sentence) {
  const text = normalize(sentence);
  let best = null;
  let bestScore = 0;
  for (const element of [...board.marks, ...board.lines]) {
    const names = [...element.keywords, element.label].filter((name) => name.length > 1);
    const score = names.reduce((sum, name) => sum + (text.includes(normalize(name)) ? name.length : 0), 0);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  if (best) return { element: best, how: "named" };
  const pointing = POINTING_WORDS.some((word) => text.includes(` ${word} `));
  return { element: null, how: pointing ? "pointing" : "none" };
}

export const isLine = (element) => Array.isArray(element.points);

// Scales a board to a screen area. Stretching is fine because this is a redraw, not the photo.
export function project(board, width, height, pad) {
  const sx = (x) => pad + (x / 1000) * (width - pad * 2);
  const sy = (y) => pad + (y / 1000) * (height - pad * 2);
  return {
    lines: board.lines.map((line) => ({ source: line, points: line.points.map((p) => ({ x: sx(p.x), y: sy(p.y) })) })),
    marks: board.marks.map((mark) => ({
      source: mark,
      x: sx(mark.x),
      y: sy(mark.y),
      w: (mark.w / 1000) * (width - pad * 2),
      h: (mark.h / 1000) * (height - pad * 2),
    })),
  };
}

function distanceToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

const ROLE_ORDER = { curve: 0, link: 1, axis: 2 };

// Marks win over lines, and curves win over axes, so a finger on a crossing hears the content.
export function hitTest(view, x, y, tolerance) {
  for (const mark of view.marks) {
    const inside = Math.abs(x - mark.x) <= Math.max(mark.w / 2, tolerance) && Math.abs(y - mark.y) <= Math.max(mark.h / 2, tolerance);
    if (inside) return mark.source;
  }
  const lines = [...view.lines].sort((a, b) => ROLE_ORDER[a.source.role] - ROLE_ORDER[b.source.role]);
  for (const line of lines) {
    for (let i = 1; i < line.points.length; i++) {
      if (distanceToSegment(x, y, line.points[i - 1], line.points[i]) <= tolerance) return line.source;
    }
  }
  return null;
}
