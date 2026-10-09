const { test } = require('node:test')
const assert = require('node:assert/strict')
const env = { STOREFRONT_URL: 'https://bannedcards.cl', S3_FILE_URL: 'https://bucket.s3.sa-east-1.amazonaws.com' }
Object.assign(process.env, env)
const { emailImage, apiUrl } = require('../src/lib/email-layout')
const { orderSummaryEmail, orderLink } = require('../src/lib/order-email')
const { verificationEmail } = require('../src/lib/email-verification')

test('picture addresses work in mail apps', () => {
  assert.equal(emailImage('https://cards.scryfall.io/normal/front/a/b/c.jpg?1'), 'https://cards.scryfall.io/small/front/a/b/c.jpg?1')
  const s3 = 'https://bucket.s3.sa-east-1.amazonaws.com/catalogproducts/accessories/x.webp'
  assert.equal(emailImage(s3), `https://api.bannedcards.cl/email-assets/image?u=${encodeURIComponent(s3)}`)
  assert.equal(emailImage('/demo/shop/a.png'), 'https://bannedcards.cl/demo/shop/a.png')
  assert.equal(emailImage('http://insecure.test/a.png'), null)
  assert.equal(emailImage(null), null)
  assert.equal(apiUrl(), 'https://api.bannedcards.cl')
})

test('order email shows pictures, the order link and the brand look', () => {
  const order = { id: 'order_01ABC', display_id: 7, email: 'a@b.cl', payment_status: 'not_paid', total: 5000, items: [{ title: 'Black <Sleeves>', quantity: 2, unit_price: 2500, thumbnail: 'https://cards.scryfall.io/normal/front/a/b/c.jpg' }, { title: 'No picture', quantity: 1, unit_price: 0 }] }
  assert.equal(orderLink(order), 'https://bannedcards.cl/mi-cuenta?tab=orders&order=order_01ABC')
  const email = orderSummaryEmail('es', order)
  assert.match(email.html, /https:\/\/cards\.scryfall\.io\/small\/front\/a\/b\/c\.jpg/)
  assert.match(email.html, /href="https:\/\/bannedcards\.cl\/mi-cuenta\?tab=orders&order=order_01ABC"/)
  assert.match(email.html, /Ver mi pedido/); assert.match(email.html, /#7C3AED/); assert.match(email.html, /logo-horizontal-white/)
  assert.match(email.html, /Black &lt;Sleeves&gt;/); assert.doesNotMatch(email.html, /<Sleeves>/)
  assert.match(email.text, /mi-cuenta\?tab=orders&order=order_01ABC/)
})

test('confirmation email uses the same look and keeps its link', () => {
  const email = verificationEmail('en', 'https://bannedcards.cl/verificar-correo?token=t', 'Ana')
  assert.match(email.subject, /Confirm/); assert.match(email.html, /Confirm my email/); assert.match(email.html, /verificar-correo\?token=t/); assert.match(email.html, /#F59E0B/)
})
