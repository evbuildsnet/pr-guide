import assert from "node:assert/strict";
import { test } from "node:test";

import { excerptRows, parseDiff } from "./diff.ts";
import type { Stop } from "./model.ts";
import { normalizeGuide } from "./normalize.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ export function a() {
 const one = 1;
-const two = 2;
+const two = 3;
+--- not a header
 const three = 3;
 const four = 4;
@@ -40,2 +41,0 @@
-gone();
-gone();
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

const files = parseDiff(["src/a.ts", "img.png", "src/b.ts"], PATCH);

const stop = (patch: Partial<Stop>): Stop => ({
  title: "A stop",
  summary: "",
  attention: null,
  excerpts: [],
  files: [],
  notes: [],
  questions: [],
  ...patch,
});

test("parses hunks, keeps source lines that look like headers, and lists hunkless files", () => {
  const [a, image] = files;
  assert.equal(a?.hunks.length, 2);
  assert.deepEqual(a?.hunks[0]?.rows.map((row) => [row.kind, row.oldLine, row.newLine]), [
    ["context", 10, 10],
    ["deletion", 11, null],
    ["addition", null, 11],
    ["addition", null, 12],
    ["context", 12, 13],
    ["context", 13, 14],
  ]);
  assert.equal(a?.additions, 2);
  assert.equal(a?.deletions, 3);
  assert.deepEqual(image?.hunks, []);
});

test("an excerpt shows replaced lines between the lines it asks for", () => {
  const rows = excerptRows(files[0]!, { side: "new", start: 10, end: 11 });
  assert.deepEqual(rows[0]?.map((row) => row.kind), ["context", "deletion", "addition"]);
});

test("clamps excerpts into hunks, drops stray notes, and places every file once", () => {
  const stops = normalizeGuide(
    {
      stops: [
        stop({
          excerpts: [
            { path: "src/a.ts", side: "new", start: 1, end: 12, caption: "" },
            { path: "src/missing.ts", side: "new", start: 1, end: 2, caption: "" },
          ],
          files: [{ path: "src/a.ts", note: "" }, { path: "img.png", note: "icon" }],
          notes: [
            { path: "src/a.ts", line: 11, title: "Kept", body: "" },
            { path: "src/a.ts", line: 30, title: "Outside", body: "" },
          ],
        }),
        stop({ title: "  " }),
        stop({ files: [{ path: "img.png", note: "again" }] }),
      ],
    },
    files,
  );
  assert.deepEqual(stops[0]?.excerpts.map(({ start, end }) => [start, end]), [[10, 12]]);
  assert.deepEqual(stops[0]?.notes.map((note) => note.title), ["Kept"]);
  assert.deepEqual(stops[0]?.files.map((file) => file.path), ["img.png"]);
  assert.deepEqual(stops[1]?.files, []);
  assert.equal(stops.at(-1)?.title, "Other files");
  assert.deepEqual(stops.at(-1)?.files.map((file) => file.path), ["src/b.ts"]);
});
