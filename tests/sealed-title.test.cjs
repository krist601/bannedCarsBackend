const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sealedProductTitle, sealedSetName } = require('../src/lib/sealed-title')

test('the product name is only the product, the set is shown separately', () => {
  assert.equal(sealedProductTitle('Reality Fracture', 'Reality Fracture Bundle'), 'Bundle')
  assert.equal(sealedProductTitle('Reality Fracture', 'reality  fracture - Draft Night'), 'Draft Night')
  assert.equal(sealedProductTitle('Reality Fracture', 'Foundations Commander Decks'), 'Foundations Commander Decks')
  assert.equal(sealedProductTitle('', 'Bundle'), 'Bundle')
})
test('the "Magic: The Gathering® |" brand prefix is dropped and never doubled', () => {
  const set = 'Magic: The Gathering® | Marvel Super Heroes'
  assert.equal(sealedProductTitle(set, `${set} Play Booster`), 'Play Booster')
  assert.equal(sealedProductTitle(set, `${set} ${set} Collector Booster Display`), 'Collector Booster Display')
  assert.equal(sealedProductTitle('Marvel Super Heroes', `${set} Bundle`), 'Bundle')
  assert.equal(sealedProductTitle('Magic: The Gathering® | The Hobbit™', 'Magic: The Gathering® | The Hobbit™ Gift Bundle'), 'Gift Bundle')
  assert.equal(sealedProductTitle('Lorwyn Eclipsed', 'Lorwyn Eclipsed Play Booster'), 'Play Booster')
})
test('a name that is only the set name is kept, and a longer word is not cut', () => {
  assert.equal(sealedProductTitle('Foundations', 'Foundations'), 'Foundations')
  assert.equal(sealedProductTitle('Fin', 'Finality Bundle'), 'Finality Bundle')
})
test('set names are shown without the brand', () => {
  assert.equal(sealedSetName('Magic: The Gathering® | Teenage Mutant Ninja Turtles'), 'Teenage Mutant Ninja Turtles')
  assert.equal(sealedSetName('Lorwyn Eclipsed'), 'Lorwyn Eclipsed')
})
