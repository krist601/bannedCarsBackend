import { existsSync, rmSync, symlinkSync } from "node:fs"
import { resolve } from "node:path"

const target = resolve(".medusa/server/public")
const link = resolve("public")

if (!existsSync(target)) {
  throw new Error(`Medusa admin build was not found at ${target}`)
}

rmSync(link, { force: true, recursive: true })
symlinkSync(target, link, "dir")
