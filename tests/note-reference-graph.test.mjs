import assert from "node:assert/strict";
import test from "node:test";

import { applySafeReferenceRepairs, buildNoteReferenceGraph } from "../realitycheck/scripts/note-reference-graph.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value) => encoder.encode(value);

test("reference graph safely repairs unique HTML and CSS casing/backslashes while preserving suffixes", () => {
  const input = new Map([
    ["index.html", bytes('<link rel="stylesheet" href="Styles\\MAIN.css?v=1#top"><img srcset="Images\\Hero.PNG 1x, images/hero@2x.png 2x">')],
    ["styles/main.css", bytes('.hero{background:url("..\\Images\\Hero.PNG?raw=1#crop")}')],
    ["Images/Hero.png", bytes("image")],
    ["images/hero@2x.png", bytes("image2")],
  ]);
  const result = applySafeReferenceRepairs(input);
  assert.equal(decoder.decode(result.entries.get("index.html")), '<link rel="stylesheet" href="styles/main.css?v=1#top"><img srcset="Images/Hero.png 1x, images/hero@2x.png 2x">');
  assert.equal(decoder.decode(result.entries.get("styles/main.css")), '.hero{background:url("../Images/Hero.png?raw=1#crop")}');
  assert.deepEqual(result.changes.map((change) => change.resolution), ["case-and-backslash", "case-and-backslash", "case-and-backslash"]);
});

test("reference graph reports but never guesses missing, ambiguous, escaping, or encoded paths", () => {
  const graph = buildNoteReferenceGraph(new Map([
    ["notes/index.html", bytes('<img src="../missing.png"><a href="../../escape.html">x</a><img src="GUIDE.png"><img src="image%20one.png">')],
    ["notes/Guide.png", bytes("a")],
    ["notes/guide.png", bytes("b")],
  ]));
  assert.deepEqual(graph.references.map((item) => item.resolution), ["missing", "escape", "ambiguous", "encoded-or-entity"]);
  assert.equal(applySafeReferenceRepairs(new Map(graph.entries.map((entry) => [entry.path, entry.bytes]))).changes.length, 0);
});

test("reference repair fails closed on non-UTF-8 text and leaves exact references unchanged", () => {
  assert.throws(() => buildNoteReferenceGraph(new Map([["index.html", new Uint8Array([0xff, 0xfe])]])), /non-UTF-8/);
  const result = applySafeReferenceRepairs(new Map([["index.html", bytes('<img src="asset.png">')], ["asset.png", bytes("x")]]));
  assert.equal(result.changes.length, 0);
  assert.equal(decoder.decode(result.entries.get("index.html")), '<img src="asset.png">');
});

test("reference repair does not edit CSS comments or quoted example text", () => {
  const css = '/* url(Images\\Hero.PNG) */ .example::before{content:"url(Images\\Hero.PNG)"}.real{background:url(Images\\Hero.PNG)}';
  const result = applySafeReferenceRepairs(new Map([["main.css", bytes(css)], ["images/Hero.png", bytes("x")]]));
  assert.equal(result.changes.length, 1);
  assert.equal(decoder.decode(result.entries.get("main.css")), '/* url(Images\\Hero.PNG) */ .example::before{content:"url(Images\\Hero.PNG)"}.real{background:url(images/Hero.png)}');
});

test("reference repair covers inline style attributes and style blocks with exact offsets", () => {
  const html = '<div style="background:url(Images\\Hero.PNG)"></div><style>.x{background:url(Images\\Hero.PNG)}</style>';
  const result = applySafeReferenceRepairs(new Map([["index.html", bytes(html)], ["images/Hero.png", bytes("x")]]));
  assert.equal(result.changes.length, 2);
  assert.equal(decoder.decode(result.entries.get("index.html")), '<div style="background:url(images/Hero.png)"></div><style>.x{background:url(images/Hero.png)}</style>');
});
