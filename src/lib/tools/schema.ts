// Minimal JSON Schema subset used for tool inputs and structured outputs.
export type JSONSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string; properties?: Record<string, JSONSchema>; required?: string[]; items?: JSONSchema;
  enum?: (string | number)[]; minimum?: number; maximum?: number; maxLength?: number; minLength?: number; maxItems?: number; additionalProperties?: boolean; format?: string;
};

export function validate(schema: JSONSchema, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
    const o = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (o[r] === undefined || o[r] === null || o[r] === "") errs.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(o)) {
      const p = schema.properties?.[k];
      if (p) { if (v !== undefined && v !== null) errs.push(...validate(p, v, `${path}.${k}`)); }
      else if (schema.additionalProperties === false) errs.push(`${path}.${k} is not allowed`);
    }
  } else if (t === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items!, v, `${path}[${i}]`)));
  } else if (t === "string") {
    if (typeof value !== "string") return [`${path} must be a string`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path} exceeds ${schema.maxLength} characters`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path} is shorter than ${schema.minLength} characters`);
    if (schema.format === "uri" && !/^https?:\/\//i.test(value)) errs.push(`${path} must be an http(s) URL`);
  } else if (t === "number" || t === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a number`];
    if (t === "integer" && !Number.isInteger(value)) errs.push(`${path} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path} must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path} must be ≤ ${schema.maximum}`);
  } else if (t === "boolean" && typeof value !== "boolean") return [`${path} must be a boolean`];
  if (schema.enum && !schema.enum.includes(value as string | number)) errs.push(`${path} must be one of ${schema.enum.join(", ")}`);
  return errs;
}

/** Builds a schema from Machine Builder output fields. */
export function schemaFromFields(fields: { key: string; type: string; description?: string; required?: boolean }[], list?: boolean): JSONSchema {
  const item: JSONSchema = {
    type: "object",
    properties: Object.fromEntries(fields.map((f) => [f.key, { type: f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string", description: f.description, ...(f.type === "url" ? { format: "uri" } : {}) } as JSONSchema])),
    required: fields.filter((f) => f.required !== false).map((f) => f.key),
  };
  return list ? { type: "object", properties: { items: { type: "array", items: item } }, required: ["items"] } : item;
}

/** Extracts the first JSON value from model text (handles ```json fences). */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const src = (fenced ?? text).trim();
  try { return JSON.parse(src); } catch { /* fallthrough */ }
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found");
  for (let end = src.length; end > start; end--) { const ch = src[end - 1]; if (ch !== "}" && ch !== "]") continue; try { return JSON.parse(src.slice(start, end)); } catch { /* keep trimming */ } }
  throw new Error("Malformed JSON");
}
