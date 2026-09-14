import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

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
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:3000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:3000,http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET
    },
    workerMode: (process.env.WORKER_MODE as "shared" | "server" | "worker") || "shared"
  },
  modules: [{ resolve: "./src/modules/tcg-catalog" }, ...fileModule]
})
