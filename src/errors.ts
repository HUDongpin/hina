import type { HinaErrorCode, JsonObject, JsonValue } from "./types";

/**
 * Validation/contract error exposed by the public API.
 *
 * The class carries only JSON-safe data so an error can be logged or forwarded
 * across a Next.js server boundary via `toJSON()`.
 */
export class HinaValidationError extends Error {
  public override readonly name = "HinaValidationError";
  public readonly code: HinaErrorCode;
  public readonly details: JsonObject | undefined;

  public constructor(
    code: HinaErrorCode,
    message: string,
    details?: Readonly<Record<string, JsonValue>>,
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }

  public toJSON(): Readonly<Record<string, JsonValue>> {
    const serialized: Record<string, JsonValue> = {
      name: this.name,
      code: this.code,
      message: this.message,
    };

    if (this.details !== undefined) {
      serialized["details"] = this.details;
    }

    return serialized;
  }
}

/** Narrow an unknown value to a HINA validation error. */
export function isHinaValidationError(
  value: unknown,
): value is HinaValidationError {
  return value instanceof HinaValidationError;
}
