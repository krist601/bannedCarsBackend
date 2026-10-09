import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EmailNotificationProviderService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, { services: [EmailNotificationProviderService] })
