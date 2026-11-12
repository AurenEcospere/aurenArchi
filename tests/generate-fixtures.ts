import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  families,
  layout,
  pixel,
  fixtureDraft,
  fixtureSource,
  expectedImageModel,
  type Fixture,
} from "./layouts";
const dir = path.resolve("tests/fixtures");
await fs.mkdir(dir, { recursive: true });
const manifest: Fixture[] = [];
function drawing(model: ReturnType<typeof layout>) {
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="white"/>',
  ];
  for (const w of model.walls) {
    const a = pixel(w.start),
      b = pixel(w.end);
    parts.push(
      '<line x1="' +
        a.x +
        '" y1="' +
        a.y +
        '" x2="' +
        b.x +
        '" y2="' +
        b.y +
        '" stroke="#222" stroke-width="' +
        w.thickness * 0.08 +
        '"/>',
    );
  }
  for (const o of model.openings) {
    const w = model.walls.find((w) => w.id === o.wallId)!,
      l = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y),
      ux = (w.end.x - w.start.x) / l,
      uy = (w.end.y - w.start.y) / l,
      a = pixel({ x: w.start.x + ux * o.offset, y: w.start.y + uy * o.offset }),
      b = pixel({
        x: w.start.x + ux * (o.offset + o.width),
        y: w.start.y + uy * (o.offset + o.width),
      });
    parts.push(
      '<line x1="' +
        a.x +
        '" y1="' +
        a.y +
        '" x2="' +
        b.x +
        '" y2="' +
        b.y +
        '" stroke="white" stroke-width="' +
        (w.thickness * 0.08 + 2) +
        '"/>',
    );
    if (o.kind === "window")
      parts.push(
        '<line x1="' +
          a.x +
          '" y1="' +
          a.y +
          '" x2="' +
          b.x +
          '" y2="' +
          b.y +
          '" stroke="#555" stroke-width="3"/>',
      );
    else {
      const ex = a.x - uy * o.width * 0.08,
        ey = a.y + ux * o.width * 0.08;
      parts.push(
        '<path d="M ' +
          b.x +
          " " +
          b.y +
          " Q " +
          (b.x - uy * o.width * 0.08) +
          " " +
          (b.y + ux * o.width * 0.08) +
          " " +
          ex +
          " " +
          ey +
          " L " +
          a.x +
          " " +
          a.y +
          '" stroke="#555" stroke-width="1" fill="none"/>',
      );
    }
  }
  for (const r of model.rooms) {
    const p = pixel(r);
    parts.push(
      '<text x="' +
        p.x +
        '" y="' +
        p.y +
        '" font-family="sans-serif" font-size="16" text-anchor="middle">' +
        r.label +
        "</text>",
    );
  }
  const w = model.walls[0],
    a = pixel(w.start),
    b = pixel(w.end);
  parts.push(
    '<path d="M ' +
      a.x +
      " 55 H " +
      b.x +
      " M " +
      a.x +
      " 45 V 70 M " +
      b.x +
      ' 45 V 70" stroke="#555" fill="none"/><text x="' +
      (a.x + b.x) / 2 +
      '" y="45" text-anchor="middle" font-family="sans-serif" font-size="14">' +
      Math.round(Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)) +
      ' mm</text><text x="100" y="750" font-family="sans-serif" font-size="18">' +
      model.name +
      " — single floor</text></svg>",
  );
  return Buffer.from(parts.join(""));
}
for (const [i, family] of families.entries()) {
  const truth = layout(family, 100 + i),
    svg = drawing(truth),
    png = await sharp(svg).png().toBuffer();
  for (const format of ["png", "jpeg", "pdf"]) {
    const id = family + "-" + format;
    let buffer: Uint8Array = png;
    if (format === "jpeg")
      buffer = await sharp(png).jpeg({ quality: 90 }).toBuffer();
    if (format === "pdf") {
      const doc = await PDFDocument.create(),
        image = await doc.embedPng(png);
      doc
        .addPage([1000, 800])
        .drawImage(image, { x: 0, y: 0, width: 1000, height: 800 });
      buffer = await doc.save();
    }
    const file = path.join(dir, id + "." + format);
    await fs.writeFile(file, buffer);
    manifest.push({
      id,
      family,
      format,
      file,
      model: expectedImageModel(truth),
      source: fixtureSource(
        truth,
        "data:image/png;base64," + png.toString("base64"),
      ),
      draft: fixtureDraft(truth),
      degraded: false,
    });
  }
  const variations = [
    "rotated",
    "low-contrast",
    "blurred",
    "compressed",
    "cluttered",
    "ambiguous",
  ];
  const variation = variations[i];
  let image = sharp(png);
  if (i === 0) image = image.rotate(90);
  if (i === 1) image = image.linear(0.25, 180);
  if (i === 2) image = image.blur(2.2);
  if (i === 3) image = sharp(await image.jpeg({ quality: 12 }).toBuffer());
  if (i === 4)
    image = image.composite([
      {
        input: Buffer.from(
          '<svg width="1000" height="800"><text x="180" y="300" font-size="45">CHECK / SERVICES / 4500</text><path d="M 0 380 H 1000" stroke="gray" stroke-width="6"/></svg>',
        ),
      },
    ]);
  if (i === 5)
    image = image.composite([
      {
        input: Buffer.from(
          '<svg width="1000" height="800"><rect x="70" y="100" width="100" height="260" fill="white"/></svg>',
        ),
      },
    ]);
  const degraded = await image.png().toBuffer(),
    id = family + "-" + variation,
    file = path.join(dir, id + ".png");
  await fs.writeFile(file, degraded);
  const draft = fixtureDraft(truth),
    source = fixtureSource(
      truth,
      "data:image/png;base64," + degraded.toString("base64"),
    );
  let expected = expectedImageModel(truth);
  if (i === 0) {
    const rotate = (p: { x: number; y: number }) => ({ x: 800 - p.y, y: p.x });
    draft.walls = draft.walls.map((w) => ({
      ...w,
      start: rotate(w.start),
      end: rotate(w.end),
    }));
    draft.rooms = draft.rooms.map((r) => ({ ...r, ...rotate(r) }));
    source.width = 800;
    source.height = 1000;
    source.calibration = {
      ...source.calibration!,
      a: rotate(source.calibration!.a),
      b: rotate(source.calibration!.b),
    };
    expected = {
      ...expected,
      walls: draft.walls.map((w) => ({
        ...w,
        start: { x: w.start.x * 12.5, y: w.start.y * 12.5 },
        end: { x: w.end.x * 12.5, y: w.end.y * 12.5 },
        thickness: w.thickness * 12.5,
      })),
      rooms: draft.rooms.map((r) => ({ ...r, x: r.x * 12.5, y: r.y * 12.5 })),
    };
  }
  manifest.push({
    id,
    family,
    format: "png",
    file,
    model: expected,
    source,
    draft,
    degraded: true,
  });
}
const multi = await PDFDocument.create();
for (const f of manifest
  .filter((f) => f.format === "png" && !f.degraded)
  .slice(0, 2)) {
  const image = await multi.embedPng(await fs.readFile(f.file));
  multi
    .addPage([1000, 800])
    .drawImage(image, { x: 0, y: 0, width: 1000, height: 800 });
}
await fs.writeFile(path.join(dir, "multi-page.pdf"), await multi.save());
await fs.writeFile(
  path.join(dir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  "Generated 18 clean uploads, six degraded drawings, and a two-page PDF.",
);
