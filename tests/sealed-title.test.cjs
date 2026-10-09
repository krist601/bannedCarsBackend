const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sealedProductTitle } = require('../src/lib/sealed-title')

test('sealed titles do not repeat the set name', () => {
  assert.equal(sealedProductTitle('Reality Fracture', 'Reality Fracture Bundle'), 'Reality Fracture Bundle')
  assert.equal(sealedProductTitle('Reality Fracture', 'reality  fracture - Draft Night'), 'reality  fracture - Draft Night')
})
test('sealed titles add the set name when the product name lacks it', () => {
  assert.equal(sealedProductTitle('Reality Fracture', 'Foundations Commander Decks'), 'Reality Fracture Foundations Commander Decks')
  assert.equal(sealedProductTitle('', 'Bundle'), 'Bundle')
})
test('the "Magic: The Gathering® |" brand prefix is dropped and never doubled', () => {
  const set = 'Magic: The Gathering® | Teenage Mutant Ninja Turtles'
  assert.equal(sealedProductTitle(set, `${set} Bundle`), 'Teenage Mutant Ninja Turtles Bundle')
  assert.equal(sealedProductTitle(set, 'Teenage Mutant Ninja Turtles Pizza Bundle'), 'Teenage Mutant Ninja Turtles Pizza Bundle')
  assert.equal(sealedProductTitle(set, 'Turtle Team-Up'), 'Teenage Mutant Ninja Turtles Turtle Team-Up')
  assert.equal(sealedProductTitle('Teenage Mutant Ninja Turtles', `${set} Play Booster Display`), 'Teenage Mutant Ninja Turtles Play Booster Display')
})
