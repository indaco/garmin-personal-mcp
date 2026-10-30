// Types of scripts/fill-dashboard-fixture.mjs, for the demo data test.
export function asServer<T extends Record<string, unknown>>(
  activities: T[],
  workouts?: boolean,
): T[];
export function fillPage(
  template: string,
  data: unknown,
  layout?: unknown,
  settings?: Record<string, unknown> | null,
): string;
