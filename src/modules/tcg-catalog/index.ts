import { Module } from "@medusajs/framework/utils"
import TcgCatalogModuleService from "./service"

export default Module("tcgCatalog", { service: TcgCatalogModuleService })
