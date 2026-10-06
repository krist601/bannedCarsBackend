export const BACKUP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const BACKUP_TIMEZONE = "America/Santiago";
export function backupDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BACKUP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function expiredBackup(createdAt: string, now = Date.now()) {
  const time = Date.parse(createdAt);
  return Number.isFinite(time) && time <= now - BACKUP_RETENTION_MS;
}
export function validBackupId(value: unknown): value is string {
  return typeof value === "string" && /^\d{13}-[a-f0-9-]{36}$/.test(value);
}
export function normalizedSchema(schema: string) {
  return schema.split("\n").filter(line => !line.startsWith("--") && !/^\\(un)?restrict /.test(line) && line.trim()).join("\n");
}
