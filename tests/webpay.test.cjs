const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ContainerRegistrationKeys, Modules } = require('@medusajs/framework/utils')
const { webpayConfig, WebpayClient, WebpayError, isApproved, buyOrderOf, parseWebpayReturn } = require('../src/lib/webpay')
const { emailPartsFromOrder, orderView, confirmWebpayPayment, abortWebpayPayment, resolveWebpayReturn, settleStaleWebpayOrders } = require('../src/lib/webpay-orders')

process.env.STOREFRONT_URL = 'https://bannedcards.cl'

test('integration is the default; production needs real keys', () => {
  const dev = webpayConfig({})
  assert.equal(dev.environment, 'integration'); assert.equal(dev.host, 'https://webpay3gint.transbank.cl'); assert.equal(dev.commerceCode, '597055555532'); assert.match(dev.apiSecret, /^579B/)
  assert.throws(() => webpayConfig({ WEBPAY_ENV: 'production' }), /WEBPAY_COMMERCE_CODE/)
  const prod = webpayConfig({ WEBPAY_ENV: 'production', WEBPAY_COMMERCE_CODE: '123', WEBPAY_API_SECRET: 'abc' })
  assert.deepEqual([prod.environment, prod.host, prod.commerceCode, prod.apiSecret], ['production', 'https://webpay3g.transbank.cl', '123', 'abc'])
})

test('the client sends Transbank the expected requests and maps errors', async () => {
  const calls = []
  const fetcher = async (url, init) => { calls.push({ url, ...init }); return { ok: true, status: 200, text: async () => JSON.stringify({ token: 'T', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }) } }
  const client = new WebpayClient(webpayConfig({}), fetcher)
  const created = await client.create({ buyOrder: 'BC7', sessionId: 's', amount: 5990, returnUrl: 'https://bannedcards.cl/webpay/retorno' })
  assert.equal(created.token, 'T'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].url, 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions')
  assert.equal(calls[0].headers['Tbk-Api-Key-Id'], '597055555532'); assert.deepEqual(JSON.parse(calls[0].body), { buy_order: 'BC7', session_id: 's', amount: 5990, return_url: 'https://bannedcards.cl/webpay/retorno' })
  await client.commit('a/b'); assert.equal(calls[1].method, 'PUT'); assert.match(calls[1].url, /transactions\/a%2Fb$/)
  await client.status('T'); assert.equal(calls[2].method, 'GET')
  await assert.rejects(client.create({ buyOrder: 'x', sessionId: 's', amount: 10.5, returnUrl: 'u' }), /whole number/)
  const rejecting = new WebpayClient(webpayConfig({}), async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ error_message: 'Transaction not found' }) }))
  await assert.rejects(rejecting.commit('T'), error => error instanceof WebpayError && error.httpStatus === 422 && /not found/.test(error.message))
  const down = new WebpayClient(webpayConfig({}), async () => { throw new Error('offline') })
  await assert.rejects(down.status('T'), error => error instanceof WebpayError && !error.httpStatus)
})

test('only AUTHORIZED with code 0 counts as paid; buy orders are short; returns are parsed', () => {
  assert.equal(isApproved({ status: 'AUTHORIZED', response_code: 0 }), true); assert.equal(isApproved({ status: 'AUTHORIZED', response_code: -1 }), false); assert.equal(isApproved({ status: 'FAILED', response_code: 0 }), false)
  assert.ok(buyOrderOf(123456789).length <= 26)
  assert.deepEqual(parseWebpayReturn({ token_ws: 'abc' }), { kind: 'finished', token: 'abc' })
  assert.deepEqual(parseWebpayReturn({ TBK_TOKEN: 't', TBK_ORDEN_COMPRA: 'BC9', TBK_ID_SESION: 's' }), { kind: 'aborted', token: 't', buyOrder: 'BC9', sessionId: 's' })
  assert.deepEqual(parseWebpayReturn({ TBK_ORDEN_COMPRA: 'BC9', TBK_ID_SESION: 's' }), { kind: 'aborted', token: '', buyOrder: 'BC9', sessionId: 's' })
  assert.equal(parseWebpayReturn({ token_ws: 'abc', TBK_TOKEN: 't' }).kind, 'aborted'); assert.equal(parseWebpayReturn({}).kind, 'invalid')
})

const startedAt = minutesAgo => new Date(Date.now() - minutesAgo * 60_000).toISOString()
function world({ minutes = 2, status = 'initiated' } = {}) {
  const orders = [{
    id: 'o1', display_id: 1042, email: 'ana@example.cl', currency_code: 'clp', total: 20000, subtotal: 20000, created_at: startedAt(minutes),
    metadata: { payment_method: 'webpay', webpay_status: status, webpay_token: 'tok1', webpay_session_id: 'sess1', webpay_started_at: startedAt(minutes), webpay_environment: 'integration', payment_status: 'not_paid', cart_id: 'cart1', locale: 'es', customer_first_name: 'Ana', contact_name: 'Ana Soto', contact_phone: '+56961399997', document_type: 'boleta', document_rut: '12.345.678-5', delivery_comuna: 'Las Condes', delivery_region: 'Región Metropolitana de Santiago', customer_notes: 'Tocar timbre' },
    shipping_address: { first_name: 'Ana', last_name: 'Soto', address_1: 'Av. 1', address_2: 'D 4', city: 'Las Condes', province: 'Región Metropolitana de Santiago', phone: '+56961399997' },
    items: [{ id: 'li1', title: 'Sleeves & more', variant_id: 'v1', quantity: 2, unit_price: 10000, thumbnail: null }],
  }]
  const log = { emails: [], released: [], canceled: [], carts: [] }
  const services = {
    [ContainerRegistrationKeys.QUERY]: { graph: async ({ filters }) => ({ data: filters?.id ? orders.filter(o => o.id === filters.id) : orders }) },
    [Modules.ORDER]: { retrieveOrder: async id => orders.find(o => o.id === id), updateOrders: async (id, patch) => { Object.assign(orders.find(o => o.id === id), patch) }, cancel: async id => { log.canceled.push(id) } },
    [Modules.INVENTORY]: { deleteReservationItemsByLineItem: async ids => { log.released.push(...ids) } },
    [Modules.NOTIFICATION]: { createNotifications: async n => { log.emails.push(n) } },
    [Modules.CART]: { updateCarts: async updates => { log.carts.push(...updates.map(u => u.id)) } },
    [Modules.LOCKING]: { execute: async (_key, fn) => fn() },
  }
  return { orders, log, scope: { resolve: key => services[key] } }
}
const transbank = (handler) => { const calls = []; const fetcher = async (url, init) => { calls.push(init.method); return handler(init.method) }; fetcher.calls = calls; return fetcher }
const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const approved = { status: 'AUTHORIZED', response_code: 0, amount: 20000, authorization_code: '1213', payment_type_code: 'VN', installments_number: 0, transaction_date: '2026-10-09T18:00:00Z', card_detail: { card_number: '6623' } }

test('an approved payment marks the order paid, sends both emails and is safe to confirm twice', async () => {
  const { orders, log, scope } = world(); const fetcher = transbank(() => reply(approved))
  const outcome = await confirmWebpayPayment(scope, 'tok1', fetcher)
  assert.equal(outcome.status, 'approved'); assert.equal(outcome.order.payment_status, 'paid'); assert.equal(outcome.payment.card_last4, '6623'); assert.equal(outcome.email_sent, true)
  assert.equal(orders[0].metadata.payment_status, 'paid'); assert.equal(orders[0].metadata.webpay_status, 'approved'); assert.equal(orders[0].metadata.webpay.authorization_code, '1213')
  assert.deepEqual(log.emails.map(e => e.to), ['ana@example.cl', 'compras@bannedcards.cl'])
  assert.match(log.emails[0].data.html, /Pagado con Webpay/); assert.match(log.emails[0].data.html, /prueba/i); assert.match(log.emails[1].data.subject, /Nuevo pedido #1042/)
  assert.deepEqual(log.released, []); assert.deepEqual(log.carts, ['cart1'])
  const again = await confirmWebpayPayment(scope, 'tok1', fetcher)
  assert.equal(again.status, 'approved'); assert.equal(fetcher.calls.length, 1); assert.equal(log.emails.length, 2)
})
test('a rejected payment gives the stock back and sends nothing', async () => {
  const { orders, log, scope } = world(); const fetcher = transbank(() => reply({ status: 'FAILED', response_code: -1, amount: 20000 }))
  const outcome = await confirmWebpayPayment(scope, 'tok1', fetcher)
  assert.equal(outcome.status, 'rejected'); assert.deepEqual(log.released, ['li1']); assert.deepEqual(log.canceled, ['o1']); assert.equal(orders[0].metadata.webpay_status, 'failed'); assert.equal(orders[0].metadata.payment_status, 'not_paid'); assert.equal(log.emails.length, 0); assert.deepEqual(log.carts, [])
  assert.equal((await confirmWebpayPayment(scope, 'tok1', fetcher)).status, 'rejected'); assert.equal(fetcher.calls.length, 1)
})
test('a paid amount that does not match the order is held for review, not released', async () => {
  const { orders, log, scope } = world(); const outcome = await confirmWebpayPayment(scope, 'tok1', transbank(() => reply({ ...approved, amount: 100 })))
  assert.equal(outcome.status, 'review'); assert.equal(orders[0].metadata.webpay_status, 'review'); assert.deepEqual(log.released, []); assert.equal(log.emails.length, 0)
})
test('unknown tokens are reported, and an unreachable Webpay keeps the order waiting', async () => {
  const { orders, log, scope } = world()
  assert.equal((await confirmWebpayPayment(scope, 'nope', transbank(() => reply(approved)))).status, 'unknown')
  await assert.rejects(confirmWebpayPayment(scope, 'tok1', async () => { throw new Error('offline') }), error => error.code === 'webpay_unavailable')
  assert.equal(orders[0].metadata.webpay_status, 'initiated'); assert.deepEqual(log.released, [])
})
test('cancelling at the Webpay form closes the order only with the right session', async () => {
  const { orders, log, scope } = world()
  assert.equal((await abortWebpayPayment(scope, { buyOrder: 'BC1042', sessionId: 'wrong' })).status, 'unknown'); assert.equal(orders[0].metadata.webpay_status, 'initiated')
  assert.equal((await abortWebpayPayment(scope, { buyOrder: 'x', sessionId: 'sess1' })).status, 'unknown')
  const outcome = await resolveWebpayReturn(scope, { TBK_TOKEN: 't', TBK_ORDEN_COMPRA: 'BC1042', TBK_ID_SESION: 'sess1' })
  assert.equal(outcome.status, 'aborted'); assert.deepEqual(log.released, ['li1']); assert.equal(orders[0].metadata.webpay_status, 'aborted')
})
test('the job settles orders that never came back, and leaves recent ones alone', async () => {
  const stale = world({ minutes: 45 }); const none = await settleStaleWebpayOrders(stale.scope, new Date(), transbank(() => reply({ error_message: 'not found' }, 422)))
  assert.deepEqual(none, { paid: 0, released: 1, skipped: 0 }); assert.equal(stale.orders[0].metadata.webpay_status, 'expired'); assert.deepEqual(stale.log.released, ['li1'])
  const paidLate = world({ minutes: 45 }); const done = await settleStaleWebpayOrders(paidLate.scope, new Date(), transbank(() => reply(approved)))
  assert.deepEqual(done, { paid: 1, released: 0, skipped: 0 }); assert.equal(paidLate.orders[0].metadata.payment_status, 'paid')
  const fresh = world({ minutes: 5 }); const nothing = await settleStaleWebpayOrders(fresh.scope, new Date(), transbank(() => reply(approved)))
  assert.deepEqual(nothing, { paid: 0, released: 0, skipped: 0 }); assert.equal(fresh.orders[0].metadata.webpay_status, 'initiated')
  const flaky = world({ minutes: 45 }); const retry = await settleStaleWebpayOrders(flaky.scope, new Date(), async () => { throw new Error('offline') })
  assert.deepEqual(retry, { paid: 0, released: 0, skipped: 1 }); assert.equal(flaky.orders[0].metadata.webpay_status, 'initiated')
})
test('the email data and the result view are rebuilt from the saved order', () => {
  const { orders } = world(); const parts = emailPartsFromOrder(orders[0])
  assert.equal(parts.document.rut, '12.345.678-5'); assert.equal(parts.delivery.comuna, 'Las Condes'); assert.equal(parts.delivery.address2, 'D 4'); assert.equal(parts.notes, 'Tocar timbre'); assert.equal(parts.customerName, 'Ana')
  const view = orderView(orders[0]); assert.equal(view.display_id, 1042); assert.equal(view.items[0].quantity, 2); assert.equal(view.payment_status, 'not_paid')
})
