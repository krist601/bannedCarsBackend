/**
 * Webpay Plus (Transbank) REST client. Two environments:
 *  - integration (default): public test commerce code and key, https://webpay3gint.transbank.cl, no real charges.
 *  - production: needs WEBPAY_COMMERCE_CODE and WEBPAY_API_SECRET from Transbank, https://webpay3g.transbank.cl.
 * Docs: https://www.transbankdevelopers.cl/referencia/webpay
 */
export type WebpayEnvironment = "integration" | "production"
export type WebpayConfig = { environment: WebpayEnvironment; host: string; commerceCode: string; apiSecret: string }

// Public integration credentials published by Transbank for everyone's tests.
const INTEGRATION_CODE = "597055555532"
const INTEGRATION_SECRET = "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
const API_PATH = "/rswebpaytransaction/api/webpay/v1.2/transactions"

export class WebpayError extends Error {
  constructor(message: string, readonly httpStatus?: number) { super(message) }
}

export function webpayConfig(env: Record<string, string | undefined> = process.env): WebpayConfig {
  const production = env.WEBPAY_ENV === "production"
  if (!production) return { environment: "integration", host: "https://webpay3gint.transbank.cl", commerceCode: INTEGRATION_CODE, apiSecret: INTEGRATION_SECRET }
  const commerceCode = (env.WEBPAY_COMMERCE_CODE ?? "").trim(), apiSecret = (env.WEBPAY_API_SECRET ?? "").trim()
  if (!commerceCode || !apiSecret) throw new WebpayError("Webpay production needs WEBPAY_COMMERCE_CODE and WEBPAY_API_SECRET.")
  return { environment: "production", host: "https://webpay3g.transbank.cl", commerceCode, apiSecret }
}

export type WebpayCreated = { token: string; url: string }
export type WebpayResult = {
  vci?: string; amount?: number; status?: string; buy_order?: string; session_id?: string; response_code?: number
  authorization_code?: string; payment_type_code?: string; installments_number?: number; transaction_date?: string; accounting_date?: string
  card_detail?: { card_number?: string }
}

/** A payment is approved only when Transbank says AUTHORIZED with response code 0. */
export const isApproved = (result: WebpayResult) => result.status === "AUTHORIZED" && result.response_code === 0

/** Unique per payment attempt, at most 26 characters (Transbank's limit). */
export const buyOrderOf = (displayId: number) => `BC${displayId}`

export class WebpayClient {
  constructor(readonly config: WebpayConfig, private readonly fetcher: typeof fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(`${this.config.host}${API_PATH}${path}`, {
        method, signal: AbortSignal.timeout(20_000),
        headers: { "Tbk-Api-Key-Id": this.config.commerceCode, "Tbk-Api-Key-Secret": this.config.apiSecret, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new WebpayError("Webpay is not reachable right now.") }
    const text = await response.text()
    let data: any = {}
    try { data = text ? JSON.parse(text) : {} } catch { /* not JSON */ }
    if (!response.ok) throw new WebpayError(String(data.error_message ?? `Webpay answered HTTP ${response.status}.`), response.status)
    return data as T
  }

  async create(input: { buyOrder: string; sessionId: string; amount: number; returnUrl: string }) {
    if (!Number.isInteger(input.amount) || input.amount < 1) throw new WebpayError("The amount must be a whole number of pesos.")
    return this.call<WebpayCreated>("POST", "", { buy_order: input.buyOrder, session_id: input.sessionId, amount: input.amount, return_url: input.returnUrl })
  }
  /** Confirms a payment the shopper finished at Webpay. Transbank allows this once per token. */
  commit(token: string) { return this.call<WebpayResult>("PUT", `/${encodeURIComponent(token)}`) }
  status(token: string) { return this.call<WebpayResult>("GET", `/${encodeURIComponent(token)}`) }
}

/** Transbank sends the shopper back with token_ws (finished) or TBK_* values (cancelled or timed out at the Webpay form). */
export type WebpayReturn =
  | { kind: "finished"; token: string }
  | { kind: "aborted"; token: string; buyOrder: string; sessionId: string }
  | { kind: "invalid" }
export function parseWebpayReturn(params: Record<string, string | undefined>): WebpayReturn {
  const finished = (params.token_ws ?? "").trim(), aborted = (params.TBK_TOKEN ?? "").trim(), buyOrder = String(params.TBK_ORDEN_COMPRA ?? "").trim()
  if (finished && !aborted && !buyOrder) return { kind: "finished", token: finished }
  // Cancelled at the form (TBK_TOKEN) or timed out there (only TBK_ORDEN_COMPRA and TBK_ID_SESION arrive).
  if (aborted || buyOrder) return { kind: "aborted", token: aborted, buyOrder, sessionId: String(params.TBK_ID_SESION ?? "").trim() }
  return { kind: "invalid" }
}
