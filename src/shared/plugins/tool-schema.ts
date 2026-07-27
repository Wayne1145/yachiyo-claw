/**
 * Restricted JSON Schema validator for plugin tool inputs (platform-25).
 *
 * Plugins declare tool parameters as JSON Schema (they cannot ship zod into the isolate). A full
 * JSON Schema implementation is attack surface — `$ref` cycles, `patternProperties` regex DoS — so
 * only an explicit subset is accepted and anything else rejects THAT tool at registration:
 * object/string/number/integer/boolean/array + enum + required + bounds, max depth 3, ≤20 properties.
 */

const ALLOWED_COMMON_KEYS = new Set(['type', 'description', 'enum', 'default'])
const ALLOWED_BY_TYPE: Record<string, Set<string>> = {
  object: new Set([...ALLOWED_COMMON_KEYS, 'properties', 'required', 'additionalProperties']),
  string: new Set([...ALLOWED_COMMON_KEYS, 'minLength', 'maxLength']),
  number: new Set([...ALLOWED_COMMON_KEYS, 'minimum', 'maximum']),
  integer: new Set([...ALLOWED_COMMON_KEYS, 'minimum', 'maximum']),
  boolean: ALLOWED_COMMON_KEYS,
  array: new Set([...ALLOWED_COMMON_KEYS, 'items', 'minItems', 'maxItems']),
}

const LIMITS = { maxDepth: 3, maxProperties: 20, maxEnumValues: 50, maxDescription: 200 } as const

export type SchemaCheck = { ok: true } | { ok: false; reason: string }

function checkNode(node: unknown, depth: number, path: string): SchemaCheck {
  if (depth > LIMITS.maxDepth) return { ok: false, reason: `${path}: exceeds max depth ${LIMITS.maxDepth}` }
  if (!node || typeof node !== 'object' || Array.isArray(node))
    return { ok: false, reason: `${path}: schema node must be an object` }
  const record = node as Record<string, unknown>

  const type = record.type
  if (typeof type !== 'string' || !(type in ALLOWED_BY_TYPE)) {
    return { ok: false, reason: `${path}: unsupported or missing type "${String(type)}"` }
  }
  const allowedKeys = ALLOWED_BY_TYPE[type]
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `${path}: unsupported keyword "${key}"` }
  }
  if (typeof record.description === 'string' && record.description.length > LIMITS.maxDescription) {
    return { ok: false, reason: `${path}: description too long` }
  }
  if (record.enum !== undefined) {
    if (!Array.isArray(record.enum) || record.enum.length === 0 || record.enum.length > LIMITS.maxEnumValues) {
      return { ok: false, reason: `${path}: enum must be a non-empty array of at most ${LIMITS.maxEnumValues}` }
    }
    if (record.enum.some((value) => typeof value === 'object' && value !== null)) {
      return { ok: false, reason: `${path}: enum values must be primitives` }
    }
  }
  if (type === 'object') {
    const properties = record.properties
    if (properties !== undefined) {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        return { ok: false, reason: `${path}: properties must be an object` }
      }
      const entries = Object.entries(properties as Record<string, unknown>)
      if (entries.length > LIMITS.maxProperties) return { ok: false, reason: `${path}: too many properties` }
      for (const [name, child] of entries) {
        if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
          return { ok: false, reason: `${path}: forbidden property name "${name}"` }
        }
        const childCheck = checkNode(child, depth + 1, `${path}.${name}`)
        if (!childCheck.ok) return childCheck
      }
    }
    if (record.required !== undefined) {
      if (!Array.isArray(record.required) || record.required.some((value) => typeof value !== 'string')) {
        return { ok: false, reason: `${path}: required must be a string array` }
      }
    }
    if (record.additionalProperties !== undefined && record.additionalProperties !== false) {
      return { ok: false, reason: `${path}: additionalProperties may only be false` }
    }
  }
  if (type === 'array') {
    if (record.items === undefined) return { ok: false, reason: `${path}: array requires items` }
    const itemsCheck = checkNode(record.items, depth + 1, `${path}.items`)
    if (!itemsCheck.ok) return itemsCheck
  }
  return { ok: true }
}

/** Validates a plugin tool's input schema. The root must be an object schema. */
export function validatePluginToolInputSchema(schema: unknown): SchemaCheck {
  if (schema === undefined) return { ok: true } // No-parameter tool.
  const root = checkNode(schema, 1, '$')
  if (!root.ok) return root
  if ((schema as Record<string, unknown>).type !== 'object') {
    return { ok: false, reason: '$: root schema must have type "object"' }
  }
  return { ok: true }
}
