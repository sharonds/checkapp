// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SearchSuggestions } from "@/components/search-suggestions";

afterEach(() => cleanup());

describe("SearchSuggestions", () => {
  test("renders Google Search Suggestions in a script-free sandboxed iframe", () => {
    const html = `<div class="chip"><a href="https://www.google.com/search?q=x">x</a></div><script>window.pwned=1</script>`;
    const { container } = render(<SearchSuggestions html={html} />);
    const frame = container.querySelector("iframe[data-search-suggestions]");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame!.getAttribute("srcdoc")).toBe(html);
    // No suggestion markup is injected into the dashboard DOM itself.
    expect(container.querySelector(".chip")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  test("renders nothing when there are no suggestions", () => {
    const { container } = render(<SearchSuggestions html={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
