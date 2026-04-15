import { describe, it, expect } from "bun:test";
import { parseContextArgs } from "./context.ts";

describe("parseContextArgs", () => {
  it("parses add command", () => {
    expect(parseContextArgs(["add", "tone-guide", "./file.md"])).toEqual({ action: "add", type: "tone-guide", path: "./file.md" });
  });
  it("parses list command", () => {
    expect(parseContextArgs(["list"])).toEqual({ action: "list" });
  });
  it("parses show command", () => {
    expect(parseContextArgs(["show", "tone-guide"])).toEqual({ action: "show", type: "tone-guide" });
  });
  it("parses remove command", () => {
    expect(parseContextArgs(["remove", "brief"])).toEqual({ action: "remove", type: "brief" });
  });
  it("parses update command", () => {
    expect(parseContextArgs(["update", "brief", "./new.md"])).toEqual({ action: "update", type: "brief", path: "./new.md" });
  });
  it("defaults to list for unknown input", () => {
    expect(parseContextArgs(["unknown"])).toEqual({ action: "list" });
  });
});
