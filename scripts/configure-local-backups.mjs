import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { S3Client, CreateBucketCommand, HeadBucketCommand, GetBucketPolicyCommand } from "@aws-sdk/client-s3";
const file=new URL("../.env",import.meta.url);
const current=readFileSync(file,"utf8");
const env=Object.fromEntries(current.split(/\r?\n/).flatMap(line=>{const m=line.match(/^([A-Z0-9_]+)=(.*)$/);return m?[[m[1],m[2].replace(/^(['"])(.*)\1$/,"$2")]]:[]}));
const endpoint=env.S3_ENDPOINT;
if(!endpoint || !["localhost","127.0.0.1"].includes(new URL(endpoint).hostname)) throw Error("This setup script only configures local MinIO.");
const bucket=env.BACKUP_BUCKET || "banned-cards-database-backups";
if(bucket===env.S3_BUCKET) throw Error("Backups must not use the public image bucket.");
const client=new S3Client({endpoint,region:env.S3_REGION||"us-east-1",forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}});
try {await client.send(new HeadBucketCommand({Bucket:bucket}));}catch(e){if(e.$metadata?.httpStatusCode!==404)throw e;await client.send(new CreateBucketCommand({Bucket:bucket}));}
try { const policy=await client.send(new GetBucketPolicyCommand({Bucket:bucket})); if(policy.Policy)throw Error("The backup bucket already has a policy. Check that it is private before configuring backups."); }
catch(e){if(e.name!=="NoSuchBucketPolicy")throw e;}
const defaults={BACKUPS_ENABLED:"true",BACKUP_BUCKET:bucket,BACKUP_NAMESPACE:"local",BACKUP_ENCRYPTION_KEY:randomBytes(32).toString("hex"),BACKUP_POSTGRES_CONTAINER:"banned-cards-server-postgres-1"};
const missing=Object.entries(defaults).filter(([name])=>!(name in env));
if(missing.length)appendFileSync(file,`\n# Private database backups; preserve encryption key separately\n${missing.map(([name,value])=>`${name}=${value}`).join("\n")}\n`,{mode:0o600});
console.log("Local private backup storage configured. Encryption key is retained in the ignored backend .env.");
