import { test, expect, describe } from "bun:test";
import { SeoSkill, computeSeoMetrics, extractTopKeyword } from "./seo.ts";

describe("computeSeoMetrics", () => {
  test("word count", () => {
    const text = "Hello world this is a test.";
    const m = computeSeoMetrics(text);
    expect(m.wordCount).toBe(6);
  });

  test("detects headings in markdown", () => {
    const text = "# Title\n\nSome content.\n\n## Section\n\nMore content.";
    const m = computeSeoMetrics(text);
    expect(m.hasH1).toBe(true);
    expect(m.hasH2).toBe(true);
  });

  test("average sentence length", () => {
    const text = "One two three four. Five six seven eight.";
    const m = computeSeoMetrics(text);
    expect(m.avgSentenceWords).toBe(4);
  });

  test("word count in ideal range scores 100", () => {
    const words = Array(1200).fill("word").join(" ");
    const m = computeSeoMetrics(words);
    expect(m.wordCountScore).toBe(100);
  });

  test("word count too short scores less", () => {
    const m = computeSeoMetrics("short text");
    expect(m.wordCountScore).toBeLessThan(100);
  });
});

describe("extractTopKeyword", () => {
  test("extracts the most repeated meaningful word", () => {
    expect(extractTopKeyword("vinegar vinegar vinegar apple cider helps blood sugar")).toBe("vinegar");
  });
  test("ignores stop words", () => {
    expect(extractTopKeyword("the the the the apple apple")).toBe("apple");
  });
  test("returns empty for very short text", () => {
    expect(extractTopKeyword("hi")).toBe("");
  });
  test("ignores words with 3 or fewer characters", () => {
    expect(extractTopKeyword("the cat sat sat sat on mat")).toBe("");
  });
});

test("SeoSkill returns a SkillResult with costUsd 0", async () => {
  const skill = new SeoSkill();
  const config = {
    copyscapeUser: "", copyscapeKey: "",
    skills: { plagiarism: true, aiDetection: true, seo: true, factCheck: false, tone: false, legal: false },
  };
  const result = await skill.run("# Hello\n\nThis is a test article with enough content.", config as any);
  expect(result.costUsd).toBe(0);
  expect(result.skillId).toBe("seo");
  expect(["pass", "warn", "fail"]).toContain(result.verdict);
});
