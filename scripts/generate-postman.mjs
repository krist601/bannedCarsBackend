import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const output = path.join(root, "postman")
const defaults = {
  base_url: "http://localhost:9000",
  customer_email: "postman.customer@example.com",
  customer_password: "PostmanLocal123!",
  search_query: "ring"
}
const variableNames = [
  "base_url", "admin_email", "admin_password", "admin_token", "publishable_key", "region_id",
  "customer_email", "customer_password", "customer_token", "registration_token", "customer_id", "address_id",
  "search_query", "product_id", "variant_id", "category_id", "collection_id", "product_type_id",
  "product_tag_id", "product_option_id", "cart_id", "line_item_id", "promotion_code",
  "shipping_option_id", "payment_provider_id", "payment_collection_id", "order_id",
  "order_line_item_id", "return_reason_id", "return_shipping_option_id", "order_transfer_token"
]
const secrets = new Set([
  "admin_password", "admin_token", "publishable_key", "customer_password",
  "customer_token", "registration_token", "order_transfer_token"
])

const setup = [
  ["Health check", "GET", "/health"],
  ["Admin login", "POST", "/auth/user/emailpass", { email: "{{admin_email}}", password: "{{admin_password}}" }],
  ["Find publishable API key", "GET", "/admin/api-keys?type=publishable&limit=100", null, "admin"],
  ["Find CLP region", "GET", "/store/regions?limit=100"]
]
const catalogue = [
  ["List complete TCG card catalogue", "GET", "/store/tcg/cards?limit=100&offset=0"],
  ["List products", "GET", "/store/products?region_id={{region_id}}&limit=100&fields=*variants.calculated_price,+variants.inventory_quantity,+variants.metadata,+metadata"],
  ["Search products", "GET", "/store/products/search?q={{search_query}}&limit=20"],
  ["Get product", "GET", "/store/products/{{product_id}}?region_id={{region_id}}&fields=*variants.calculated_price,+variants.inventory_quantity,+variants.metadata,+metadata"],
  ["List variants", "GET", "/store/product-variants?limit=100&fields=*calculated_price,+inventory_quantity,+metadata"],
  ["Get variant", "GET", "/store/product-variants/{{variant_id}}?fields=*calculated_price,+inventory_quantity,+metadata"],
  ["List categories", "GET", "/store/product-categories?limit=100"],
  ["Get category", "GET", "/store/product-categories/{{category_id}}"],
  ["List collections", "GET", "/store/collections?limit=100"],
  ["Get collection", "GET", "/store/collections/{{collection_id}}"],
  ["List product types", "GET", "/store/product-types?limit=100"],
  ["Get product type", "GET", "/store/product-types/{{product_type_id}}"],
  ["List product tags", "GET", "/store/product-tags?limit=100"],
  ["Get product tag", "GET", "/store/product-tags/{{product_tag_id}}"],
  ["List product options", "GET", "/store/product-options?limit=100"],
  ["Get product option", "GET", "/store/product-options/{{product_option_id}}"],
  ["List currencies", "GET", "/store/currencies?limit=100"],
  ["Get CLP currency", "GET", "/store/currencies/clp"],
  ["Get region", "GET", "/store/regions/{{region_id}}"],
  ["List locales", "GET", "/store/locales"],
  ["List payment providers", "GET", "/store/payment-providers?region_id={{region_id}}"],
  ["List return reasons", "GET", "/store/return-reasons?limit=100"],
  ["Get return reason", "GET", "/store/return-reasons/{{return_reason_id}}"]
]
const customers = [
  ["Register auth identity", "POST", "/auth/customer/emailpass/register", { email: "{{customer_email}}", password: "{{customer_password}}" }],
  ["Create customer", "POST", "/store/customers", { email: "{{customer_email}}", first_name: "Postman", last_name: "Tester", phone: "+56911111111" }, "registration"],
  ["Login customer", "POST", "/auth/customer/emailpass", { email: "{{customer_email}}", password: "{{customer_password}}" }],
  ["Create session", "POST", "/auth/session", null, "customer"],
  ["Get current customer", "GET", "/store/customers/me?fields=*addresses"],
  ["Update current customer", "POST", "/store/customers/me?fields=*addresses", { first_name: "Postman", last_name: "Banned Cards Tester" }],
  ["Create address", "POST", "/store/customers/me/addresses?fields=*addresses", { address_name: "Postman Chile", first_name: "Postman", last_name: "Tester", address_1: "Av. Providencia 1234", city: "Santiago", province: "Region Metropolitana", postal_code: "7500000", country_code: "cl", phone: "+56911111111", is_default_shipping: true, is_default_billing: true }],
  ["List addresses", "GET", "/store/customers/me/addresses?limit=100"],
  ["Get address", "GET", "/store/customers/me/addresses/{{address_id}}"],
  ["Update address", "POST", "/store/customers/me/addresses/{{address_id}}?fields=*addresses", { address_name: "Postman Chile Updated", city: "Santiago" }],
  ["Delete address", "DELETE", "/store/customers/me/addresses/{{address_id}}"],
  ["Logout session", "DELETE", "/auth/session"]
]
const carts = [
  ["Create cart", "POST", "/store/carts", { region_id: "{{region_id}}", email: "{{customer_email}}" }],
  ["Get cart", "GET", "/store/carts/{{cart_id}}"],
  ["Update cart addresses", "POST", "/store/carts/{{cart_id}}", { email: "{{customer_email}}", shipping_address: { first_name: "Postman", last_name: "Tester", address_1: "Av. Providencia 1234", city: "Santiago", province: "Region Metropolitana", postal_code: "7500000", country_code: "cl", phone: "+56911111111" }, billing_address: { first_name: "Postman", last_name: "Tester", address_1: "Av. Providencia 1234", city: "Santiago", province: "Region Metropolitana", postal_code: "7500000", country_code: "cl" } }],
  ["Attach customer", "POST", "/store/carts/{{cart_id}}/customer", {}],
  ["Add line item", "POST", "/store/carts/{{cart_id}}/line-items", { variant_id: "{{variant_id}}", quantity: 1 }],
  ["Update line item", "POST", "/store/carts/{{cart_id}}/line-items/{{line_item_id}}", { quantity: 2 }],
  ["Calculate taxes", "POST", "/store/carts/{{cart_id}}/taxes"],
  ["Add promotion", "POST", "/store/carts/{{cart_id}}/promotions", { promo_codes: ["{{promotion_code}}"] }],
  ["Remove promotion", "DELETE", "/store/carts/{{cart_id}}/promotions", { promo_codes: ["{{promotion_code}}"] }],
  ["List shipping options", "GET", "/store/shipping-options?cart_id={{cart_id}}"],
  ["Calculate shipping option", "POST", "/store/shipping-options/{{shipping_option_id}}/calculate", { cart_id: "{{cart_id}}", data: {} }],
  ["Add shipping method", "POST", "/store/carts/{{cart_id}}/shipping-methods", { option_id: "{{shipping_option_id}}", data: {} }],
  ["Create payment collection", "POST", "/store/payment-collections", { cart_id: "{{cart_id}}" }],
  ["Create payment session", "POST", "/store/payment-collections/{{payment_collection_id}}/payment-sessions", { provider_id: "{{payment_provider_id}}", data: {} }],
  ["Complete cart", "POST", "/store/carts/{{cart_id}}/complete"],
  ["Delete line item", "DELETE", "/store/carts/{{cart_id}}/line-items/{{line_item_id}}"]
]
const orders = [
  ["List orders", "GET", "/store/orders?limit=100"],
  ["Get order", "GET", "/store/orders/{{order_id}}"]
]
const returns = [
  ["Create return", "POST", "/store/returns", { order_id: "{{order_id}}", items: [{ id: "{{order_line_item_id}}", quantity: 1, reason_id: "{{return_reason_id}}" }], return_shipping: { option_id: "{{return_shipping_option_id}}" }, note: "Postman return test" }],
  ["Request order transfer", "POST", "/store/orders/{{order_id}}/transfer/request", { description: "Postman transfer test", update_order_email: false }],
  ["Cancel order transfer", "POST", "/store/orders/{{order_id}}/transfer/cancel"],
  ["Accept order transfer", "POST", "/store/orders/{{order_id}}/transfer/accept", { token: "{{order_transfer_token}}" }],
  ["Decline order transfer", "POST", "/store/orders/{{order_id}}/transfer/decline", { token: "{{order_transfer_token}}" }]
]

const captureScripts = {
  "Admin login": "const d=pm.response.json(); if(d.token) pm.environment.set('admin_token',d.token);",
  "Find publishable API key": "const a=pm.response.json().api_keys||[]; const x=a.find(v=>v.type==='publishable'); if(x&&x.token) pm.environment.set('publishable_key',x.token);",
  "Find CLP region": "const a=pm.response.json().regions||[]; const x=a.find(v=>String(v.currency_code).toLowerCase()==='clp'); if(x) pm.environment.set('region_id',x.id);",
  "List products": "const a=pm.response.json().products||[]; if(a[0]){pm.environment.set('product_id',a[0].id); if(a[0].variants&&a[0].variants[0]) pm.environment.set('variant_id',a[0].variants[0].id);}",
  "List variants": "const a=pm.response.json().variants||[]; if(a[0]) pm.environment.set('variant_id',a[0].id);",
  "List categories": "const a=pm.response.json().product_categories||[]; if(a[0]) pm.environment.set('category_id',a[0].id);",
  "List collections": "const a=pm.response.json().collections||[]; if(a[0]) pm.environment.set('collection_id',a[0].id);",
  "List product types": "const a=pm.response.json().product_types||[]; if(a[0]) pm.environment.set('product_type_id',a[0].id);",
  "List product tags": "const a=pm.response.json().product_tags||[]; if(a[0]) pm.environment.set('product_tag_id',a[0].id);",
  "List product options": "const a=pm.response.json().product_options||[]; if(a[0]) pm.environment.set('product_option_id',a[0].id);",
  "List payment providers": "const a=pm.response.json().payment_providers||[]; if(a[0]) pm.environment.set('payment_provider_id',a[0].id);",
  "List return reasons": "const a=pm.response.json().return_reasons||[]; if(a[0]) pm.environment.set('return_reason_id',a[0].id);",
  "Register auth identity": "const d=pm.response.json(); if(d.token) pm.environment.set('registration_token',d.token);",
  "Create customer": "const d=pm.response.json().customer; if(d) pm.environment.set('customer_id',d.id);",
  "Login customer": "const d=pm.response.json(); if(d.token) pm.environment.set('customer_token',d.token);",
  "Create address": "const a=(pm.response.json().customer||{}).addresses||[]; if(a.length) pm.environment.set('address_id',a[a.length-1].id);",
  "List addresses": "const a=pm.response.json().addresses||[]; if(a[0]) pm.environment.set('address_id',a[0].id);",
  "Create cart": "const d=pm.response.json().cart; if(d) pm.environment.set('cart_id',d.id);",
  "Add line item": "const a=(pm.response.json().cart||{}).items||[]; const x=a.find(v=>v.variant_id===pm.environment.get('variant_id')); if(x) pm.environment.set('line_item_id',x.id);",
  "List shipping options": "const a=pm.response.json().shipping_options||[]; if(a[0]) pm.environment.set('shipping_option_id',a[0].id);",
  "Create payment collection": "const d=pm.response.json().payment_collection; if(d) pm.environment.set('payment_collection_id',d.id);",
  "Complete cart": "const d=pm.response.json(); const x=d.order||(d.type==='order'?d:null); if(x&&x.id) pm.environment.set('order_id',x.id);",
  "List orders": "const a=pm.response.json().orders||[]; if(a[0]){pm.environment.set('order_id',a[0].id); if(a[0].items&&a[0].items[0]) pm.environment.set('order_line_item_id',a[0].items[0].id);}",
  "Get order": "const d=pm.response.json().order; if(d&&d.items&&d.items[0]) pm.environment.set('order_line_item_id',d.items[0].id);"
}

function makeRequest([name, method, route, body, auth]) {
  const headers = []
  if (route.startsWith("/store/")) headers.push({ key: "x-publishable-api-key", value: "{{publishable_key}}", type: "text" })
  if (body !== undefined && body !== null) headers.push({ key: "Content-Type", value: "application/json", type: "text" })
  const request = { method, header: headers, url: "{{base_url}}" + route }
  if (body !== undefined && body !== null) request.body = { mode: "raw", raw: JSON.stringify(body, null, 2), options: { raw: { language: "json" } } }
  const tokens = { admin: "{{admin_token}}", registration: "{{registration_token}}", customer: "{{customer_token}}" }
  if (auth) request.auth = { type: "bearer", bearer: [{ key: "token", value: tokens[auth], type: "string" }] }
  const tests = name === "Health check" ? [
    "pm.test('Status is 200',()=>pm.expect(pm.response.code).to.equal(200));",
    "pm.test('Medusa reports OK',()=>pm.expect(pm.response.text()).to.include('OK'));"
  ] : [
    "pm.test('Status is 2xx',()=>pm.expect(pm.response.code).to.be.within(200,299));",
    "pm.test('Response is JSON',()=>pm.response.to.be.json);"
  ]
  if (captureScripts[name]) tests.push(captureScripts[name])
  return { name, request, event: [{ listen: "test", script: { type: "text/javascript", exec: tests } }] }
}

const groups = [
  ["00 - Setup and health", "Run first. Discovers the publishable key and CLP region.", setup],
  ["01 - Catalogue and discovery", "Read-only endpoints. List requests capture IDs for detail requests.", catalogue],
  ["02 - Customer account", "Registration, login, cookie session, profile, and address endpoints.", customers],
  ["03 - Cart and checkout", "Run sequentially with a sellable variant. Shipping and payment require configured providers.", carts],
  ["04 - Orders", "Authenticated customer order endpoints.", orders],
  ["05 - Returns and transfers (manual)", "Requires a fulfilled order, return shipping option, or transfer token.", returns]
]
const collection = {
  info: {
    _postman_id: "b87df4d8-b29c-4bd4-92fb-bc0000000001",
    name: "Banned Cards - Medusa Store API",
    description: "Storefront-facing API coverage for the Banned Cards Medusa 2.21 backend. Run folders in order. Scryfall imports and image synchronization are CLI jobs.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  variable: variableNames.map(key => ({ key, value: defaults[key] || "", type: "string" })),
  item: groups.map(([name, description, entries]) => ({ name, description, item: entries.map(makeRequest) }))
}
const environment = {
  id: "ce89d4d8-b29c-4bd4-92fb-bc0000000002",
  name: "Banned Cards Local",
  values: variableNames.map(key => ({ key, value: defaults[key] || "", type: secrets.has(key) ? "secret" : "default", enabled: true })),
  _postman_variable_scope: "environment",
  _postman_exported_at: "2026-09-14T00:00:00.000Z",
  _postman_exported_using: "Banned Cards generator"
}

fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, "Banned Cards - Medusa Store API.postman_collection.json"), JSON.stringify(collection, null, 2) + "\n")
fs.writeFileSync(path.join(output, "Banned Cards Local.postman_environment.json"), JSON.stringify(environment, null, 2) + "\n")
