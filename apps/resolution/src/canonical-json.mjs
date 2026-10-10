export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object") throw new TypeError(`canonical JSON cannot contain ${typeof value}`);
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`canonical JSON cannot contain undefined (${key})`);
    result[key] = sortValue(value[key]);
  }
  return result;
}