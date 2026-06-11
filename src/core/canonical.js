// Canonical, byte-stable serialization for the normalized form.
//
// Sources: concept + first principles, zero files from any third-party skills-factory
// codebase (clean-room). See docs/04a-normalized-form.md ("Byte-stability").
//
// This module is the *contract*: the same logical value MUST serialize to the
// same bytes on every run, on every machine. The determinism gate and the
// content-hash both read these bytes, so the rules here are load-bearing:
//
//   - stable key ordering   (object keys emitted in sorted order, recursively)
//   - stable number format  (no locale drift, no float jitter, no -0)
//   - no incidental whitespace churn (a single fixed compact form)
//   - the caller is responsible for keeping timestamps / run IDs / absolute
//     machine paths OUT of the value (validateNoVolatile enforces it)
//
// Any change to the bytes produced here for the same logical value is a
// breaking (major) change to the normalized-form contract, never an
// incidental refactor.

/**
 * The marker the canonical encoder rejects so that no run-to-run-volatile
 * datum silently enters a payload and breaks byte-stability. These keys, if
 * present anywhere in a value, make the serialization non-deterministic.
 */
const VOLATILE_KEYS = new Set([
  "timestamp",
  "timestamps",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "runId",
  "run_id",
  "now",
  "date",
]);

/**
 * Format a number into a stable, locale-independent string.
 *
 * Rules: integers print without a decimal point; finite non-integers use the
 * shortest round-trippable form JavaScript already guarantees (Number -> String);
 * negative zero is normalized to "0"; non-finite numbers are rejected because
 * they have no canonical, portable JSON form.
 */
function formatNumber(n) {
  if (!Number.isFinite(n)) {
    throw new TypeError(
      `non-finite number cannot be canonically serialized: ${String(n)}`,
    );
  }
  if (Object.is(n, -0)) return "0";
  // Number -> String in JS is already the shortest round-trippable decimal and
  // is locale-independent, so it is a stable canonical form on its own.
  return String(n);
}

function encodeString(s) {
  // JSON.stringify on a string yields the canonical, escaped, quoted form.
  return JSON.stringify(s);
}

function encodeValue(value, path) {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return formatNumber(value);
  if (t === "string") return encodeString(value);

  if (t === "undefined") {
    throw new TypeError(`undefined is not serializable (at ${path || "<root>"})`);
  }
  if (t === "bigint" || t === "function" || t === "symbol") {
    throw new TypeError(
      `${t} is not serializable (at ${path || "<root>"})`,
    );
  }

  if (Array.isArray(value)) {
    // Array order is significant and preserved as-is; only objects get sorted.
    const items = value.map((v, i) => encodeValue(v, `${path}[${i}]`));
    return `[${items.join(",")}]`;
  }

  if (t === "object") {
    // Plain objects only. Reject exotic objects (Date, Map, Set, class
    // instances) because their JSON shape is ambiguous / volatile.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(
        `only plain objects are serializable, got ${value.constructor && value.constructor.name} (at ${path || "<root>"})`,
      );
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      const child = value[key];
      // Stable omission rule: keys whose value is undefined are dropped, so an
      // explicit-undefined and an absent key serialize identically.
      if (child === undefined) continue;
      parts.push(`${encodeString(key)}:${encodeValue(child, `${path}.${key}`)}`);
    }
    return `{${parts.join(",")}}`;
  }

  throw new TypeError(`unserializable value of type ${t} (at ${path || "<root>"})`);
}

/**
 * Walk a value and throw if it carries a run-to-run-volatile key. This keeps
 * the "no timestamps / run IDs" rule mechanical rather than a convention.
 */
function validateNoVolatile(value, path = "") {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => validateNoVolatile(v, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(value)) {
    if (VOLATILE_KEYS.has(key)) {
      throw new TypeError(
        `volatile key "${key}" breaks byte-stability (at ${path || "<root>"}.${key})`,
      );
    }
    validateNoVolatile(value[key], `${path}.${key}`);
  }
}

/**
 * Serialize a value to its canonical, byte-stable string form.
 *
 * @param {unknown} value - a JSON-shaped value (null, boolean, finite number,
 *   string, array, or plain object) free of volatile keys.
 * @returns {string} the canonical serialization.
 */
export function canonicalize(value) {
  validateNoVolatile(value);
  return encodeValue(value, "");
}

export { VOLATILE_KEYS, formatNumber };
