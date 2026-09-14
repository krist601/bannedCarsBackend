import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"

const envPath = resolve(process.cwd(), ".env")
if (!existsSync(envPath)) {
  throw new Error("Create .env from .env.template before configuring local image storage.")
}

const current = readFileSync(envPath, "utf8")
const values = new Map(current.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
  return match ? [[match[1], match[2]]] : []
}))
if (values.has("FILE_STORAGE_DRIVER") && values.get("FILE_STORAGE_DRIVER") !== "s3") {
  throw new Error("FILE_STORAGE_DRIVER is already configured with a different provider.")
}

const accessKey = values.get("MINIO_ROOT_USER") || "banned-cards-local"
const secretKey = values.get("MINIO_ROOT_PASSWORD") || randomBytes(32).toString("base64url")
const defaults = {
  FILE_STORAGE_DRIVER: "s3",
  MINIO_ROOT_USER: accessKey,
  MINIO_ROOT_PASSWORD: secretKey,
  S3_FILE_URL: "http://localhost:9002/banned-cards",
  S3_ACCESS_KEY_ID: accessKey,
  S3_SECRET_ACCESS_KEY: secretKey,
  S3_REGION: "us-east-1",
  S3_BUCKET: "banned-cards",
  S3_ENDPOINT: "http://localhost:9002",
  S3_FORCE_PATH_STYLE: "true",
  S3_PREFIX: "catalog",
  SCRYFALL_USER_AGENT: "BannedCards/0.1 (card-image-sync)"
}

const missing = Object.entries(defaults).filter(([key]) => !values.has(key))
if (missing.length) {
  const separator = current.endsWith("\n") ? "" : "\n"
  appendFileSync(envPath, `${separator}\n# Local card-image object storage (generated; do not commit)\n${missing.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 })
  console.log("Configured local MinIO image storage in the ignored .env file.")
} else {
  console.log("Local MinIO image storage is already configured.")
}
