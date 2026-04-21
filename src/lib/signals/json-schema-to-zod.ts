import type { JSONSchema7 } from "json-schema";
import { z, type ZodTypeAny } from "zod";

export function jsonSchemaToZod(schema: JSONSchema7): ZodTypeAny {
  if (schema.enum && Array.isArray(schema.enum)) {
    const values = schema.enum as Array<string | number | boolean | null>;
    const zodValues = values.map((v) =>
      v === null ? z.null() : z.literal(v as string | number | boolean),
    );
    return zodValues.length === 1
      ? zodValues[0]
      : z.union(zodValues as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  const t = schema.type;
  if (Array.isArray(t)) {
    const nullable = t.includes("null");
    const nonNull = t.filter((x) => x !== "null") as string[];
    if (nonNull.length === 1) {
      const inner = jsonSchemaToZod({
        ...schema,
        type: nonNull[0] as JSONSchema7["type"],
      });
      return nullable ? inner.nullable() : inner;
    }
    const inner = z.unknown();
    return nullable ? inner.nullable() : inner;
  }

  switch (t) {
    case "string": {
      const s = schema.description
        ? z.string().describe(schema.description)
        : z.string();
      return s;
    }
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array": {
      const items = schema.items;
      const inner =
        items && !Array.isArray(items)
          ? jsonSchemaToZod(items as JSONSchema7)
          : z.unknown();
      return z.array(inner);
    }
    case "object": {
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, sub] of Object.entries(props)) {
        const subSchema = jsonSchemaToZod(sub as JSONSchema7);
        shape[key] = required.has(key) ? subSchema : subSchema.optional();
      }
      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}
