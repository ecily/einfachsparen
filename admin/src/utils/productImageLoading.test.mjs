import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const productImageSource = fs.readFileSync(
  new URL('../components/layout/ProductImage.jsx', import.meta.url),
  'utf8',
)
const styles = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('offer images start only within a bounded distance of the viewport', () => {
  assert.match(productImageSource, /const IMAGE_LOAD_ROOT_MARGIN = '200px 0px'/)
  assert.match(productImageSource, /new IntersectionObserver\(/)
  assert.match(productImageSource, /observer\.observe\(imageContainer\)/)
  assert.match(productImageSource, /data-image-deferred=\{shouldLoad \? undefined : 'true'\}/)
  assert.match(productImageSource, /\{shouldLoad \? \([\s\S]*?<img/)
})

test('offer images retain native lazy loading and asynchronous decoding', () => {
  assert.match(productImageSource, /loading="lazy"/)
  assert.match(productImageSource, /decoding="async"/)
})

test('offer image space remains stable before the request starts', () => {
  assert.match(styles, /\.product-image\s*\{[\s\S]*?aspect-ratio:\s*1 \/ 1;/)
  assert.match(styles, /@media[\s\S]*?\.product-image\s*\{[\s\S]*?aspect-ratio:\s*4 \/ 3;/)
})
