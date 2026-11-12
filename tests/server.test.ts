import { expect, test, vi } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { createAI, type AIService } from "../server/ai";
import { sampleModel } from "../shared/sample";
import { fixtureSource, fixtureDraft, expectedImageModel } from "./layouts";
const source = fixtureSource(sampleModel, "data:image/png;base64,AA==");
function fake(overrides: Partial<AIService> = {}): AIService {
  return {
    classify: async () => 0.99,
    extract: async () => fixtureDraft(sampleModel),
    propose: async (m) => ({
      revision: m.revision,
      explanation: "Move north wall.",
      clarification: null,
      operations: [{ type: "move", id: "w1", dx: 300, dy: 0 }],
    }),
    image: async () => source.dataUrl,
    ...overrides,
  };
}
test("health exposes configuration status without credentials", async () => {
  const app = createApp(fake(), false, { vision: "example" });
  const r = await supertest(app).get("/api/health");
  expect(r.body).toEqual({
    ready: false,
    mode: "live",
    models: { vision: "example" },
  });
});
test("extract calibrates draft and reports review issues without accepting it", async () => {
  const app = createApp(fake(), true, {});
  const r = await supertest(app)
    .post("/api/extract-plan")
    .send({ source, name: "test", revision: 4 });
  expect(r.status).toBe(200);
  expect(r.body.model.walls[0].start.x).toBeCloseTo(
    expectedImageModel(sampleModel).walls[0].start.x,
  );
  expect(r.body.model.revision).toBe(4);
  expect(r.body.notes.length).toBeGreaterThan(0);
});
test("unreadable drawings are rejected before extraction", async () => {
  const extract = vi.fn();
  const app = createApp(fake({ classify: async () => 0.1, extract }), true, {});
  const r = await supertest(app)
    .post("/api/extract-plan")
    .send({ source, name: "test", revision: 0 });
  expect(r.status).toBe(422);
  expect(extract).not.toHaveBeenCalled();
});
test("valid proposals, ambiguity and conflicts have distinct outcomes", async () => {
  let r = await supertest(createApp(fake(), true, {}))
    .post("/api/propose-edit")
    .send({
      model: sampleModel,
      command: "move north 300 right",
      selected: null,
    });
  expect(r.status).toBe(200);
  expect(r.body.operations[0].dx).toBe(300);
  r = await supertest(
    createApp(
      fake({
        propose: async () => ({
          revision: 0,
          explanation: "",
          clarification: "Which wall?",
          operations: [{ type: "delete", id: "w1" }],
        }),
      }),
      true,
      {},
    ),
  )
    .post("/api/propose-edit")
    .send({ model: sampleModel, command: "move it", selected: null });
  expect(r.body.operations).toEqual([]);
  expect(r.body.clarification).toBe("Which wall?");
  r = await supertest(
    createApp(
      fake({
        propose: async () => ({
          revision: 0,
          explanation: "",
          clarification: null,
          operations: [
            { type: "set", id: "d1", property: "offset", value: 99999 },
          ],
        }),
      }),
      true,
      {},
    ),
  )
    .post("/api/propose-edit")
    .send({ model: sampleModel, command: "move door outside", selected: null });
  expect(r.status).toBe(422);
  expect(r.body.error).toContain("beyond");
});
test.each([401, 403, 429, 500])(
  "upstream %s never leaks secrets",
  async (status) => {
    const app = createApp(
      fake({
        classify: async () => {
          throw Object.assign(new Error("sensitive-upstream-value"), {
            status,
          });
        },
      }),
      true,
      {},
    );
    const r = await supertest(app)
      .post("/api/extract-plan")
      .send({ source, name: "test", revision: 0 });
    expect(r.status).toBe(status === 429 ? 429 : 502);
    expect(JSON.stringify(r.body)).not.toContain("sensitive-upstream-value");
  },
);
test("missing credentials never trigger a network request or fake success", async () => {
  const app = createApp(
    createAI({
      key: "",
      decisionModel: "gpt-6-luna",
      visionModel: "gpt-6.1-terra",
      editModel: "gpt-6.1-sol",
      imageModel: "gpt-image-2.5-sunburst",
    }),
    false,
    {},
  );
  const r = await supertest(app)
    .post("/api/extract-plan")
    .send({ source, name: "test", revision: 0 });
  expect(r.status).toBe(503);
  expect(r.body.error).toContain(".env");
});
test("invalid bodies, uncalibrated input, foreign origins and stale proposals fail", async () => {
  const app = createApp(fake(), true, {});
  let r = await supertest(app).post("/api/extract-plan").send({});
  expect(r.status).toBe(400);
  r = await supertest(app)
    .post("/api/propose-edit")
    .set("Origin", "https://other.example")
    .send({});
  expect(r.status).toBe(403);
  r = await supertest(app)
    .post("/api/propose-edit")
    .send({ model: sampleModel, command: "", selected: null });
  expect(r.status).toBe(400);
  r = await supertest(app)
    .post("/api/extract-plan")
    .send({
      source: { ...source, calibration: null },
      name: "test",
      revision: 0,
    });
  expect(r.status).toBe(400);
  expect(r.body.error).toContain("scale");
  const stale = createApp(
    fake({
      propose: async () => ({
        revision: 99,
        explanation: "old",
        clarification: null,
        operations: [{ type: "delete", id: "w1" }],
      }),
    }),
    true,
    {},
  );
  r = await supertest(stale)
    .post("/api/propose-edit")
    .send({ model: sampleModel, command: "delete", selected: "w1" });
  expect(r.status).toBe(422);
});
test("concept images are isolated from geometry and malformed AI drafts fail clearly", async () => {
  const app = createApp(fake(), true, {});
  const r = await supertest(app)
    .post("/api/concept-image")
    .send({ image: source.dataUrl, prompt: "natural materials" });
  expect(r.status).toBe(200);
  expect(r.body.image).toBe(source.dataUrl);
  const bad = createApp(
    fake({ extract: async () => ({ walls: [] }) as never }),
    true,
    {},
  );
  const b = await supertest(bad)
    .post("/api/extract-plan")
    .send({ source, name: "test", revision: 0 });
  expect(b.status).toBe(400);
});
