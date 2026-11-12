import { afterEach, expect, test, vi } from "vitest";
import { createAI } from "../server/ai";
import { fixtureDraft, fixtureSource, layout } from "./layouts";
const config = {
  key: "test-only-placeholder",
  decisionModel: "gpt-6-luna",
  visionModel: "gpt-6.1-terra",
  editModel: "gpt-6.1-sol",
  imageModel: "gpt-image-2.5-sunburst",
};
afterEach(() => vi.restoreAllMocks());
function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
function envelope(data: unknown) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 0,
    status: "completed",
    model: "test",
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: JSON.stringify(data), annotations: [] },
        ],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}
test("Decisions sends image evidence and uses its configured model; refusals fail clearly", async () => {
  let sent: any;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    expect(req.url).toBe("https://api.openai.com/v1/decisions");
    sent = await req.json();
    return response({
      answers: [
        { name: "supported_plan", type: "predicate", probability: 0.9 },
      ],
    });
  });
  const ai = createAI(config);
  expect(await ai.classify("data:image/png;base64,AA==")).toBe(0.9);
  expect(sent.model).toBe("gpt-6-luna");
  expect(sent.input[0].content[1].type).toBe("input_image");
  expect(sent.questions[0].name).toBe("supported_plan");
  vi.mocked(fetch).mockResolvedValue(
    response({ answers: [{ name: "supported_plan", type: "refusal" }] }),
  );
  await expect(ai.classify("data:image/png;base64,AA==")).rejects.toThrow(
    "AI_INVALID_OUTPUT",
  );
});
test("Responses extraction uses pixel calibration and a strict structured schema", async () => {
  const model = layout("studio", 1),
    draft = fixtureDraft(model),
    source = fixtureSource(model, "data:image/png;base64,AA==");
  let sent: any;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    expect(req.url).toBe("https://api.openai.com/v1/responses");
    sent = await req.json();
    return response(envelope(draft));
  });
  const result = await createAI(config).extract(source);
  expect(result).toEqual(draft);
  expect(sent.model).toBe("gpt-6.1-terra");
  expect(sent.text.format.type).toBe("json_schema");
  expect(sent.text.format.strict).toBe(true);
  expect(sent.input[1].content[0].text).toContain("12.5 mm/pixel");
});
test("Responses edit service preserves IDs, selection and model revision", async () => {
  const model = layout("studio", 1),
    proposal = {
      revision: 0,
      explanation: "Move wall",
      clarification: null,
      operations: [{ type: "move", id: "wall-0", dx: 300, dy: 0 }],
    };
  let sent: any;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    sent = await new Request(input, init).json();
    return response(envelope(proposal));
  });
  expect(
    await createAI(config).propose(model, "Move right 300 mm", "wall-0"),
  ).toEqual(proposal);
  expect(sent.model).toBe("gpt-6.1-sol");
  expect(JSON.parse(sent.input[1].content).selectedElementId).toBe("wall-0");
});
test("Image API sends a PNG reference and preserves the requested 2.5 model", async () => {
  let sent: FormData | null = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    expect(req.url).toBe("https://api.openai.com/v1/images/edits");
    sent = await req.formData();
    return response({ created: 0, data: [{ b64_json: "AA==" }] });
  });
  expect(
    await createAI(config).image("data:image/png;base64,AA==", "Oak finish"),
  ).toBe("data:image/png;base64,AA==");
  expect(sent!.get("model")).toBe("gpt-image-2.5-sunburst");
  expect(String(sent!.get("prompt"))).toContain("Oak finish");
  expect(sent!.get("image")).toBeInstanceOf(Blob);
});
