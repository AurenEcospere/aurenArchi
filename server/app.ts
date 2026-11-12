import express from "express";
import { z } from "zod";
import {
  sourceSchema,
  modelSchema,
  draftSchema,
  proposalSchema,
  draftToModel,
  applyOperations,
  validateModel,
  scaleFor,
} from "../shared/model";
import { type AIService } from "./ai";

export function createApp(
  ai: AIService,
  ready: boolean,
  models: Record<string, string>,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res
        .status(403)
        .json({ error: "Only local workspace requests are allowed." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "32mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ ready, mode: "live", models }),
  );
  app.post("/api/extract-plan", async (req, res, next) => {
    try {
      const { source, name, revision } = z
        .object({
          source: sourceSchema,
          name: z.string().min(1).max(200),
          revision: z.number().int().nonnegative(),
        })
        .parse(req.body);
      try {
        scaleFor(source);
      } catch (error) {
        res
          .status(400)
          .json({
            error:
              error instanceof Error
                ? error.message
                : "Invalid scale calibration.",
          });
        return;
      }
      const probability = await ai.classify(source.dataUrl);
      if (probability < 0.5) {
        res
          .status(422)
          .json({
            error:
              "The drawing could not be classified as a readable supported floor plan. Trace manually or try a clearer page.",
            probability,
          });
        return;
      }
      const draft = draftSchema.parse(await ai.extract(source));
      const model = draftToModel(draft, source, name, revision);
      // Invalid drafts remain reviewable; accepting them is separately guarded in the client.
      res.json({
        draft,
        model,
        notes: draft.notes,
        issues: validateModel(model),
        probability,
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/propose-edit", async (req, res, next) => {
    try {
      const { model, command, selected } = z
        .object({
          model: modelSchema,
          command: z.string().trim().min(1).max(2000),
          selected: z.string().nullable(),
        })
        .parse(req.body);
      const errors = validateModel(model);
      if (errors.length) {
        res
          .status(422)
          .json({
            error:
              "Correct model issues before AI editing: " + errors.join(" "),
          });
        return;
      }
      const proposal = proposalSchema.parse(
        await ai.propose(model, command, selected),
      );
      if (proposal.clarification) {
        res.json({ ...proposal, operations: [] });
        return;
      }
      if (!proposal.operations.length) {
        res.status(422).json({ error: "No supported edit was proposed." });
        return;
      }
      try {
        applyOperations(model, proposal);
      } catch (error) {
        res
          .status(422)
          .json({
            error: error instanceof Error ? error.message : "Invalid proposal.",
          });
        return;
      }
      res.json(proposal);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/concept-image", async (req, res, next) => {
    try {
      const { image, prompt } = z
        .object({
          image: z
            .string()
            .regex(/^data:image\/png;base64,/)
            .max(28000000),
          prompt: z.string().trim().min(1).max(2000),
        })
        .parse(req.body);
      res.json({ image: await ai.image(image, prompt) });
    } catch (error) {
      next(error);
    }
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error:
              "Invalid request: " +
              error.issues
                .map((i) => i.path.join(".") + " " + i.message)
                .join("; "),
          });
        return;
      }
      const err = error as {
        message?: string;
        status?: number;
        type?: string;
        name?: string;
      };
      if (err.message === "AI_NOT_CONFIGURED") {
        res
          .status(503)
          .json({
            error:
              "Add OPENAI_API_KEY to the root .env file and restart the backend. Manual editing remains available.",
          });
        return;
      }
      if (err.type === "entity.too.large") {
        res
          .status(413)
          .json({ error: "Request too large. Use a smaller drawing." });
        return;
      }
      if (err.type === "entity.parse.failed") {
        res.status(400).json({ error: "Invalid JSON request." });
        return;
      }
      const status =
        err.status === 401 || err.status === 403
          ? 502
          : err.status === 429
            ? 429
            : 502;
      const message =
        err.status === 401 || err.status === 403
          ? "OpenAI credentials or model access were rejected. Check your .env configuration."
          : err.status === 429
            ? "OpenAI rate limit reached. Retry later."
            : err.name?.includes("Timeout") || err.name === "AbortError"
              ? "OpenAI request timed out. Retry or edit manually."
              : "AI request failed or returned an unusable result. Retry or edit manually.";
      // Never echo upstream messages, request bodies or credentials.
      res.status(status).json({ error: message });
    },
  );
  return app;
}
