import { z } from "zod";

export const pointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
export const wallSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    start: pointSchema,
    end: pointSchema,
    thickness: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export const openingSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    kind: z.enum(["door", "window"]),
    wallId: z.string(),
    offset: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
    sillHeight: z.number().nonnegative(),
  })
  .strict();
export const furnitureSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export const labelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();
export const modelSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    name: z.string().min(1),
    walls: z.array(wallSchema).max(500),
    openings: z.array(openingSchema).max(1000),
    furniture: z.array(furnitureSchema).max(500),
    rooms: z.array(labelSchema).max(500),
  })
  .strict();
export const sourceSchema = z
  .object({
    dataUrl: z.string().regex(/^data:image\/(png|jpeg);base64,/),
    width: z.number().positive(),
    height: z.number().positive(),
    filename: z.string(),
    page: z.number().int().positive(),
    calibration: z
      .object({
        a: pointSchema,
        b: pointSchema,
        distance: z.number().positive(),
      })
      .nullable(),
  })
  .strict();
export const projectSchema = z
  .object({ model: modelSchema, source: sourceSchema.nullable() })
  .strict();
export type Point = z.infer<typeof pointSchema>;
export type Wall = z.infer<typeof wallSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Furniture = z.infer<typeof furnitureSchema>;
export type Model = z.infer<typeof modelSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Project = z.infer<typeof projectSchema>;
export const operationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("move"),
      id: z.string(),
      dx: z.number().finite(),
      dy: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal("set"),
      id: z.string(),
      property: z.enum([
        "width",
        "height",
        "depth",
        "thickness",
        "offset",
        "sillHeight",
        "startX",
        "startY",
        "endX",
        "endY",
      ]),
      value: z.number().finite(),
    })
    .strict(),
  z.object({ type: z.literal("delete"), id: z.string() }).strict(),
  z
    .object({ type: z.literal("addFurniture"), furniture: furnitureSchema })
    .strict(),
]);
export const proposalSchema = z
  .object({
    revision: z.number().int(),
    explanation: z.string(),
    clarification: z.string().nullable(),
    operations: z.array(operationSchema).max(20),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type Operation = z.infer<typeof operationSchema>;
// Pixel-coordinate draft schema: validation happens after conversion to millimetres.
export const draftSchema = z
  .object({
    walls: z.array(wallSchema).max(500),
    openings: z.array(openingSchema).max(1000),
    rooms: z.array(labelSchema).max(500),
    notes: z.array(z.string()).max(100),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;
export const emptyModel = (name = "Untitled project"): Model => ({
  version: 1,
  revision: 0,
  name,
  walls: [],
  openings: [],
  rooms: [],
  furniture: [],
});
export const length = (wall: Wall) =>
  Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
export function scaleFor(source: Source): number {
  if (!source.calibration)
    throw new Error(
      "Confirm scale using two points and a known distance first.",
    );
  const { a, b, distance } = source.calibration;
  if (![a.x, a.y, b.x, b.y, distance].every(Number.isFinite) || distance <= 0)
    throw new Error(
      "Calibration requires finite points and a positive known distance.",
    );
  const pixels = Math.hypot(a.x - b.x, a.y - b.y);
  if (pixels < 2)
    throw new Error("Calibration points must be at least two pixels apart.");
  return distance / pixels;
}
export function draftToModel(
  draft: Draft,
  source: Source,
  name: string,
  revision: number,
): Model {
  const scale = scaleFor(source);
  const point = (p: Point) => ({ x: p.x * scale, y: p.y * scale });
  return {
    version: 1,
    revision,
    name,
    walls: draft.walls.map((w) => ({
      ...w,
      start: point(w.start),
      end: point(w.end),
      thickness: w.thickness * scale,
      height: w.height,
    })),
    openings: draft.openings.map((o) => ({
      ...o,
      width: o.width * scale,
      offset: o.offset * scale,
    })),
    rooms: draft.rooms.map((r) => ({ ...r, x: r.x * scale, y: r.y * scale })),
    furniture: [],
  };
}

export function validateModel(input: Model): string[] {
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message);
  const m = parsed.data,
    errors: string[] = [],
    ids = new Set<string>();
  for (const item of [...m.walls, ...m.openings, ...m.rooms, ...m.furniture]) {
    if (ids.has(item.id)) errors.push("Duplicate element ID: " + item.id);
    ids.add(item.id);
  }
  for (const wall of m.walls) {
    if (length(wall) < 1)
      errors.push(wall.label + ": wall length must be at least 1 mm.");
    const openings = m.openings
      .filter((o) => o.wallId === wall.id)
      .sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < openings.length; i++) {
      const o = openings[i];
      if (o.offset + o.width > length(wall) + 0.001)
        errors.push(o.label + ": opening extends beyond its wall.");
      if (o.sillHeight + o.height > wall.height + 0.001)
        errors.push(o.label + ": opening extends above its wall.");
      if (
        i &&
        openings[i - 1].offset + openings[i - 1].width > o.offset + 0.001
      )
        errors.push(o.label + ": openings overlap.");
    }
  }
  for (const o of m.openings)
    if (!m.walls.some((w) => w.id === o.wallId))
      errors.push(o.label + ": host wall is missing.");
  for (let i = 0; i < m.furniture.length; i++) {
    const f = m.furniture[i];
    for (const g of m.furniture.slice(i + 1))
      if (
        Math.abs(f.x - g.x) < (f.width + g.width) / 2 - 0.001 &&
        Math.abs(f.y - g.y) < (f.depth + g.depth) / 2 - 0.001
      )
        errors.push(f.label + " overlaps " + g.label + ".");
    for (const w of m.walls) {
      // Separating-axis test: axis-aligned furniture against the oriented wall footprint.
      const l = length(w);
      if (l < 1) continue;
      const ux = (w.end.x - w.start.x) / l,
        uy = (w.end.y - w.start.y) / l;
      const dx = f.x - (w.start.x + w.end.x) / 2,
        dy = f.y - (w.start.y + w.end.y) / 2;
      const overlaps = [
        [1, 0],
        [0, 1],
        [ux, uy],
        [-uy, ux],
      ].every(
        ([ax, ay]) =>
          Math.abs(dx * ax + dy * ay) <
          (f.width / 2) * Math.abs(ax) +
            (f.depth / 2) * Math.abs(ay) +
            (l / 2) * Math.abs(ux * ax + uy * ay) +
            (w.thickness / 2) * Math.abs(-uy * ax + ux * ay) -
            0.001,
      );
      if (overlaps) errors.push(f.label + " intersects " + w.label + ".");
      for (const o of m.openings.filter(
        (o) => o.wallId === w.id && o.kind === "door",
      )) {
        const cx = w.start.x + ux * (o.offset + o.width / 2),
          cy = w.start.y + uy * (o.offset + o.width / 2);
        if (
          Math.abs((f.x - cx) * ux + (f.y - cy) * uy) <
            o.width / 2 +
              (f.width / 2) * Math.abs(ux) +
              (f.depth / 2) * Math.abs(uy) &&
          Math.abs(-(f.x - cx) * uy + (f.y - cy) * ux) <
            600 + (f.width / 2) * Math.abs(uy) + (f.depth / 2) * Math.abs(ux)
        )
          errors.push(
            f.label + " obstructs the 600 mm review zone at " + o.label + ".",
          );
      }
    }
  }
  return errors;
}
export function applyOperations(
  model: Model,
  proposal: Pick<Proposal, "revision" | "operations">,
): Model {
  if (proposal.revision !== model.revision)
    throw new Error("This proposal is stale. Request a new proposal.");
  const next = structuredClone(model);
  for (const raw of proposal.operations) {
    const op = operationSchema.parse(raw);
    if (op.type === "addFurniture") {
      next.furniture.push(op.furniture);
      continue;
    }
    const wall = next.walls.find((w) => w.id === op.id),
      opening = next.openings.find((o) => o.id === op.id);
    const positioned = [...next.rooms, ...next.furniture].find(
      (f) => f.id === op.id,
    );
    if (!wall && !opening && !positioned)
      throw new Error("Element no longer exists: " + op.id);
    if (op.type === "delete") {
      next.walls = next.walls.filter((w) => w.id !== op.id);
      next.openings = next.openings.filter(
        (o) => o.id !== op.id && o.wallId !== op.id,
      );
      next.rooms = next.rooms.filter((r) => r.id !== op.id);
      next.furniture = next.furniture.filter((f) => f.id !== op.id);
      continue;
    }
    if (op.type === "move") {
      if (wall) {
        wall.start.x += op.dx;
        wall.end.x += op.dx;
        wall.start.y += op.dy;
        wall.end.y += op.dy;
      } else if (positioned) {
        positioned.x += op.dx;
        positioned.y += op.dy;
      } else if (opening) {
        const host = next.walls.find((w) => w.id === opening.wallId);
        if (!host) throw new Error("Host wall is missing.");
        const l = length(host),
          ux = (host.end.x - host.start.x) / l,
          uy = (host.end.y - host.start.y) / l;
        if (Math.abs(-uy * op.dx + ux * op.dy) > 0.01)
          throw new Error("Move openings along their host wall.");
        opening.offset += ux * op.dx + uy * op.dy;
      }
    } else {
      if (wall && ["startX", "startY", "endX", "endY"].includes(op.property)) {
        const p = op.property.startsWith("start") ? wall.start : wall.end;
        p[op.property.endsWith("X") ? "x" : "y"] = op.value;
      } else {
        const target = wall ?? opening ?? positioned;
        if (!target || !Object.hasOwn(target, op.property))
          throw new Error("Property is not available on this element.");
        (target as unknown as Record<string, unknown>)[op.property] = op.value;
      }
    }
  }
  const errors = validateModel(next);
  if (errors.length) throw new Error(errors.join(" "));
  next.revision = model.revision + 1;
  return next;
}
