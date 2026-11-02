import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const designCss = fs.readFileSync(new URL('../design001.css', import.meta.url), 'utf8')

const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('mobile navigation has three main columns without hiding a primary destination', () => {
  assert.match(designCss, /grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/)
  assert.doesNotMatch(designCss, /nth-child/)
})

test('mobile navigation prevents horizontal page overflow', () => {
  assert.match(css, /html,[\s\S]*?body,[\s\S]*?#root\s*\{[\s\S]*?overflow-x:\s*clip/)
  assert.match(css, /\.page-nav\s*\{[\s\S]*?max-width:\s*100%\s*!important/)
})
