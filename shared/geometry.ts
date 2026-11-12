import { type Model, type Wall, length } from "./model";
export function bounds(model: Model) {
  const points = model.walls.flatMap((w) => [w.start, w.end]);
  for (const f of model.furniture)
    points.push(
      { x: f.x - f.width / 2, y: f.y - f.depth / 2 },
      { x: f.x + f.width / 2, y: f.y + f.depth / 2 },
    );
  if (!points.length) return { x: 0, y: 0, width: 10000, height: 8000 };
  const x = Math.min(...points.map((p) => p.x)) - 300,
    y = Math.min(...points.map((p) => p.y)) - 300;
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x + 300,
    height: Math.max(...points.map((p) => p.y)) - y + 300,
  };
}
export interface WallBox {
  wallId: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  angle: number;
}
export function wallBoxes(wall: Wall, model: Model): WallBox[] {
  const l = length(wall),
    ux = (wall.end.x - wall.start.x) / l,
    uy = (wall.end.y - wall.start.y) / l;
  const openings = model.openings
      .filter((o) => o.wallId === wall.id)
      .sort((a, b) => a.offset - b.offset),
    boxes: WallBox[] = [];
  function box(start: number, end: number, bottom: number, top: number) {
    if (end - start <= 0.001 || top - bottom <= 0.001) return;
    boxes.push({
      wallId: wall.id,
      x: wall.start.x + (ux * (start + end)) / 2,
      y: wall.start.y + (uy * (start + end)) / 2,
      z: (bottom + top) / 2,
      width: end - start,
      depth: wall.thickness,
      height: top - bottom,
      angle: Math.atan2(uy, ux),
    });
  }
  let cursor = 0;
  for (const o of openings) {
    box(cursor, o.offset, 0, wall.height);
    box(o.offset, o.offset + o.width, 0, o.sillHeight);
    box(o.offset, o.offset + o.width, o.sillHeight + o.height, wall.height);
    cursor = o.offset + o.width;
  }
  box(cursor, l, 0, wall.height);
  return boxes;
}
export function openingPosition(wall: Wall, offset: number) {
  const l = length(wall);
  return {
    x: wall.start.x + ((wall.end.x - wall.start.x) * offset) / l,
    y: wall.start.y + ((wall.end.y - wall.start.y) * offset) / l,
  };
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function exportSvg(model: Model): string {
  const b = bounds(model);
  const walls = model.walls
    .map(
      (w) =>
        '<line x1="' +
        w.start.x +
        '" y1="' +
        w.start.y +
        '" x2="' +
        w.end.x +
        '" y2="' +
        w.end.y +
        '" stroke="#163d36" stroke-width="' +
        w.thickness +
        '"/>',
    )
    .join("");
  const openings = model.openings
    .map((o) => {
      const w = model.walls.find((w) => w.id === o.wallId)!;
      const a = openingPosition(w, o.offset),
        b = openingPosition(w, o.offset + o.width);
      return (
        '<line x1="' +
        a.x +
        '" y1="' +
        a.y +
        '" x2="' +
        b.x +
        '" y2="' +
        b.y +
        '" stroke="' +
        (o.kind === "door" ? "#ffffff" : "#8bbdc7") +
        '" stroke-width="' +
        (w.thickness + 2) +
        '"/>'
      );
    })
    .join("");
  const furniture = model.furniture
    .map(
      (f) =>
        '<rect x="' +
        (f.x - f.width / 2) +
        '" y="' +
        (f.y - f.depth / 2) +
        '" width="' +
        f.width +
        '" height="' +
        f.depth +
        '" fill="#d7c2a3" stroke="#987d56"/>',
    )
    .join("");
  const rooms = model.rooms
    .map(
      (r) =>
        '<text x="' +
        r.x +
        '" y="' +
        r.y +
        '" font-family="sans-serif" font-size="160" text-anchor="middle">' +
        escape(r.label) +
        "</text>",
    )
    .join("");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    b.width +
    'mm" height="' +
    b.height +
    'mm" viewBox="' +
    [b.x, b.y, b.width, b.height].join(" ") +
    '"><title>' +
    escape(model.name) +
    '</title><rect x="' +
    b.x +
    '" y="' +
    b.y +
    '" width="' +
    b.width +
    '" height="' +
    b.height +
    '" fill="white"/>' +
    walls +
    openings +
    furniture +
    rooms +
    "</svg>"
  );
}
