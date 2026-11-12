import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  draftSchema,
  proposalSchema,
  type Draft,
  type Model,
  type Proposal,
  type Source,
  scaleFor,
} from "../shared/model";

export interface AIService {
  classify(image: string): Promise<number>;
  extract(source: Source, model?: string): Promise<Draft>;
  propose(
    model: Model,
    command: string,
    selected: string | null,
  ): Promise<Proposal>;
  image(image: string, prompt: string): Promise<string>;
}
export interface AIConfig {
  key: string;
  decisionModel: string;
  visionModel: string;
  editModel: string;
  imageModel: string;
}
export function createAI(config: AIConfig): AIService {
  // No network requests until an AI action is explicitly invoked.
  const client = new OpenAI({
    apiKey: config.key || "unconfigured",
    timeout: 90000,
    maxRetries: 1,
  });
  function check() {
    if (!config.key) throw new Error("AI_NOT_CONFIGURED");
  }
  return {
    async classify(image) {
      check();
      // REST keeps Decisions isolated from SDK version differences.
      const response = await fetch("https://api.openai.com/v1/decisions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.key,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
          model: config.decisionModel,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "Inspect this uploaded drawing." },
                { type: "input_image", image_url: image },
              ],
            },
          ],
          questions: [
            {
              type: "predicate",
              name: "supported_plan",
              instructions:
                "Is this a readable single-floor architectural floor plan with predominantly straight walls? Reject unrelated photos, unreadable scans, elevations, and multi-floor overlays.",
            },
          ],
        }),
      });
      if (!response.ok) {
        const err = new Error("AI_REQUEST_FAILED") as Error & {
          status: number;
        };
        err.status = response.status;
        throw err;
      }
      const data = (await response.json()) as {
        answers?: { type: string; name: string; probability?: number }[];
      };
      const answer = data.answers?.find((a) => a.name === "supported_plan");
      if (
        answer?.type !== "predicate" ||
        typeof answer.probability !== "number" ||
        !Number.isFinite(answer.probability)
      )
        throw new Error("AI_INVALID_OUTPUT");
      return answer.probability;
    },
    async extract(source, model) {
      check();
      const scale = scaleFor(source);
      const response = await client.responses.parse({
        model: model ?? config.visionModel,
        input: [
          {
            role: "system",
            content:
              "Extract a single-floor plan into the supplied schema. Coordinates are pixels in the supplied image, origin top-left. Trace wall CENTRELINES, not both edges. Use stable unique IDs and meaningful labels. Doors/windows must reference host wall IDs. Wall thickness, opening width and offset are PIXELS; offset is distance along host from its start to near opening edge. Wall height, opening height and sillHeight are MILLIMETRES. Default wall height 2800 mm, door height 2100 mm and sill 0, window height 1200 mm and sill 900 mm when unknown; list all assumptions in notes. Extract only visible straight walls and openings. Do not guess obscured geometry or certify accuracy. Return room label anchor coordinates in pixels. Use empty arrays and notes when unreadable.",
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Image dimensions " +
                  source.width +
                  " x " +
                  source.height +
                  " pixels. Calibration: " +
                  JSON.stringify(source.calibration) +
                  ". Scale " +
                  scale +
                  " mm/pixel. Review dimensions and flag uncertainty.",
              },
              {
                type: "input_image",
                image_url: source.dataUrl,
                detail: "high",
              },
            ],
          },
        ],
        text: { format: zodTextFormat(draftSchema, "floor_plan_draft") },
      });
      if (!response.output_parsed) throw new Error("AI_INVALID_OUTPUT");
      return draftSchema.parse(response.output_parsed);
    },
    async propose(model, command, selected) {
      check();
      const response = await client.responses.parse({
        model: config.editModel,
        input: [
          {
            role: "system",
            content:
              "Propose controlled architectural edit operations, never arbitrary code. Units are millimetres; x right, y down. Move wall translates both endpoints. Move opening must be along host direction; prefer setting offset. set supports only existing element properties; startX/startY/endX/endY apply only to walls. delete wall removes hosted openings. addFurniture uses centre x/y and axis-aligned footprint. Return current revision exactly. Only use existing IDs except unique new furniture ID. If target, direction, dimensions or intent are ambiguous, return clarification and zero operations. Do not claim geometry validation; application validates proposals. Corridor widening and unsupported changes must ask for explicit walls and offsets.",
          },
          {
            role: "user",
            content: JSON.stringify({
              model,
              selectedElementId: selected,
              command,
            }),
          },
        ],
        text: { format: zodTextFormat(proposalSchema, "edit_proposal") },
      });
      if (!response.output_parsed) throw new Error("AI_INVALID_OUTPUT");
      return proposalSchema.parse(response.output_parsed);
    },
    async image(image, prompt) {
      check();
      const bytes = Buffer.from(image.split(",")[1], "base64");
      const response = await client.images.edit({
        model: config.imageModel,
        image: await toFile(bytes, "reference.png", { type: "image/png" }),
        prompt:
          "Create an architectural concept illustration based on this reference. Preserve its broad layout; this illustration is separate from the dimensioned geometry. " +
          prompt,
      });
      const encoded = response.data?.[0]?.b64_json;
      if (!encoded) throw new Error("AI_INVALID_OUTPUT");
      return "data:image/png;base64," + encoded;
    },
  };
}
