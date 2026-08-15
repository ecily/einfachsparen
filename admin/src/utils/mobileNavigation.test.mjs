import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('mobile navigation keeps all four public destinations visible through 320px', () => {
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.page-nav__main\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(css, /\.page-nav__main \.page-nav__button:nth-child\(2\)\s*\{\s*display:\s*none/)
  assert.match(css, /\.page-nav__button:nth-child\(2\)\s*\{\s*display:\s*inline-flex !important/)
})

test('mobile navigation prevents horizontal page overflow', () => {
  assert.match(css, /html,[\s\S]*?body,[\s\S]*?#root\s*\{[\s\S]*?overflow-x:\s*clip/)
  assert.match(css, /\.page-nav\s*\{[\s\S]*?max-width:\s*100%\s*!important/)
})
