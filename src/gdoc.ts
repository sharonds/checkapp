/**
 * Fetches plain text from a Google Doc or reads a local file.
 *
 * Google Docs: works automatically when the doc is shared publicly.
 * Local files: pass an absolute path (/path/to/file.md), relative path
 * (./file.md, ../file.md), or any path ending in .md or .txt.
 */
import { readFile } from "fs/promises";

/**
 * Returns true when the argument looks like a local file path rather than
 * a Google Doc URL or raw Doc ID.
 */
export function isLocalPath(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    lower.endsWith(".md") ||
    lower.endsWith(".txt")
  );
}

export function extractDocId(url: string): string {
  // Handles formats:
  //   https://docs.google.com/document/d/DOC_ID/edit
  //   https://docs.google.com/document/d/DOC_ID/view
  //   https://docs.google.com/document/d/DOC_ID
  //   DOC_ID (raw ID passed directly)
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // If no URL pattern matched, treat the whole string as a raw Doc ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;

  throw new Error(
    `Could not extract a Google Doc ID from: "${url}"\n` +
      `Make sure you paste the full URL, e.g.:\n` +
      `  https://docs.google.com/document/d/XXXX/edit`
  );
}

export async function fetchGoogleDoc(input: string): Promise<string> {
  // Check if input is a local file path
  if (isLocalPath(input)) {
    try {
      const raw = await readFile(input, "utf-8");
      return cleanText(raw);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(`File not found: ${input}`);
      throw err;
    }
  }

  // Otherwise, treat as Google Doc URL or ID
  const docId = extractDocId(input);
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  const response = await fetch(exportUrl, {
    headers: {
      // Mimic a browser request so Google doesn't redirect to a login page
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    redirect: "follow",
  });

  if (response.status === 403 || response.status === 401) {
    throw new Error(
      `Access denied (HTTP ${response.status}).\n\n` +
        `The document is private. Please share it:\n` +
        `  Google Docs → Share → Change to "Anyone with the link" → Viewer`
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch Google Doc (HTTP ${response.status})`);
  }

  const text = await response.text();

  // Detect Google login redirect page (returned as 200 with HTML)
  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
    throw new Error(
      `The document is private and requires login.\n\n` +
        `Please share it:\n` +
        `  Google Docs → Share → Change to "Anyone with the link" → Viewer`
    );
  }

  return cleanText(text);
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n") // normalise line endings
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
