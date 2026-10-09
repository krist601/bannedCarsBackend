/** Brand look shared by every store email. Colours match the storefront's dark theme. */
export const BRAND = {
  page: "#0F1115", card: "#181B22", band: "#12141A", border: "#2A2E38", text: "#F5F5F5", muted: "#9CA3AF",
  primary: "#7C3AED", primaryDark: "#4C1D95", accent: "#F59E0B", onAccent: "#17120A", link: "#B99AFB",
  good: "#2e9e6b", bad: "#d64545",
}
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "info@bannedcards.cl"
const INSTAGRAM_URL = process.env.INSTAGRAM_URL || "https://www.instagram.com/bannedcards.cl/"

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

export const siteUrl = () => (process.env.STOREFRONT_URL || (process.env.STORE_CORS || "http://localhost:3000").split(",")[0]).trim().replace(/\/$/, "")

/** Public address of this backend, used for the picture proxy (api.<store domain> in production). */
export function apiUrl() {
  if (process.env.API_PUBLIC_URL) return process.env.API_PUBLIC_URL.replace(/\/$/, "")
  try {
    const url = new URL(siteUrl())
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "http://localhost:9000"
    return `${url.protocol}//api.${url.hostname.replace(/^www\./, "")}`
  } catch { return "http://localhost:9000" }
}

/**
 * Picture address an email client can load: Scryfall cards use the small size, store pictures go through
 * the backend picture route (the bucket only answers requests coming from the store's own pages), and
 * storefront paths become absolute.
 */
export function emailImage(url?: string | null): string | null {
  if (!url) return null
  if (/^https:\/\/cards\.scryfall\.io\/normal\//.test(url)) return url.replace("/normal/", "/small/")
  const files = (process.env.S3_FILE_URL || "").replace(/\/$/, "")
  if (files && url.startsWith(`${files}/`)) return `${apiUrl()}/email-assets/image?u=${encodeURIComponent(url)}`
  if (url.startsWith("/") && !url.startsWith("//")) return `${siteUrl()}${url}`
  return /^https:\/\//.test(url) ? url : null
}

type Shell = { lang: "es" | "en"; title: string; preheader: string; eyebrow: string; heading: string; subheading?: string; body: string }

/** Full HTML document: violet header with the logo, dark card, footer with contact and legal text. Tables and inline styles only, so it renders in every mail app. */
export function emailShell({ lang, title, preheader, eyebrow, heading, subheading, body }: Shell) {
  const es = lang !== "en"
  const site = siteUrl()
  const logo = `${site}/_next/image?url=%2Fbrand%2Flogo-horizontal-white.png&w=384&q=75`
  const f = es
    ? { help: "¿Necesitas ayuda?", write: "Escríbenos a", pay: "Medios de pago", ship: "Despacho", all: "Todo Chile", visit: "Visitar la tienda", legal: "Magic: The Gathering es una marca de Wizards of the Coast LLC. Banned Cards no está afiliada ni respaldada por Wizards of the Coast." }
    : { help: "Need help?", write: "Write to us at", pay: "Payment", ship: "Shipping", all: "All of Chile", visit: "Visit the store", legal: "Magic: The Gathering is a trademark of Wizards of the Coast LLC. Banned Cards is not affiliated with or endorsed by Wizards of the Coast." }
  const font = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const serif = "Georgia,'Times New Roman',serif"
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>${escapeHtml(title)}</title></head>`
    + `<body style="margin:0;padding:0;background:${BRAND.page};font-family:${font};color:${BRAND.text}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.page}">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page}"><tr><td align="center" style="padding:28px 12px">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:18px;overflow:hidden">`
    // header band
    + `<tr><td style="background:${BRAND.primary};background-image:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);padding:28px 32px 26px">`
    + `<a href="${site}" style="text-decoration:none"><img src="${logo}" width="170" alt="Banned Cards" style="display:block;border:0;outline:none;width:170px;height:auto;color:#fff;font-size:20px;font-weight:bold"></a>`
    + `<p style="margin:20px 0 6px;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${BRAND.accent}">${escapeHtml(eyebrow)}</p>`
    + `<h1 style="margin:0;font-family:${serif};font-weight:400;font-size:30px;line-height:1.15;color:#ffffff">${escapeHtml(heading)}</h1>`
    + (subheading ? `<p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#E5DEFF">${escapeHtml(subheading)}</p>` : "")
    + `</td></tr>`
    // body
    + `<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.6;color:${BRAND.text}">${body}</td></tr>`
    // footer
    + `<tr><td style="background:${BRAND.band};border-top:1px solid ${BRAND.border};padding:24px 32px;font-size:13px;line-height:1.6;color:${BRAND.muted}">`
    + `<p style="margin:0 0 4px;color:${BRAND.text};font-weight:700">${f.help}</p>`
    + `<p style="margin:0 0 14px">${f.write} <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.link};text-decoration:none">${SUPPORT_EMAIL}</a> · <a href="${INSTAGRAM_URL}" style="color:${BRAND.link};text-decoration:none">Instagram</a> · <a href="${site}" style="color:${BRAND.link};text-decoration:none">${f.visit}</a></p>`
    + `<p style="margin:0 0 14px">${f.pay}: <strong style="color:${BRAND.text}">Webpay (Transbank)</strong> &nbsp;·&nbsp; ${f.ship}: <strong style="color:${BRAND.text}">Starken</strong> — ${f.all}</p>`
    + `<p style="margin:0;font-size:11px;line-height:1.5;color:#6B7280">${f.legal}</p>`
    + `</td></tr></table>`
    + `<p style="margin:16px 0 0;font-size:11px;color:#6B7280">© ${new Date().getFullYear()} Banned Cards</p>`
    + `</td></tr></table></body></html>`
}

/** Amber call-to-action button (the storefront's primary button), bulletproof for Outlook. */
export function emailButton(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px"><tr><td align="center" bgcolor="${BRAND.accent}" style="border-radius:12px;background:${BRAND.accent}">`
    + `<a href="${href}" style="display:inline-block;padding:14px 30px;border-radius:12px;font-size:16px;font-weight:800;color:${BRAND.onAccent};text-decoration:none;background:${BRAND.accent}">${escapeHtml(label)}</a></td></tr></table>`
}
