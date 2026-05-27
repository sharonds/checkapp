import { readFile } from "fs/promises";

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
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  throw new Error(
    `Could not extract a Google Doc ID from: "${url}"\n` +
      `Make sure you paste the full URL, e.g.:\n` +
      `  https://docs.google.com/document/d/XXXX/edit`
  );
}

// Returns the tab ID (e.g. "t.rqhjvmdg4l1h") when present and safe,
// undefined otherwise. Only alphanumeric chars, dots, and hyphens are allowed
// so the value is safe to interpolate into a URL query string without encoding.
export function extractTabId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const tab = parsed.searchParams.get("tab");
    if (!tab) return undefined;
    if (!/^[a-zA-Z0-9.\-]{1,64}$/.test(tab)) return undefined;
    return tab;
  } catch {
    return undefined;
  }
}

export async function fetchGoogleDoc(input: string): Promise<string> {
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

  const docId = extractDocId(input);
  const tabId = extractTabId(input);

  const exportUrl = new URL(
    `https://docs.google.com/document/d/${docId}/export`
  );
  exportUrl.searchParams.set("format", "txt");
  if (tabId) exportUrl.searchParams.set("tab", tabId);

  const response = await fetch(exportUrl.toString(), {
    headers: {
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
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
