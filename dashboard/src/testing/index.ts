/**
 * Testing helpers for dashboard API routes.
 * Inlined here; B2.0 will expand as needed.
 */

export function csrfTokenForTests(): string {
  return "test-csrf-token";
}

export function writeTestConfig(cfg: Record<string, any>): void {
  // This will be fully implemented in B2.0 with proper fs mocking.
  // For now, tests can inline their own config mocks as needed.
}
