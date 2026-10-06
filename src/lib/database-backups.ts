import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import Redis from "ioredis";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { BACKUP_RETENTION_MS, BACKUP_TIMEZONE, backupDay, expiredBackup, validBackupId, normalizedSchema } from "./database-backup-policy";

type Backup = { id: string; createdAt: string; bytes: number; kind: string; day?: string; schema: string; sha256: string; iv: string; tag: string; version: 1 };
type Operation = { id: string; action: "backup" | "restore"; status: "queued" | "running" | "completed" | "failed"; startedAt: string; finishedAt?: string; backupId?: string; safetyBackupId?: string; message?: string };
let redis: Redis | undefined;
let activeRequests = 0;
const namespace = () => `cms-backups:${process.env.BACKUP_NAMESPACE || "local"}:`;
const key = (part: string) => namespace() + part;
function store() {
  if (!redis) redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
  return redis;
}
export function backupConfigured() {
  return process.env.BACKUPS_ENABLED === "true";
}
function config() {
  if (!backupConfigured()) throw new Error("Backups are not configured on this server.");
  if (!process.env.BACKUP_BUCKET || process.env.BACKUP_BUCKET === process.env.S3_BUCKET) throw new Error("Configure a separate private BACKUP_BUCKET.");
  if (!/^[a-f0-9]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || "")) throw new Error("Configure BACKUP_ENCRYPTION_KEY (32 bytes in hex).");
  if (!process.env.REDIS_URL || !process.env.DATABASE_URL) throw new Error("Database and Redis configuration are required.");
  if (!/^[a-z0-9-]+$/.test(process.env.BACKUP_NAMESPACE || "local")) throw new Error("Invalid backup namespace.");
  const endpoint = process.env.BACKUP_S3_ENDPOINT || process.env.S3_ENDPOINT;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  return { bucket: process.env.BACKUP_BUCKET, prefix: `database/${process.env.BACKUP_NAMESPACE || "local"}/`,
    encryptionKey: Buffer.from(process.env.BACKUP_ENCRYPTION_KEY!, "hex"),
    client: new S3Client({ region: process.env.BACKUP_S3_REGION || process.env.S3_REGION || "us-east-1", endpoint,
      forcePathStyle: Boolean(endpoint), ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}) }) };
}
async function objectJson(name: string) {
  const c = config();
  const result = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: c.prefix + name }));
  return JSON.parse(await result.Body!.transformToString());
}
export async function listBackups() {
  const c = config(); let token: string | undefined; const rows: Backup[] = [];
  do {
    const page = await c.client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, ContinuationToken: token }));
    for (const item of page.Contents || []) {
      const name = item.Key!.slice(c.prefix.length);
      if (name.endsWith(".json") && validBackupId(name.slice(0,-5))) rows.push(await objectJson(name));
    }
    token = page.NextContinuationToken;
  } while (token);
  return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
async function prune() {
  const c = config(); let token: string | undefined;
  // Only this environment's timestamped backup files; includes abandoned partial uploads.
  do {
    const page = await c.client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, ContinuationToken: token }));
    for (const item of page.Contents || []) {
      const name = item.Key!.slice(c.prefix.length), id = name.replace(/\.(json|enc)$/, "");
      if (validBackupId(id) && Date.now() - Number(id.slice(0,13)) >= BACKUP_RETENTION_MS)
        await c.client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: item.Key }));
    }
    token = page.NextContinuationToken;
  } while (token);
}
// Credentials travel through environment variables, never command-line arguments or logs.
export async function pgTool(tool: "pg_dump" | "pg_restore", args: string[], output?: string, input?: string, databaseUrl = process.env.DATABASE_URL!) {
  const db = new URL(databaseUrl);
  const env = { ...process.env, PGHOST: db.hostname, PGPORT: db.port || "5432", PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: decodeURIComponent(db.pathname.slice(1)), PGSSLMODE: db.searchParams.get("sslmode") || "prefer", PGOPTIONS: "-c lock_timeout=60000" };
  const container = process.env.BACKUP_POSTGRES_CONTAINER;
  let command = process.env.BACKUP_PG_BIN ? join(process.env.BACKUP_PG_BIN, tool) : tool;
  let commandArgs = args;
  if (container) {
    env.PGHOST = "127.0.0.1"; env.PGPORT = "5432";
    command = "docker";
    commandArgs = ["exec", "-i", ...["PGHOST","PGPORT","PGUSER","PGPASSWORD","PGDATABASE","PGSSLMODE","PGOPTIONS"].flatMap(n => ["-e",n]), container, tool, ...args];
  }
  const child = spawn(command, commandArgs, { env, stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "pipe"], timeout: 30 * 60_000 });
  child.stderr!.resume();
  const finished = new Promise<void>((resolve,reject) => {
    child.on("error", () => reject(new Error(`${tool} could not start. Check PostgreSQL client configuration.`)));
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${tool} failed. Database permissions, client version, disk space or schema locks may need attention.`)));
  });
  try {
    await Promise.all([finished, ...(output ? [pipeline(child.stdout!,createWriteStream(output,{ mode:0o600 }))] : []), ...(input ? [pipeline(createReadStream(input),child.stdin!)] : [])]);
  } catch (e) { child.kill("SIGTERM"); throw e; }
}
async function schemaHash(dir: string) {
  const path = join(dir,"schema.sql");
  await pgTool("pg_dump",["--schema-only","--no-owner","--no-acl"],path);
  return createHash("sha256").update(normalizedSchema(await readFile(path,"utf8"))).digest("hex");
}
async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
async function snapshot(kind: string, day?: string): Promise<Backup> {
  const c = config(), dir = await mkdtemp(join(tmpdir(),"cms-backup-"));
  try {
    const id = `${Date.now()}-${randomUUID()}`, archive = join(dir,"database.dump"), encrypted = join(dir,"database.enc");
    const schema = await schemaHash(dir);
    await pgTool("pg_dump",["--format=custom","--no-owner","--no-acl"],archive);
    await pgTool("pg_restore",["--list"],undefined,archive);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm",c.encryptionKey,iv);
    await pipeline(createReadStream(archive),cipher,createWriteStream(encrypted,{mode:0o600}));
    const row: Backup = { id, createdAt:new Date().toISOString(), bytes:(await stat(encrypted)).size, kind, day, schema, sha256:await fileHash(archive), iv:iv.toString("hex"), tag:cipher.getAuthTag().toString("hex"), version:1 };
    await new Upload({client:c.client, params:{Bucket:c.bucket,Key:c.prefix+id+".enc",Body:createReadStream(encrypted),ContentType:"application/octet-stream"},leavePartsOnError:false}).done();
    await c.client.send(new PutObjectCommand({Bucket:c.bucket,Key:c.prefix+id+".json",Body:JSON.stringify(row),ContentType:"application/json"}));
    return row;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
export async function backupMaintenance() {
  return backupConfigured() ? Boolean(await store().get(key("maintenance"))) : false;
}
export async function withBackupActivity(work:()=>Promise<unknown>) {
  activeRequests++;
  try { if (!await backupMaintenance()) await work(); }
  finally { activeRequests--; }
}
export async function backupMaintenanceMiddleware(req: any,res: any,next: any) {
  if (!backupConfigured()) return next();
  const path = (req.originalUrl || req.path).split("?")[0];
  const backupPage = path === "/admin/cms" && (req.query?.resource === "backups" || String(req.body?.action || "").startsWith("backup_"));
  // Administrators must still be able to sign in and inspect/recover a failed restore.
  const adminLogin = path === "/auth/user/emailpass" || (path === "/admin/cms" && req.method === "GET" && req.query?.resource === "me");
  if (path === "/health" || backupPage || adminLogin) return next();
  try {
    if (await backupMaintenance()) return res.status(503).json({message:"Database restoration is in progress. Please try again shortly."});
  } catch { return res.status(503).json({message:"Database maintenance status is unavailable. Please try again shortly."}); }
  activeRequests++;
  let ended = false;
  const finish = () => { if (!ended) { ended = true; activeRequests--; } };
  res.once("finish",finish); res.once("close",finish);
  next();
}
const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
async function restore(op: Operation, scope: any) {
  if (process.env.WORKER_MODE && process.env.WORKER_MODE !== "shared") throw new Error("CMS restore requires a single backend in shared worker mode.");
  const cache = scope.resolve("cache");
  if (typeof cache.clear !== "function") throw new Error("This cache provider requires an operator-assisted restore.");
  const c = config(), id = op.backupId;
  if (!validBackupId(id)) throw new Error("Invalid backup selection.");
  const row: Backup = await objectJson(id+".json");
  if (row.id !== id || row.version !== 1 || expiredBackup(row.createdAt)) throw new Error("This backup is expired or unsupported.");
  const dir = await mkdtemp(join(tmpdir(),"cms-restore-"));
  try {
    const encrypted = join(dir,"database.enc"), archive = join(dir,"database.dump");
    const source = await c.client.send(new GetObjectCommand({Bucket:c.bucket,Key:c.prefix+id+".enc"}));
    await pipeline(source.Body as any,createWriteStream(encrypted,{mode:0o600}));
    const decipher = createDecipheriv("aes-256-gcm",c.encryptionKey,Buffer.from(row.iv,"hex"));
    decipher.setAuthTag(Buffer.from(row.tag,"hex"));
    await pipeline(createReadStream(encrypted),decipher,createWriteStream(archive,{mode:0o600}));
    if (await fileHash(archive) !== row.sha256) throw new Error("Backup integrity verification failed.");
    await pgTool("pg_restore",["--list"],undefined,archive);
    if (await schemaHash(dir) !== row.schema) throw new Error("Backup schema differs from the running application. Restore with the matching backend version.");
    await store().set(key("maintenance"),op.id);
    const deadline = Date.now()+120_000;
    while (activeRequests > 0 && Date.now() < deadline) await sleep(500);
    if (activeRequests > 0) throw new Error("Requests are still active. Try restoring when imports have finished.");
    op.safetyBackupId = (await snapshot("before-restore")).id;
    await saveOperation(op);
    await pgTool("pg_restore",["--dbname",decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1)),"--clean","--if-exists","--no-owner","--no-acl","--single-transaction","--exit-on-error"],undefined,archive);
    // The legacy cache module has no configured Redis provider in this deployment.
    await cache.clear();
  } finally { await rm(dir,{recursive:true,force:true}); }
}
async function saveOperation(op:Operation) { await store().set(key("operation"),JSON.stringify(op)); }
export async function backupStatus() {
  if (!backupConfigured()) return {configured:false,rows:[],timezone:BACKUP_TIMEZONE,retentionDays:14};
  config();
  const value = await store().get(key("operation"));
  return {configured:true,rows:(await listBackups()).filter(row=>!expiredBackup(row.createdAt)).map(({id,createdAt,bytes,kind})=>({id,createdAt,bytes,kind})),operation:value?JSON.parse(value):null,maintenance:await backupMaintenance(),timezone:BACKUP_TIMEZONE,retentionDays:14};
}
export async function queueBackup(action:"backup"|"restore", backupId?:string) {
  config();
  const op: Operation = {id:randomUUID(),action,status:"queued",startedAt:new Date().toISOString(),backupId};
  if (!await store().set(key("runner"),op.id,"EX",60,"NX")) throw new Error("The backup worker is busy. Please try again shortly.");
  try {
    if (await backupMaintenance()) throw new Error("Maintenance is active. Inspect the previous restore before resuming service.");
    if (!await store().set(key("lock"),op.id,"EX",3600,"NX")) throw new Error("A backup or restore is already in progress.");
    try { await saveOperation(op); await store().set(key("pending"),JSON.stringify(op)); }
    catch (error) { await store().del(key("lock")); throw error; }
    return op;
  } finally { await store().eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end",1,key("runner"),op.id); }
}
export async function runBackupJobs(scope:any) {
  if (!backupConfigured()) return;
  config();
  // The runner lock prevents both cron overlap and accidental duplicate workers.
  const token=randomUUID();
  if (!await store().set(key("runner"),token,"EX",3600,"NX")) return;
  let op:Operation|undefined;
  let ownsOperation=false;
  const heartbeat=setInterval(()=>{
    void store().eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],3600) end",1,key("runner"),token).catch(()=>{});
    if(ownsOperation && op) void store().eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],3600) end",1,key("lock"),op.id).catch(()=>{});
  },30000);
  try {
    const pending = await store().getdel(key("pending"));
    if (pending) { op=JSON.parse(pending); ownsOperation=true; }
    else {
      const previous=await store().get(key("operation"));
      if (previous && ["running","queued"].includes(JSON.parse(previous).status)) {
        const interrupted=JSON.parse(previous);
        interrupted.status="failed"; interrupted.message="Operation was interrupted. Inspect the database before resuming maintenance.";
        await saveOperation(interrupted); await store().del(key("lock"));
      }
      if (await backupMaintenance()) return;
      await prune();
      const day=backupDay();
      if ((await listBackups()).some(row=>row.kind==="scheduled" && row.day===day)) return;
      op={id:token,action:"backup",status:"queued",startedAt:new Date().toISOString()};
      if (!await store().set(key("lock"),op.id,"EX",3600,"NX")) return;
      ownsOperation=true;
    }
    op!.status="running"; await saveOperation(op!);
    if (op!.action==="restore") await restore(op!,scope);
    else op!.backupId=(await snapshot(pending?"manual":"scheduled",pending?undefined:backupDay())).id;
    op!.status="completed";
    if (op!.action==="restore") await store().del(key("maintenance"));
    try { await prune(); } catch { op!.message="Operation completed, but retention cleanup failed. Check S3 deletion permissions."; }
  } catch(error) {
    if(op) { op.status="failed"; op.message=error instanceof Error?error.message:"Backup operation failed."; }
    else scope.resolve("logger").error("Database backup scheduler failed. Check backup configuration and storage connectivity.");
  } finally {
    clearInterval(heartbeat);
    if(op && ownsOperation) { op.finishedAt=new Date().toISOString(); await saveOperation(op); await store().eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end",1,key("lock"),op.id); }
    await store().eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end",1,key("runner"),token);
  }
}
export async function resumeAfterFailedRestore() {
  config();
  if (await store().exists(key("runner"))) throw new Error("An operation is still running.");
  await store().del(key("maintenance"));
}
