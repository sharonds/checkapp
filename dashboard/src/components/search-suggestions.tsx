/**
 * Google Search Suggestions for a grounded finding. The Gemini grounding ToS
 * requires showing them with grounded results. The HTML comes from Google, so it
 * is rendered in an iframe with no scripts and an opaque origin; only link-outs
 * (popups) are allowed.
 */
export function SearchSuggestions({ html }: { html?: string }) {
  if (!html) return null;
  return (
    <iframe
      data-search-suggestions
      title="Google Search suggestions"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={html}
      className="mt-2 block h-16 w-full border-0"
    />
  );
}
