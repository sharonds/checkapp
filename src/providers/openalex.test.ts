import { describe, test, expect, mock, afterEach } from "bun:test";
import { oaSearch } from "./openalex.ts";

const originalFetch = globalThis.fetch;

function mockFetch(response: Response | Promise<Response>) {
  globalThis.fetch = mock(() => Promise.resolve(response)) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("oaSearch", () => {
  test("returns papers in SSPaper shape", async () => {
    const body = {
      results: [
        {
          id: "https://openalex.org/W123",
          doi: "https://doi.org/10.1136/bmj.i6583",
          title: "Vitamin D supplementation to prevent acute respiratory tract infections",
          publication_year: 2017,
          authorships: [{ author: { display_name: "Martineau AR" } }, { author: { display_name: "Jolliffe DA" } }],
          primary_location: { landing_page_url: "https://www.bmj.com/content/356/bmj.i6583" },
        },
      ],
    };
    mockFetch(new Response(JSON.stringify(body), { status: 200 }));
    const papers = await oaSearch("vitamin d respiratory", 5, { mailto: "me@example.com" });
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toContain("Vitamin D supplementation");
    expect(papers[0].year).toBe(2017);
    expect(papers[0].authors).toHaveLength(2);
    expect(papers[0].authors[0].name).toBe("Martineau AR");
    expect(papers[0].externalIds?.DOI).toBe("10.1136/bmj.i6583");
    expect(papers[0].url).toBe("https://www.bmj.com/content/356/bmj.i6583");
  });

  test("returns empty array when API returns no results", async () => {
    mockFetch(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const papers = await oaSearch("no match", 5);
    expect(papers).toEqual([]);
  });

  test("returns empty array on non-OK response", async () => {
    mockFetch(new Response("server error", { status: 500 }));
    const papers = await oaSearch("anything", 5);
    expect(papers).toEqual([]);
  });

  test("returns empty array on network throw", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
    const papers = await oaSearch("anything", 5);
    expect(papers).toEqual([]);
  });

  test("returns empty array on malformed JSON response", async () => {
    mockFetch(new Response("<html>not json</html>", { status: 200 }));
    const papers = await oaSearch("anything", 5);
    expect(papers).toEqual([]);
  });

  test("includes mailto in URL when provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    await oaSearch("q", 3, { mailto: "x@y.com" });
    expect(capturedUrl).toContain("mailto=x%40y.com");
  });

  test("omits mailto when not provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    await oaSearch("q", 3);
    expect(capturedUrl).not.toContain("mailto");
  });

  test("strips https://doi.org/ prefix from DOI field", async () => {
    const body = {
      results: [{
        id: "W1", doi: "https://doi.org/10.1000/xyz",
        title: "t", publication_year: 2020, authorships: [], primary_location: {},
      }],
    };
    mockFetch(new Response(JSON.stringify(body), { status: 200 }));
    const papers = await oaSearch("q", 1);
    expect(papers[0].externalIds?.DOI).toBe("10.1000/xyz");
  });
});
