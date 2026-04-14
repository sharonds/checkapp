import { test, expect } from "bun:test";
import { PlagiarismSkill } from "./plagiarism.ts";

test("PlagiarismSkill has correct id and name", () => {
  const skill = new PlagiarismSkill();
  expect(skill.id).toBe("plagiarism");
  expect(skill.name).toBe("Plagiarism Check");
});
