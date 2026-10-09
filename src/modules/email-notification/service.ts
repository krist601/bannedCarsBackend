import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"

type Options = { driver?: string; apiKey?: string; from?: string; region?: string; accessKeyId?: string; secretAccessKey?: string }
type SesClient = { send(command: unknown): Promise<{ MessageId?: string }> }
type Logger = { info(message: string): void; warn(message: string): void }

/**
 * Sends transactional email through Amazon SES (EMAIL_DRIVER=ses) or Resend's HTTP API (RESEND_API_KEY).
 * With neither configured (local development) the message is only written to the server log, so registration still works offline.
 */
export default class EmailNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "email"
  private readonly options: Options
  private readonly logger: Logger
  private readonly fetcher: typeof fetch

  private readonly sesFactory: () => Promise<SesClient>
  private ses?: Promise<SesClient>

  constructor({ logger }: { logger: Logger }, options: Options = {}, fetcher: typeof fetch = fetch, sesFactory?: () => Promise<SesClient>) {
    super()
    this.logger = logger
    this.options = options
    this.fetcher = fetcher
    this.sesFactory = sesFactory ?? (async () => {
      const { SESv2Client } = await import("@aws-sdk/client-sesv2")
      const { accessKeyId, secretAccessKey } = this.options
      return new SESv2Client({ region: this.options.region || "sa-east-1", ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}) }) as unknown as SesClient
    })
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const data = (notification.data ?? {}) as { subject?: string; html?: string; text?: string; link?: string }
    if (!data.subject || (!data.html && !data.text)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Email needs a subject and a body.")
    if (this.options.driver === "ses") {
      const { SendEmailCommand } = await import("@aws-sdk/client-sesv2")
      const from = notification.from || this.options.from
      if (!from) throw new MedusaError(MedusaError.Types.INVALID_DATA, "EMAIL_FROM is required to send with SES.")
      this.ses ??= this.sesFactory()
      try {
        const result = await (await this.ses).send(new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [notification.to] },
          Content: { Simple: { Subject: { Data: data.subject, Charset: "UTF-8" }, Body: { ...(data.html ? { Html: { Data: data.html, Charset: "UTF-8" } } : {}), ...(data.text ? { Text: { Data: data.text, Charset: "UTF-8" } } : {}) } } },
        }))
        return { id: result.MessageId ?? `ses-${Date.now()}` }
      } catch (error) {
        this.logger.warn(`[email] SES rejected the message: ${(error as Error).name}`)
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The email provider could not send the message.")
      }
    }
    if (!this.options.apiKey) {
      this.logger.info(`[email:dev] to=${notification.to} subject="${data.subject}"${data.link ? ` link=${data.link}` : ""}`)
      return { id: `dev-${Date.now()}` }
    }
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: notification.from || this.options.from || "Banned Cards <onboarding@resend.dev>", to: [notification.to], subject: data.subject, html: data.html, text: data.text }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      this.logger.warn(`[email] provider rejected the message (HTTP ${response.status})`)
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Email provider returned HTTP ${response.status}.`)
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string }
    return { id: body.id ?? `resend-${Date.now()}` }
  }
}
