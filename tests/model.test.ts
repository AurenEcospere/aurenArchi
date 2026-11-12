import { describe, expect, test } from "vitest";
import {
  applyOperations,
  draftToModel,
  scaleFor,
  validateModel,
  projectSchema,
} from "../shared/model";
import { wallBoxes, exportSvg } from "../shared/geometry";
import { sampleModel } from "../shared/sample";
import {
  families,
  layout,
  fixtureDraft,
  fixtureSource,
  expectedImageModel,
} from "./layouts";
describe("30 reproducible layouts: geometry and edit invariants", () => {
  for (let seed = 1; seed <= 30; seed++)
    test("seed " + seed + " / " + families[(seed - 1) % 6], () => {
      const model = layout(families[(seed - 1) % 6], seed),
        source = fixtureSource(model, "data:image/png;base64,AA==");
      expect(validateModel(model)).toEqual([]);
      expect(scaleFor(source)).toBeCloseTo(12.5, 8);
      const draft = draftToModel(fixtureDraft(model), source, model.name, 0),
        expected = expectedImageModel(model);
      draft.walls.forEach((wall, i) => {
        expect(wall.start.x).toBeCloseTo(expected.walls[i].start.x, 6);
        expect(wall.end.y).toBeCloseTo(expected.walls[i].end.y, 6);
      });
      expect(
        projectSchema.parse(
          JSON.parse(JSON.stringify({ model: draft, source })),
        ).model,
      ).toEqual(draft);
      const moved = applyOperations(model, {
        revision: 0,
        operations: [
          { type: "move", id: model.walls[0].id, dx: 300, dy: -100 },
        ],
      });
      expect(moved.walls[0].start.x - model.walls[0].start.x).toBe(300);
      expect(moved.walls[0].end.y - model.walls[0].end.y).toBe(-100);
      expect(moved.openings).toEqual(model.openings);
      expect(model.revision).toBe(0);
      expect(moved.revision).toBe(1);
      expect(() =>
        applyOperations(moved, { revision: 0, operations: [] }),
      ).toThrow("stale");
      const opening = model.openings[0];
      expect(() =>
        applyOperations(model, {
          revision: 0,
          operations: [
            { type: "set", id: opening.id, property: "offset", value: 999999 },
          ],
        }),
      ).toThrow("beyond");
      const removed = applyOperations(model, {
        revision: 0,
        operations: [{ type: "delete", id: opening.wallId }],
      });
      expect(removed.openings.some((o) => o.wallId === opening.wallId)).toBe(
        false,
      );
      for (const wall of model.walls) {
        const boxes = wallBoxes(wall, model);
        const volume = boxes.reduce(
          (s, b) => s + b.width * b.depth * b.height,
          0,
        );
        const expectedVolume =
          Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) *
            wall.thickness *
            wall.height -
          model.openings
            .filter((o) => o.wallId === wall.id)
            .reduce((s, o) => s + o.width * o.height * wall.thickness, 0);
        expect(volume).toBeCloseTo(expectedVolume, 0);
        expect(boxes.every((b) => b.width > 0 && b.height > 0)).toBe(true);
      }
    });
});
test("sample is conflict-free; non-finite values, zero walls and duplicate IDs are rejected", () => {
  expect(validateModel(sampleModel)).toEqual([]);
  const m = structuredClone(sampleModel);
  m.walls[0].end = { ...m.walls[0].start };
  expect(validateModel(m).join(" ")).toContain("wall length");
  m.walls[0].end.x = NaN;
  expect(validateModel(m).length).toBeGreaterThan(0);
  const duplicate = structuredClone(sampleModel);
  duplicate.rooms[0].id = duplicate.walls[0].id;
  expect(validateModel(duplicate).join(" ")).toContain("Duplicate");
});
test("overlapping openings, missing hosts, negative sizes and over-height openings fail", () => {
  const m = structuredClone(sampleModel);
  m.openings.push({ ...m.openings[0], id: "overlap" });
  expect(validateModel(m).join(" ")).toContain("overlap");
  m.openings[0].wallId = "absent";
  expect(validateModel(m).join(" ")).toContain("missing");
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [{ type: "set", id: "d1", property: "height", value: 9999 }],
    }),
  ).toThrow("above");
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [{ type: "set", id: "d1", property: "width", value: -1 }],
    }),
  ).toThrow();
});
test("colliding furniture and obstructed door zones are rejected", () => {
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [
        {
          type: "addFurniture",
          furniture: {
            id: "f3",
            label: "Overlapping desk",
            x: 1300,
            y: 3100,
            width: 1000,
            depth: 500,
            height: 800,
          },
        },
      ],
    }),
  ).toThrow("overlaps");
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [
        {
          type: "addFurniture",
          furniture: {
            id: "f3",
            label: "Blocking desk",
            x: 1300,
            y: 5500,
            width: 800,
            depth: 400,
            height: 800,
          },
        },
      ],
    }),
  ).toThrow("obstructs");
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [
        {
          type: "addFurniture",
          furniture: {
            id: "f3",
            label: "Wall desk",
            x: 0,
            y: 2000,
            width: 1000,
            depth: 400,
            height: 800,
          },
        },
      ],
    }),
  ).toThrow("intersects");
});
test("opening translation stays on its host; properties remain element-specific", () => {
  const next = applyOperations(sampleModel, {
    revision: 0,
    operations: [{ type: "move", id: "d1", dx: 200, dy: 0 }],
  });
  expect(next.openings[0].offset).toBe(1000);
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [{ type: "move", id: "d1", dx: 0, dy: 200 }],
    }),
  ).toThrow("along");
  expect(() =>
    applyOperations(sampleModel, {
      revision: 0,
      operations: [{ type: "set", id: "w1", property: "width", value: 800 }],
    }),
  ).toThrow("Property");
});
test("SVG uses actual millimetre scale, escapes labels, and represents openings", () => {
  const m = structuredClone(sampleModel);
  m.rooms[0].label = "<script>&";
  const svg = exportSvg(m);
  expect(svg).toContain('width="8600mm"');
  expect(svg).toContain('viewBox="-300 -300 8600 6600"');
  expect(svg).toContain("&lt;script&gt;&amp;");
  expect(svg).toContain('x1="800" y1="6000" x2="1800" y2="6000"');
});
test("calibration rejects missing, coincident and invalid measurement points", () => {
  const source = fixtureSource(sampleModel, "data:image/png;base64,AA==");
  expect(() => scaleFor({ ...source, calibration: null })).toThrow(
    "Confirm scale",
  );
  expect(() =>
    scaleFor({
      ...source,
      calibration: { a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, distance: 8000 },
    }),
  ).toThrow("two pixels");
  expect(() =>
    scaleFor({
      ...source,
      calibration: { ...source.calibration!, distance: 0 },
    }),
  ).toThrow("positive");
  expect(() =>
    scaleFor({
      ...source,
      calibration: { ...source.calibration!, distance: Infinity },
    }),
  ).toThrow("finite");
});
