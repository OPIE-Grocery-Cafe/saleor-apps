const REDACTED = "[Filtered]";
const SENSITIVE_KEY =
  /authorization|cookie|token|secret|restricted.?key|encryption.?key|client.?secret|webhook.?secret/i;
const SENSITIVE_VALUE =
  /(Bearer\s+[^\s]+|(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)/g;

export function scrubSensitiveEventData<T>(event: T): T {
  return scrub(event, new WeakSet<object>()) as T;
}

function scrub(value: unknown, seen: WeakSet<object>, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return value.replace(SENSITIVE_VALUE, REDACTED);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => scrub(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      scrub(entryValue, seen, entryKey),
    ]),
  );
}
