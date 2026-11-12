import {
  type Model,
  type Draft,
  type Source,
  type Point,
} from "../shared/model";
export const families = [
  "studio",
  "two-bedroom",
  "l-shaped",
  "office",
  "retail",
  "clinic",
] as const;
export type Family = (typeof families)[number];
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function layout(family: Family, seed = 123): Model {
  const random = seeded(seed),
    w = 7600 + Math.round(random() * 1000),
    h = 5600 + Math.round(random() * 800);
  const polygon: Point[] =
    family === "l-shaped"
      ? [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h * 0.55 },
          { x: w * 0.55, y: h * 0.55 },
          { x: w * 0.55, y: h },
          { x: 0, y: h },
        ]
      : [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ];
  const walls = polygon.map((start, i) => ({
    id: "wall-" + i,
    label: [
      "North wall",
      "East wall",
      "South wall",
      "West wall",
      "Return wall",
      "Outer wall",
    ][i],
    start: { ...start },
    end: { ...polygon[(i + 1) % polygon.length] },
    thickness: 200,
    height: 2800,
  }));
  if (["two-bedroom", "office", "clinic"].includes(family)) {
    walls.push({
      id: "partition",
      label: "Main partition",
      start: { x: w * 0.55, y: 0 },
      end: { x: w * 0.55, y: h },
      thickness: 150,
      height: 2800,
    });
    walls.push({
      id: "cross-partition",
      label: "Room partition",
      start: { x: w * 0.55, y: h * 0.45 },
      end: { x: w, y: h * 0.45 },
      thickness: 150,
      height: 2800,
    });
  }
  if (family === "retail")
    walls.push({
      id: "partition",
      label: "Storage partition",
      start: { x: 0, y: h * 0.7 },
      end: { x: w, y: h * 0.7 },
      thickness: 150,
      height: 2800,
    });
  const openings: Model["openings"] = [
    {
      id: "window-1",
      label: "North window",
      kind: "window",
      wallId: "wall-0",
      offset: w * 0.25,
      width: 1500,
      height: 1200,
      sillHeight: 900,
    },
  ];
  const entry = walls[family === "l-shaped" ? 5 : 3];
  openings.push({
    id: "door-1",
    label: "Entry door",
    kind: "door",
    wallId: entry.id,
    offset: 900,
    width: 900,
    height: 2100,
    sillHeight: 0,
  });
  if (walls.some((w) => w.id === "partition"))
    openings.push({
      id: "door-2",
      label: "Internal door",
      kind: "door",
      wallId: "partition",
      offset: family === "retail" ? w * 0.4 : h * 0.6,
      width: 900,
      height: 2100,
      sillHeight: 0,
    });
  if (walls.some((w) => w.id === "cross-partition"))
    openings.push({
      id: "door-3",
      label: "Room door",
      kind: "door",
      wallId: "cross-partition",
      offset: 600,
      width: 800,
      height: 2100,
      sillHeight: 0,
    });
  const names: Record<Family, string[]> = {
    studio: ["Studio"],
    "two-bedroom": ["Living", "Bedroom", "Bedroom 2"],
    "l-shaped": ["Living", "Dining"],
    office: ["Workspace", "Meeting", "Office"],
    retail: ["Shop", "Storage"],
    clinic: ["Waiting", "Consultation", "Treatment"],
  };
  const rooms = names[family].map((label, i) => ({
    id: "room-" + i,
    label,
    x: i ? w * 0.75 : w * 0.25,
    y: i === 1 ? h * 0.22 : i === 2 ? h * 0.8 : h * 0.35,
  }));
  return {
    version: 1,
    revision: 0,
    name: family + "-" + seed,
    walls,
    openings,
    rooms,
    furniture: [],
  };
}
// Independent fixture coordinates, not the production conversion function.
export const pixel = (p: Point): Point => ({
  x: 100 + p.x * 0.08,
  y: 100 + p.y * 0.08,
});
export function fixtureDraft(model: Model): Draft {
  return {
    walls: model.walls.map((w) => ({
      ...w,
      start: pixel(w.start),
      end: pixel(w.end),
      thickness: w.thickness * 0.08,
    })),
    openings: model.openings.map((o) => ({
      ...o,
      offset: o.offset * 0.08,
      width: o.width * 0.08,
    })),
    rooms: model.rooms.map((r) => ({ ...r, ...pixel(r) })),
    notes: ["Fixture draft: heights use documented defaults."],
  };
}
export function fixtureSource(model: Model, dataUrl: string): Source {
  const first = model.walls[0];
  return {
    dataUrl,
    width: 1000,
    height: 800,
    filename: model.name + ".png",
    page: 1,
    calibration: {
      a: pixel(first.start),
      b: pixel(first.end),
      distance: Math.hypot(
        first.end.x - first.start.x,
        first.end.y - first.start.y,
      ),
    },
  };
}
export function expectedImageModel(model: Model): Model {
  const next = structuredClone(model);
  next.walls.forEach((w) => {
    w.start.x += 1250;
    w.start.y += 1250;
    w.end.x += 1250;
    w.end.y += 1250;
  });
  next.rooms.forEach((r) => {
    r.x += 1250;
    r.y += 1250;
  });
  return next;
}
export interface Fixture {
  id: string;
  family: Family;
  format: string;
  file: string;
  model: Model;
  source: Source;
  draft: Draft;
  degraded: boolean;
}
