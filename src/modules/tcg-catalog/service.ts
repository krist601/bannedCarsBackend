import { MedusaService } from "@medusajs/framework/utils"
import CardListing from "./models/card-listing"
import CardPrinting from "./models/card-printing"
import CardSet from "./models/card-set"
import Game from "./models/game"
import Product from "./models/product"
import Listing from "./models/listing"

class TcgCatalogModuleService extends MedusaService({
  Game,
  CardSet,
  CardPrinting,
  CardListing,
  Product,
  Listing
}) {}

export default TcgCatalogModuleService
