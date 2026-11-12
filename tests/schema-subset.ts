/**
 * A first-party validator for the JSON Schema subset the http envelope uses:
 * type, required, properties, additionalProperties (false), items, minItems,
 * enum, pattern, minLength, maxLength, minimum and a local $ref. Anything else
 * in a schema is an error rather than a silent pass, so the schema cannot grow
 * a keyword this validator would ignore.
 *
 * Not exported; a test helper. A third-party validator (ajv) would need an
 * approval this does not.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description", "type", "required", "properties",
  "additionalProperties", "items", "minItems", "enum", "pattern", "minLength", "maxLength", "minimum",
]);

function typeOf(v: J): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

export function validate(root: J, value: J): string[] {
  const problems: string[] = [];
  const walk = (schema: J, v: J, path: string) => {
    for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`unsupported keyword ${k} at ${path}`);
    if (schema.$ref) {
      const name = String(schema.$ref).replace("#/$defs/", "");
      walk(root.$defs[name], v, path);
      return;
    }
    if (schema.type) {
      const t = typeOf(v);
      const ok = schema.type === t || (schema.type === "number" && t === "integer");
      if (!ok) {
        problems.push(`${path}: expected ${schema.type}, got ${t}`);
        return;
      }
    }
    if (schema.enum && !schema.enum.includes(v)) problems.push(`${path}: not in enum`);
    if (typeof v === "string") {
      const len = Array.from(v).length;
      if (schema.minLength !== undefined && len < schema.minLength) problems.push(`${path}: shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && len > schema.maxLength) problems.push(`${path}: longer than ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern, "u").test(v)) problems.push(`${path}: does not match ${schema.pattern}`);
    }
    if (typeof v === "number" && schema.minimum !== undefined && v < schema.minimum) problems.push(`${path}: below ${schema.minimum}`);
    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems) problems.push(`${path}: fewer than ${schema.minItems} items`);
      if (schema.items) v.forEach((e, i) => walk(schema.items, e, `${path}/${i}`));
    }
    if (typeOf(v) === "object") {
      for (const r of schema.required ?? []) if (!(r in v)) problems.push(`${path}: missing ${r}`);
      for (const [k, e] of Object.entries(v)) {
        const sub = schema.properties?.[k];
        if (sub) walk(sub, e, `${path}/${k}`);
        else if (schema.additionalProperties === false) problems.push(`${path}: unexpected member ${k}`);
      }
    }
  };
  walk(root, value, "");
  return problems;
}
