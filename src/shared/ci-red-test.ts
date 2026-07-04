// Deliberate lint violation (no-explicit-any) — proves the ci workflow goes
// red on a lint error. This branch is never merged.
export function ciRedTest(value: any): any {
  return value;
}
