import { test, expect } from "bun:test";
import { AiDetectionSkill } from "./aidetection.ts";

test("AiDetectionSkill has correct id and name", () => {
  const skill = new AiDetectionSkill();
  expect(skill.id).toBe("ai-detection");
  expect(skill.name).toBe("AI Detection");
});
