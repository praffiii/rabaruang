import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLES, hitTest, matchSentence, project } from "./board.js";

const graph = SAMPLES.graph;
const view = project(graph, 1000, 1000, 0);

test("a finger on the curve finds the curve, not the axis below it", () => {
  assert.equal(hitTest(view, 380, 220, 24)?.id, "curve");
});

test("a named point wins over the curve running through it", () => {
  assert.equal(hitTest(view, 510, 140, 24)?.id, "b");
});

test("blank board finds nothing", () => {
  assert.equal(hitTest(view, 510, 600, 24), null);
});

test("a sentence naming a part anchors to that part", () => {
  assert.equal(matchSentence(graph, "Lalu naik sampai puncak di titik B.").element.id, "b");
  assert.equal(matchSentence(graph, "Sumbu tegak menunjukkan harga barang.").element.id, "y");
});

test("bare pointing is reported as pointing, never as a confident match", () => {
  assert.deepEqual(matchSentence(graph, "Perhatikan bagian ini ya."), { element: null, how: "pointing" });
});

test("unrelated talk matches nothing", () => {
  assert.equal(matchSentence(graph, "Tugas dikumpulkan minggu depan.").how, "none");
});
