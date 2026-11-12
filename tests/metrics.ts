import { type Model } from "../shared/model";
import { openingPosition } from "../shared/geometry";
export function compareGeometry(actual: Model, truth: Model) {
  const matches = new Map<string, string>(),
    used = new Set<string>(),
    endpointErrors: number[] = [];
  for (const expected of truth.walls) {
    let nearest: { id: string; error: number } | null = null;
    for (const wall of actual.walls.filter((w) => !used.has(w.id))) {
      const distance = (
        a: { x: number; y: number },
        b: { x: number; y: number },
      ) => Math.hypot(a.x - b.x, a.y - b.y);
      const error = Math.min(
        Math.max(
          distance(wall.start, expected.start),
          distance(wall.end, expected.end),
        ),
        Math.max(
          distance(wall.start, expected.end),
          distance(wall.end, expected.start),
        ),
      );
      if (!nearest || error < nearest.error) nearest = { id: wall.id, error };
    }
    if (nearest) {
      endpointErrors.push(nearest.error);
      if (nearest.error <= 100) {
        matches.set(expected.id, nearest.id);
        used.add(nearest.id);
      }
    }
  }
  const usedOpenings = new Set<string>();
  let openings = 0;
  const openingErrors: number[] = [];
  for (const expected of truth.openings) {
    const host = truth.walls.find((w) => w.id === expected.wallId)!;
    const p = openingPosition(host, expected.offset + expected.width / 2);
    let closest: { id: string; error: number } | null = null;
    for (const o of actual.openings.filter(
      (o) =>
        o.kind === expected.kind &&
        o.wallId === matches.get(expected.wallId) &&
        !usedOpenings.has(o.id),
    )) {
      const w = actual.walls.find((w) => w.id === o.wallId);
      if (!w) continue;
      const q = openingPosition(w, o.offset + o.width / 2),
        error = Math.hypot(q.x - p.x, q.y - p.y);
      if (!closest || error < closest.error) closest = { id: o.id, error };
    }
    if (closest) {
      openingErrors.push(closest.error);
      if (closest.error <= 150) {
        openings++;
        usedOpenings.add(closest.id);
      }
    }
  }
  return {
    wallRecall: truth.walls.length ? matches.size / truth.walls.length : 1,
    wallPrecision: actual.walls.length ? matches.size / actual.walls.length : 0,
    openingRecall: truth.openings.length ? openings / truth.openings.length : 1,
    openingPrecision: actual.openings.length
      ? openings / actual.openings.length
      : 0,
    maxWallEndpointErrorMm: endpointErrors.length
      ? Math.max(...endpointErrors)
      : null,
    maxOpeningPositionErrorMm: openingErrors.length
      ? Math.max(...openingErrors)
      : null,
  };
}
