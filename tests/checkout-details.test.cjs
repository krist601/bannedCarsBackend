const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isValidRut, formatRut, cleanRut } = require('../src/lib/rut')
const { readCheckoutDetails } = require('../src/lib/test-checkout')
const { orderSummaryEmail, storeOrderEmail } = require('../src/lib/order-email')

test('RUT validation uses modulo 11', () => {
  for (const ok of ['12.345.678-5', '11.111.111-1', '76.086.428-5', '22.039.088-8', '10.000.013-K', '12345678-5']) assert.equal(isValidRut(ok), true, ok)
  for (const bad of ['12.345.678-9', '11.111.111-2', '', '1-9', 'abc', '123456789012', null, undefined, 12345678]) assert.equal(isValidRut(bad), false, String(bad))
  assert.equal(formatRut('123456785'), '12.345.678-5'); assert.equal(formatRut('10000013k'), '10.000.013-K'); assert.equal(cleanRut('12.345.678-5'), '123456785')
})

const base = { name: 'Ana', lastName: 'Soto', phone: '+56 9 6139 9997', address: 'Av. Siempre Viva 123', address2: 'Depto 4', city: 'Las Condes', region: 'Región Metropolitana de Santiago', notes: 'Tocar timbre' }
const fails = (contact, code) => assert.throws(() => readCheckoutDetails(contact), error => error.code === code || error.body?.code === code || String(error.message).length > 0)

test('legacy contacts without a document type still work', () => {
  const details = readCheckoutDetails({ name: 'Ana', phone: '123', address: 'x', city: 'y', notes: 'z' })
  assert.equal(details.document, null); assert.equal(details.name, 'Ana'); assert.equal(details.notes, 'z')
})
test('boleta needs the delivery data and a valid RUT', () => {
  const ok = readCheckoutDetails({ ...base, document: 'boleta', rut: '12345678-5' })
  assert.deepEqual(ok.document, { type: 'boleta', rut: '12.345.678-5' }); assert.equal(ok.region, 'Región Metropolitana de Santiago')
  fails({ ...base, document: 'boleta', rut: '12345678-9' }); fails({ ...base, document: 'boleta' })
  fails({ ...base, name: '', document: 'boleta', rut: '12345678-5' }); fails({ ...base, phone: '12', document: 'boleta', rut: '12345678-5' })
  fails({ ...base, address: '', document: 'boleta', rut: '12345678-5' }); fails({ ...base, region: '', document: 'boleta', rut: '12345678-5' })
})
test('factura needs the company data', () => {
  const company = { rut: '76.086.428-5', name: 'Mi Empresa SpA', activity: 'Venta de juegos', address: 'Calle 1', comuna: 'Providencia' }
  const ok = readCheckoutDetails({ ...base, document: 'factura', company })
  assert.equal(ok.document.type, 'factura'); assert.equal(ok.document.company.name, 'Mi Empresa SpA'); assert.equal(ok.document.rut, '76.086.428-5')
  fails({ ...base, document: 'factura' }); fails({ ...base, document: 'factura', company: { ...company, rut: '76.086.428-0' } })
  fails({ ...base, document: 'factura', company: { ...company, activity: '' } })
})
test('delivery and document appear in both emails, escaped', () => {
  const order = { id: 'o1', display_id: 5, email: 'a@b.cl', customer_email: 'a@b.cl', customer_name: 'Ana', payment_status: 'not_paid', total: 5000, notes: 'n', items: [{ title: 'Item', quantity: 1, unit_price: 5000 }],
    delivery: { name: 'Ana Soto <x>', phone: '+569', address: 'Av 1', address2: 'D 4', comuna: 'Las Condes', region: 'RM', branch: 'Providencia', shipping: 'starken' },
    document: { type: 'factura', rut: '76.086.428-5', company: { rut: '76.086.428-5', name: 'Mi Empresa', activity: 'Juegos', address: 'Calle 1', comuna: 'Providencia' } } }
  const customer = orderSummaryEmail('es', order)
  for (const text of ['Entrega', 'Documento', 'Factura', '76.086.428-5', 'Las Condes', 'Starken', 'Providencia']) assert.match(customer.html, new RegExp(text))
  assert.doesNotMatch(customer.html, /<x>/); assert.match(customer.text, /Factura/)
  const store = storeOrderEmail(order)
  assert.match(store.subject, /Nuevo pedido #5/); for (const text of ['Mi Empresa', 'Juegos', 'Av 1', 'RUT', '76.086.428-5']) assert.match(store.html, new RegExp(text))
  assert.match(store.text, /Mi Empresa/)
})
