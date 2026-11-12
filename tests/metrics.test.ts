import { expect, test } from "vitest";
import { compareGeometry } from "./metrics";
import { layout } from "./layouts";
test("recognition scoring matches geometry despite IDs and endpoint order", () => {
  const truth = layout("studio", 1),
    actual = structuredClone(truth);
  actual.walls.forEach((w) => {
    const prior = w.id;
    w.id = "recognized-" + w.id;
    actual.openings
      .filter((o) => o.wallId === prior)
      .forEach((o) => (o.wallId = w.id));
  });
  const metrics = compareGeometry(actual, truth);
  expect(metrics.wallRecall).toBe(1);
  expect(metrics.openingRecall).toBe(1);
  const wall = actual.walls[0];
  const start = wall.start;
  wall.start = wall.end;
  wall.end = start;
  actual.openings
    .filter((o) => o.wallId === wall.id)
    .forEach(
      (o) =>
        (o.offset =
          Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) -
          o.offset -
          o.width),
    );
  expect(compareGeometry(actual, truth).openingRecall).toBe(1);
});
test("recognition scoring exposes missing elements and large positional errors", () => {
  const truth = layout("studio", 1),
    actual = structuredClone(truth);
  actual.walls.pop();
  actual.openings.pop();
  const metrics = compareGeometry(actual, truth);
  expect(metrics.wallRecall).toBe(0.75);
  expect(metrics.openingRecall).toBe(0.5);
  expect(metrics.wallPrecision).toBe(1);
  actual.walls.forEach((w) => {
    w.start.x += 500;
    w.end.x += 500;
  });
  expect(compareGeometry(actual, truth).wallRecall).toBe(0);
});
