import "dotenv/config";
import express from "express";
import path from "node:path";
import { createApp } from "./app";
import { createAI } from "./ai";
const config = {
  key: process.env.OPENAI_API_KEY ?? "",
  decisionModel: process.env.OPENAI_DECISION_MODEL ?? "gpt-6-luna",
  visionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-6.1-terra",
  editModel: process.env.OPENAI_EDIT_MODEL ?? "gpt-6.1-sol",
  imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-sunburst",
};
if (process.env.AI_MODE && process.env.AI_MODE !== "live")
  throw new Error(
    "Only AI_MODE=live is supported. Tests inject simulated services explicitly.",
  );
const app = createApp(createAI(config), Boolean(config.key), {
  decision: config.decisionModel,
  vision: config.visionModel,
  edit: config.editModel,
  image: config.imageModel,
});
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1", () =>
  console.log(
    "Auren Arch backend listening locally; AI " +
      (config.key ? "configured" : "awaiting .env credentials") +
      ".",
  ),
);
