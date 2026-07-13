export type LogFields = Record<string, unknown>;

export function info(event: string, fields: LogFields = {}) {
  write("info", event, fields);
}

export function warn(event: string, fields: LogFields = {}) {
  write("warn", event, fields);
}

export function error(event: string, failure: unknown, fields: LogFields = {}) {
  write("error", event, {
    ...fields,
    error: failure instanceof Error ? failure.message : String(failure)
  });
}

function write(level: "info" | "warn" | "error", event: string, fields: LogFields) {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}
