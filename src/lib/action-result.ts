// Uniform result shape returned by every server action.
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = void>(error: string): ActionResult<T> {
  return { ok: false, error };
}

// Maps thrown errors to a user-safe ActionResult.
export function toActionError<T = void>(err: unknown): ActionResult<T> {
  if (err instanceof Error && err.name === "ForbiddenError") return fail(err.message);
  console.error("[action]", err);
  return fail("Something went wrong. Please try again.");
}
