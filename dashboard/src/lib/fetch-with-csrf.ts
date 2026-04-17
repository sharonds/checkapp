const CSRF_META = "checkapp-csrf";

function readCsrfFromDom(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLMetaElement>(`meta[name="${CSRF_META}"]`)?.content ?? "";
}

export async function fetchWithCsrf(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const headers = new Headers(init.headers);
  if (mutating && !headers.has("x-checkapp-csrf")) {
    headers.set("x-checkapp-csrf", readCsrfFromDom());
  }
  return fetch(input, { ...init, headers });
}
