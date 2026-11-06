// Tried in order. Busy models answer 503, so a live demo must not depend on one.
const MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];
const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const TIMEOUT_MS = 40000;
const BUSY_STATUSES = [500, 503, 504];

const PROMPT = `You read a photo of a university whiteboard, blackboard or projected slide for students with disabilities.
Return only what is really drawn or written. Never invent values, labels or lines.

All coordinates are integers from 0 to 1000 relative to the whole image: x from the left edge, y from the top edge.

- found: false if no readable graph, diagram or formula is visible. Then hint says in short Indonesian how to move the phone, such as "Geser ponsel ke kiri".
- kind: graph, flowchart, diagram or formula.
- title: short Indonesian title.
- summary: one or two spoken Indonesian sentences that describe the overall shape and meaning.
- uncertain: short Indonesian note about anything hard to read, or an empty string.
- lines: every axis (role axis), every curve or plotted line (role curve), every arrow or connector (role link). Follow the real ink closely. Use 2 points for straight lines and 12 to 30 points for curves.
- marks: every named point (kind point), box or shape with text (kind box), loose text (kind text), and formula (kind formula). x and y are the centre, w and h are the size.
- spoken: how a screen reader should say the mark in Indonesian, with values and formulas fully in words, such as "Titik B, harga 9" or "Rumus: y sama dengan x kuadrat".
- keywords: lowercase Indonesian words a lecturer would say about this element, such as "puncak" for the highest point or "sumbu x" for the horizontal axis.
- label: the text as written, or a short Indonesian name for unlabelled lines.`;

const text = { type: "string" };
const number = { type: "integer" };
const keywords = { type: "array", items: text };

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    hint: text,
    kind: { type: "string", enum: ["graph", "flowchart", "diagram", "formula"] },
    title: text,
    summary: text,
    uncertain: text,
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: text,
          label: text,
          role: { type: "string", enum: ["axis", "curve", "link"] },
          points: {
            type: "array",
            items: { type: "object", properties: { x: number, y: number }, required: ["x", "y"] },
          },
          keywords,
        },
        required: ["id", "label", "role", "points", "keywords"],
      },
    },
    marks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: text,
          label: text,
          spoken: text,
          kind: { type: "string", enum: ["point", "box", "text", "formula"] },
          x: number,
          y: number,
          w: number,
          h: number,
          keywords,
        },
        required: ["id", "label", "spoken", "kind", "x", "y", "w", "h", "keywords"],
      },
    },
  },
  required: ["found", "hint", "kind", "title", "summary", "uncertain", "lines", "marks"],
};

export class BoardReadError extends Error {}

const STATUS_MESSAGES = {
  400: "Kunci AI ditolak. Periksa kunci di pengaturan.",
  401: "Kunci AI ditolak. Periksa kunci di pengaturan.",
  403: "Kunci AI ditolak. Periksa kunci di pengaturan.",
  429: "Kuota AI habis. Tunggu sebentar lalu coba lagi.",
};

async function ask(model, body, apiKey) {
  try {
    return await fetch(endpoint(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body,
    });
  } catch {
    return null;
  }
}

export async function readBoard(base64Jpeg, apiKey) {
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: base64Jpeg } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
  });

  let response = null;
  for (const model of MODELS) {
    response = await ask(model, body, apiKey);
    if (response && !BUSY_STATUSES.includes(response.status)) break;
  }
  if (!response) throw new BoardReadError("Tidak bisa menghubungi AI. Periksa internet lalu coba lagi.");
  if (BUSY_STATUSES.includes(response.status)) throw new BoardReadError("AI sedang sibuk. Coba lagi sebentar.");
  if (!response.ok) {
    throw new BoardReadError(STATUS_MESSAGES[response.status] ?? `AI gagal membaca papan (kode ${response.status}). Coba lagi.`);
  }
  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!reply) throw new BoardReadError("AI tidak memberi jawaban. Coba foto lagi.");
  return JSON.parse(reply);
}
