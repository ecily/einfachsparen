import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const productImage = fs.readFileSync(new URL('../components/layout/ProductImage.jsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('HOFER image fallback is an intentional, labelled state', () => {
  assert.match(productImage, /HOFER Angebot/)
  assert.match(productImage, /Bild nicht sicher verf\\u00fcgbar/)
  assert.match(productImage, /placeholderCategory = isHofer \? 'hofer'/)
  assert.match(productImage, /product-image__placeholder-label/)
})

test('HOFER image fallback stays compact and readable on narrow cards', () => {
  assert.match(styles, /\.product-image--placeholder-hofer\s*\{/)
  assert.match(styles, /\.product-image__placeholder-label\s*\{[\s\S]*?max-width:\s*100%/)
  assert.match(styles, /overflow-wrap:\s*anywhere/)
})
