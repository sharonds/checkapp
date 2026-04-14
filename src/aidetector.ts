import type { Config } from "./config.ts";

export interface AiSegment {
  text: string;
  aiScore: number; // 0.01–0.99
}

export interface AiDetectorResult {
  aiScore: number; // 0.01–0.99 global
  aiPct: number;   // rounded percentage for display
  verdict: "human" | "mixed" | "ai";
  topSegments: AiSegment[]; // top 3 highest-scoring segments
  error?: string;
}

const COPYSCAPE_API = "https://www.copyscape.com/api/";

// Thresholds — match industry conventions
const THRESHOLD_MIXED = 30; // 30%+ → mixed
const THRESHOLD_AI = 70;    // 70%+ → likely AI

export async function checkAiDetector(
  text: string,
  config: Config
): Promise<AiDetectorResult> {
  const body = new URLSearchParams({
    u: config.copyscapeUser,
    k: config.copyscapeKey,
    o: "aicheck",
    e: "UTF-8",
    f: "xml",
    t: text,
  });

  const response = await fetch(COPYSCAPE_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Copyscape AI detector error: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseAiResponse(xml);
}

function parseAiResponse(xml: string): AiDetectorResult {
  const errorMatch = xml.match(/<error>([\s\S]*?)<\/error>/);
  if (errorMatch) {
    const msg = errorMatch[1].trim();
    if (msg.toLowerCase().includes("insufficient")) {
      return {
        aiScore: 0,
        aiPct: 0,
        verdict: "human",
        topSegments: [],
        error: "Copyscape credits insufficient — AI detection skipped.",
      };
    }
    throw new Error(`Copyscape AI detector error: ${msg}`);
  }

  const globalScore = parseFloat(
    xml.match(/<aiscore>([\d.]+)<\/aiscore>/)?.[1] ?? "0"
  );

  const segments: AiSegment[] = [];
  const segmentBlocks = [...xml.matchAll(/<segment>([\s\S]*?)<\/segment>/g)];
  for (const block of segmentBlocks) {
    const inner = block[1];
    const text = inner.match(/<text>([\s\S]*?)<\/text>/)?.[1]?.trim() ?? "";
    const score = parseFloat(
      inner.match(/<aiscore>([\d.]+)<\/aiscore>/)?.[1] ?? "0"
    );
    if (text) segments.push({ text, aiScore: score });
  }

  // Top 3 segments by AI score (only surface high-confidence ones)
  const topSegments = [...segments]
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, 3)
    .filter((s) => s.aiScore >= 0.7);

  const aiPct = Math.round(globalScore * 100);
  const verdict =
    aiPct >= THRESHOLD_AI
      ? "ai"
      : aiPct >= THRESHOLD_MIXED
      ? "mixed"
      : "human";

  return { aiScore: globalScore, aiPct, verdict, topSegments };
}
