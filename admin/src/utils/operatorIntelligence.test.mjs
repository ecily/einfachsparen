import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../components/admin/DiagnosticsPage.jsx', import.meta.url), 'utf8')

test('operator cockpit renders the human action contract and fail-closed empty state', () => {
  assert.match(source, /Was du jetzt tun solltest/)
  assert.match(source, /Aktuell ist kein menschlicher Eingriff erforderlich\./)
  assert.match(source, /Warum menschlich\?/) 
  assert.match(source, /Was tun\?/) 
  assert.match(source, /Erwarteter Impact:/)
  assert.match(source, /action\.evidence/)
  assert.match(source, /actions\.slice\(0, 5\)/)
})

test('operator cockpit exposes the global feedback learning summary without raw JSON', () => {
  assert.match(source, /Global Feedback Learning/)
  assert.match(source, /Root Cause:/)
  assert.match(source, /Ähnliche Fälle:/)
  assert.doesNotMatch(source, /JSON\.stringify\(action/)
})

