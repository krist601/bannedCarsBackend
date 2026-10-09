import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { siteUrl } from "../../../lib/email-layout"

const MAX_BYTES = 3 * 1024 * 1024
// Only store pictures that are already shown on the public site.
const ALLOWED_FOLDERS = ["/catalogproducts/", "/catalogsealed/"]

/**
 * GET /email-assets/image?u=<store picture URL>
 * Mail apps cannot load the media bucket directly (it only answers requests coming from the store's own pages),
 * so order emails point here. The route fetches the picture with the store as referer and caches it for a week.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const base = (process.env.S3_FILE_URL || "").replace(/\/$/, "")
  const raw = String(req.query.u ?? "")
  let target: URL
  try { target = new URL(raw) } catch { return void res.status(400).json({ message: "Invalid picture address." }) }
  if (!base || !raw.startsWith(`${base}/`) || target.search || target.hash || target.username || target.password || !ALLOWED_FOLDERS.some(folder => target.pathname.startsWith(folder)))
    return void res.status(400).json({ message: "Picture not allowed." })
  try {
    const upstream = await fetch(target, { headers: { Referer: `${siteUrl()}/` }, redirect: "error", signal: AbortSignal.timeout(10_000) })
    const type = upstream.headers.get("content-type") ?? ""
    if (!upstream.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return void res.status(404).json({ message: "Picture not found." })
    const bytes = Buffer.from(await upstream.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_BYTES) return void res.status(404).json({ message: "Picture not available." })
    res.setHeader("Content-Type", type)
    res.setHeader("Cache-Control", "public, max-age=604800, immutable")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.status(200).send(bytes)
  } catch {
    res.status(502).json({ message: "Picture unavailable." })
  }
}
