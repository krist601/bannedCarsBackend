import { runBackupJobs } from "../lib/database-backups";
export default async function databaseBackup(container:any) { await runBackupJobs(container); }
// Check the Santiago calendar date every minute; handles DST and catches up after downtime.
export const config = { name:"database-backup",schedule:"* * * * *" };
