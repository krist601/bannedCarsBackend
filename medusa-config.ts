import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// HTTP-only loopback development must opt in; deployed stores retain secure defaults.
const localSession = process.env.LOCAL_HTTP_SESSION === "true"
if (localSession) {
  const origins = [process.env.STORE_CORS || "http://localhost:3000", process.env.AUTH_CORS || "http://localhost:3000,http://localhost:9000"].flatMap(value => value.split(","))
  if (!origins.every(origin => { try { const url = new URL(origin.trim()); return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) } catch { return false } })) throw new Error("LOCAL_HTTP_SESSION is only allowed with HTTP loopback CORS origins")
}
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL)
const authModule = googleEnabled ? [{
  resolve: "@medusajs/medusa/auth",
  dependencies: ["cache", "logger"],
  options: { providers: [
    { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
    { resolve: "@medusajs/medusa/auth-google", id: "google", options: {
      clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackUrl: process.env.GOOGLE_CALLBACK_URL
    } }
  ] }
}] : []

// Transactional email (account verification, order summaries): EMAIL_DRIVER=ses (Amazon SES) or RESEND_API_KEY (Resend). With neither, messages are only logged.
const notificationModule = {
  resolve: "@medusajs/medusa/notification",
  options: { providers: [{ resolve: "./src/modules/email-notification", id: "email", options: { channels: ["email"], driver: process.env.EMAIL_DRIVER, apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, region: process.env.SES_REGION, accessKeyId: process.env.SES_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.SES_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY } }] }
}

const fileModule = process.env.FILE_STORAGE_DRIVER === "s3" ? [{
  resolve: "@medusajs/medusa/file",
  options: {
    providers: [{
      resolve: "@medusajs/medusa/file-s3",
      id: "s3",
      options: {
        file_url: process.env.S3_FILE_URL,
        access_key_id: process.env.S3_ACCESS_KEY_ID,
        secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
        region: process.env.S3_REGION,
        bucket: process.env.S3_BUCKET,
        // BucketOwnerEnforced buckets reject every per-object ACL header.
        acl: false,
        endpoint: process.env.S3_ENDPOINT,
        prefix: process.env.S3_PREFIX || "catalog",
        cache_control: "public, max-age=31536000, immutable",
        additional_client_config: {
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
        }
      }
    }]
  }
}] : []

export default defineConfig({
  projectConfig: {
    // Google is for customers only; staff authentication remains email/password.
    ...(localSession ? { cookieOptions: { secure: false, sameSite: "lax" as const, httpOnly: true } } : {}),
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      connection: {
        ssl: process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : false
      }
    },
    redisUrl: process.env.REDIS_URL,
    http: {
      authMethodsPerActor: { user: ["emailpass"], customer: googleEnabled ? ["emailpass", "google"] : ["emailpass"] },
      storeCors: process.env.STORE_CORS || "http://localhost:3000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:3000,http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET
    },
    workerMode: (process.env.WORKER_MODE as "shared" | "server" | "worker") || "shared"
  },
  modules: [{ resolve: "./src/modules/tcg-catalog" }, ...fileModule, ...authModule, notificationModule]
})
