import { BRAND, emailButton, emailImage, emailShell, escapeHtml, siteUrl } from "./email-layout"

type Item = { title: string; quantity: number; unit_price: number; thumbnail?: string | null }
export type Delivery = { name: string; phone?: string; address: string; address2?: string; comuna: string; region?: string; branch?: string; shipping?: "starken" }
export type TaxDocument = { type: "boleta" | "factura"; rut: string; company?: { rut: string; name: string; activity: string; address: string; comuna: string } }
type OrderEmail = { id?: string; customer_email?: string; delivery?: Delivery; document?: TaxDocument; display_id: number; email: string; items: Item[]; total: number; subtotal?: number; created_at?: string | Date; payment_status: "paid" | "not_paid"; customer_name?: string; notes?: string; currency_code?: string }

const clp = (value: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value)

export const orderLink = (order: Pick<OrderEmail, "id">) => `${siteUrl()}/mi-cuenta?tab=orders${order.id ? `&order=${encodeURIComponent(order.id)}` : ""}`

const line = (text: string | undefined) => (text ? `<div>${escapeHtml(text)}</div>` : "")
function detailCards(locale: "es" | "en", delivery?: Delivery, document?: TaxDocument) {
  if (!delivery && !document) return ""
  const es = locale !== "en"
  const t = es
    ? { delivery: "Entrega", shipping: "Starken · envío por pagar", branch: "Sucursal Starken", doc: "Documento", boleta: "Boleta", factura: "Factura", rut: "RUT", company: "Empresa", activity: "Giro", payNote: "Pagas el envío al recibir." }
    : { delivery: "Delivery", shipping: "Starken · pay on delivery", branch: "Starken branch", doc: "Document", boleta: "Receipt (boleta)", factura: "Invoice (factura)", rut: "RUT", company: "Company", activity: "Activity", payNote: "You pay the shipping when you receive it." }
  const card = (title: string, inner: string) => `<td width="50%" valign="top" style="padding:0 6px"><div style="background:${BRAND.band};border:1px solid ${BRAND.border};border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.55;color:${BRAND.muted}"><div style="margin-bottom:6px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.accent}">${title}</div>${inner}</div></td>`
  const a = delivery ? card(t.delivery, `<div style="color:${BRAND.text};font-weight:700">${escapeHtml(delivery.name)}</div>${line([delivery.address, delivery.address2].filter(Boolean).join(", "))}${line([delivery.comuna, delivery.region].filter(Boolean).join(", "))}${line(delivery.phone)}<div style="margin-top:8px;color:${BRAND.text}">🚚 ${t.shipping}</div>${delivery.branch ? line(`${t.branch}: ${delivery.branch}`) : ""}<div style="font-size:12px">${t.payNote}</div>`) : ""
  const b = document ? card(t.doc, `<div style="color:${BRAND.text};font-weight:700">${document.type === "factura" ? t.factura : t.boleta}</div>${line(`${t.rut}: ${document.rut}`)}${document.company ? `${line(`${t.company}: ${document.company.name}`)}${line(`${t.activity}: ${document.company.activity}`)}${line([document.company.address, document.company.comuna].filter(Boolean).join(", "))}` : ""}`) : ""
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px -6px 0;width:calc(100% + 12px)"><tr>${a}${b}</tr></table>`
}

export function orderSummaryEmail(locale: "es" | "en", order: OrderEmail) {
  const es = locale !== "en"
  const t = es
    ? { subject: `Resumen de tu pedido #${order.display_id} — Banned Cards`, eyebrow: "Pedido recibido", heading: order.customer_name ? `¡Gracias por tu compra, ${order.customer_name}!` : "¡Gracias por tu compra!", hi: order.customer_name ? `Hola ${order.customer_name},` : "Hola,", intro: "Recibimos tu pedido. Este es el resumen:", order: "Pedido", product: "Productos", qty: "Cant.", subtotal: "Subtotal", total: "Total", paid: "Pagado", unpaid: "Pago pendiente", status: "Estado del pago", notes: "Tus notas", test: "Este pedido se creó en modo de prueba: no se realizó ningún cobro.", cta: "Ver mi pedido", ctaHint: "También puedes encontrarlo en Mi cuenta → Pedidos.", next: "¿Qué sigue?", steps: ["Revisamos tu pedido", "Preparamos tus productos", "Despacho con Starken"], stepText: ["Confirmamos stock y datos.", "Los dejamos listos para enviar.", "A todo Chile, con seguimiento."], bye: "Gracias por comprar en Banned Cards.", each: "c/u", date: "Fecha" }
    : { subject: `Your order #${order.display_id} summary — Banned Cards`, eyebrow: "Order received", heading: order.customer_name ? `Thank you for your order, ${order.customer_name}!` : "Thank you for your order!", hi: order.customer_name ? `Hi ${order.customer_name},` : "Hi,", intro: "We received your order. Here is the summary:", order: "Order", product: "Items", qty: "Qty", subtotal: "Subtotal", total: "Total", paid: "Paid", unpaid: "Payment pending", status: "Payment status", notes: "Your notes", test: "This order was created in test mode: no payment was taken.", cta: "View my order", ctaHint: "You can also find it under My account → Orders.", next: "What happens next?", steps: ["We review your order", "We prepare your items", "Shipped with Starken"], stepText: ["We confirm stock and details.", "Packed and ready to go.", "All of Chile, with tracking."], bye: "Thank you for shopping at Banned Cards.", each: "each", date: "Date" }
  const paid = order.payment_status === "paid"
  const status = paid ? t.paid : t.unpaid
  const link = orderLink(order)
  const when = order.created_at ? new Date(order.created_at) : null
  const dateText = when && !Number.isNaN(when.getTime()) ? new Intl.DateTimeFormat(es ? "es-CL" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(when) : ""
  const subtotal = order.subtotal ?? order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)

  const rows = order.items.map(item => {
    const src = emailImage(item.thumbnail)
    const picture = src
      ? `<img src="${escapeHtml(src)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:contain;border-radius:10px;background:${BRAND.page};border:1px solid ${BRAND.border}">`
      : `<div style="width:64px;height:64px;line-height:64px;text-align:center;font-size:26px;border-radius:10px;background:${BRAND.page};border:1px solid ${BRAND.border}">📦</div>`
    return `<tr><td style="padding:14px 0;border-bottom:1px solid ${BRAND.border}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
      + `<td width="64" valign="top" style="width:64px">${picture}</td>`
      + `<td valign="top" style="padding:0 12px"><div style="font-size:15px;font-weight:700;line-height:1.35;color:${BRAND.text}">${escapeHtml(item.title)}</div><div style="margin-top:4px;font-size:13px;color:${BRAND.muted}">${item.quantity} × ${clp(item.unit_price)}</div></td>`
      + `<td valign="top" align="right" style="white-space:nowrap;font-size:15px;font-weight:700;color:${BRAND.text}">${clp(item.unit_price * item.quantity)}</td>`
      + `</tr></table></td></tr>`
  }).join("")

  const pill = `<span style="display:inline-block;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;color:#ffffff;background:${paid ? BRAND.good : BRAND.bad}">${paid ? "✓" : "●"} ${t.status}: ${status}</span>`
  const stepCells = t.steps.map((step, index) => `<td width="33%" valign="top" style="padding:0 6px"><div style="width:30px;height:30px;line-height:30px;text-align:center;border-radius:50%;background:${BRAND.primary};color:#fff;font-weight:800;font-size:14px">${index + 1}</div><div style="margin-top:8px;font-size:13px;font-weight:700;color:${BRAND.text}">${escapeHtml(step)}</div><div style="margin-top:2px;font-size:12px;line-height:1.4;color:${BRAND.muted}">${escapeHtml(t.stepText[index])}</div></td>`).join("")

  const body = `<p style="margin:0 0 18px;color:${BRAND.muted}">${escapeHtml(t.intro)}</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.band};border:1px solid ${BRAND.border};border-radius:14px"><tr><td style="padding:16px 18px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.muted}">${t.order}</div><div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:${BRAND.text}">#${order.display_id}</div></td>`
    + `<td align="right" valign="middle">${pill}${dateText ? `<div style="margin-top:8px;font-size:12px;color:${BRAND.muted}">${t.date}: ${escapeHtml(dateText)}</div>` : ""}</td></tr></table></td></tr></table>`
    + `<p style="margin:26px 0 4px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.accent}">${t.product}</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BRAND.border}">${rows}</table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="padding:3px 0;font-size:14px;color:${BRAND.muted}">${t.subtotal}</td><td align="right" style="padding:3px 0;font-size:14px;color:${BRAND.muted}">${clp(subtotal)}</td></tr>`
    + `<tr><td style="padding:8px 0 0;font-size:17px;font-weight:700">${t.total}</td><td align="right" style="padding:8px 0 0;font-size:24px;font-weight:800;color:${BRAND.accent}">${clp(order.total)}</td></tr></table>`
    + detailCards(locale, order.delivery, order.document)
    + `<div align="center">${emailButton(link, `${t.cta} →`)}<p style="margin:6px 0 0;font-size:12px;color:${BRAND.muted}">${t.ctaHint}</p></div>`
    + (order.notes ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td style="border-left:3px solid ${BRAND.primary};padding:4px 0 4px 14px;font-size:13px;color:${BRAND.muted}"><strong style="color:${BRAND.text}">${t.notes}:</strong> ${escapeHtml(order.notes)}</td></tr></table>` : "")
    + `<p style="margin:30px 0 12px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.accent}">${t.next}</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stepCells}</tr></table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr><td style="font-size:13px;line-height:1.5;color:#FCD9A0;background:#2A2113;border:1px solid #5B4216;border-radius:10px;padding:10px 14px">${t.test}</td></tr></table>`
    + `<p style="margin:24px 0 20px;font-size:14px;color:${BRAND.muted}">${t.bye}</p>`

  const html = emailShell({ lang: locale, title: t.subject, preheader: `${t.order} #${order.display_id} · ${t.total} ${clp(order.total)} · ${status}`, eyebrow: t.eyebrow, heading: t.heading, body })
  const text = [t.hi, "", t.intro, `${t.order} #${order.display_id}`, `${t.status}: ${status}`, "", ...order.items.map(item => `${item.quantity} × ${item.title} — ${clp(item.unit_price * item.quantity)}`), "", `${t.total}: ${clp(order.total)}`, ...(order.delivery ? ["", `${es ? "Entrega" : "Delivery"}: ${order.delivery.name}, ${[order.delivery.address, order.delivery.address2, order.delivery.comuna, order.delivery.region].filter(Boolean).join(", ")}`] : []), ...(order.document ? [`${order.document.type === "factura" ? (es ? "Factura" : "Invoice") : (es ? "Boleta" : "Receipt")} · RUT ${order.document.rut}`] : []), "", `${t.cta}: ${link}`, "", t.test, t.bye].join("\n")
  return { subject: t.subject, html, text }
}

/** Email for the store: everything needed to pack, ship and issue the boleta or factura. */
export function storeOrderEmail(order: OrderEmail) {
  const d = order.delivery, doc = order.document
  const subject = `Nuevo pedido #${order.display_id} — ${order.customer_name || order.customer_email || ""} — ${clp(order.total)}`
  const row = (label: string, value?: string) => value ? `<tr><td style="padding:4px 12px 4px 0;color:${BRAND.muted};white-space:nowrap" valign="top">${label}</td><td style="padding:4px 0;color:${BRAND.text}">${escapeHtml(value)}</td></tr>` : ""
  const items = order.items.map(item => `<tr><td style="padding:6px 0;border-bottom:1px solid ${BRAND.border}">${escapeHtml(item.title)}</td><td align="center" style="padding:6px 8px;border-bottom:1px solid ${BRAND.border}">${item.quantity}</td><td align="right" style="padding:6px 0;border-bottom:1px solid ${BRAND.border}">${clp(item.unit_price * item.quantity)}</td></tr>`).join("")
  const body = `<p style="margin:0 0 14px;color:${BRAND.muted}">Pago: <strong style="color:${order.payment_status === "paid" ? BRAND.good : BRAND.bad}">${order.payment_status === "paid" ? "Pagado" : "Pendiente"}</strong></p>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:16px">${row("Cliente", order.customer_name)}${row("Correo", order.customer_email)}${row("Teléfono", d?.phone)}${row("Documento", doc ? (doc.type === "factura" ? "Factura" : "Boleta") : "")}${row("RUT", doc?.rut)}${row("Empresa", doc?.company?.name)}${row("Giro", doc?.company?.activity)}${row("Dirección fiscal", doc?.company ? [doc.company.address, doc.company.comuna].filter(Boolean).join(", ") : "")}${row("Envío", d ? "Starken · por pagar" : "")}${row("Dirección", d ? [d.address, d.address2].filter(Boolean).join(", ") : "")}${row("Comuna", d?.comuna)}${row("Región", d?.region)}${row("Sucursal", d?.branch)}${row("Notas", order.notes)}</table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:${BRAND.text}"><tr><th align="left" style="padding-bottom:6px;color:${BRAND.muted};font-weight:600">Producto</th><th style="padding-bottom:6px;color:${BRAND.muted};font-weight:600">Cant.</th><th align="right" style="padding-bottom:6px;color:${BRAND.muted};font-weight:600">Total</th></tr>${items}</table>`
    + `<p style="margin:14px 0 22px;text-align:right;font-size:20px;font-weight:800;color:${BRAND.accent}">${clp(order.total)}</p>`
  const html = emailShell({ lang: "es", title: subject, preheader: `${order.customer_name || ""} · ${clp(order.total)}`, eyebrow: "Nuevo pedido", heading: `Pedido #${order.display_id}`, body })
  const text = [`Nuevo pedido #${order.display_id}`, order.customer_name, order.customer_email, d ? `${d.name} · ${d.phone ?? ""}` : "", d ? [d.address, d.address2, d.comuna, d.region].filter(Boolean).join(", ") : "", doc ? `${doc.type === "factura" ? "Factura" : "Boleta"} RUT ${doc.rut}${doc.company ? ` · ${doc.company.name} (${doc.company.activity}) ${doc.company.address}, ${doc.company.comuna}` : ""}` : "", "", ...order.items.map(item => `${item.quantity} × ${item.title} — ${clp(item.unit_price * item.quantity)}`), "", `Total: ${clp(order.total)}`, order.notes ? `Notas: ${order.notes}` : ""].filter(line => line !== undefined).join("\n")
  return { subject, html, text }
}
