// Tests for eval_latency.mjs's parts that don't need anything running.
// test_eval_latency.py runs them with the Python ones.
//
//   node --test scripts/eval_latency.test.mjs

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { operation, percentile, stats, viewport } from './eval_latency.mjs'

test('percentile is the value at or above that share', () => {
  const ordered = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile(ordered, 0.5), 5)
  assert.equal(percentile(ordered, 0.95), 10)
  assert.equal(percentile([7], 0.99), 7)
})

test('stats sorts first, and nothing gives nothing rather than a crash', () => {
  assert.deepEqual(stats([3, 1, 2]), { count: 3, median: 2, p95: 3, p99: 3, max: 3 })
  assert.deepEqual(stats([]), { count: 0, median: null, p95: null, p99: null, max: null })
})

test('an op is what the hub requires, and carries when it was sent', () => {
  const op = operation('id-1', 123)
  assert.equal(op.kind, 'update')
  assert.equal(op.entity, 'annotation')
  assert.equal(op.id, 'id-1')
  assert.equal(op.data.sentAt, 123)
})

test('a viewport has the shape the viewer sends', () => {
  const view = viewport(() => 0.5)
  assert.deepEqual(view.center, [50000, -50000])
  assert.equal(view.extent.length, 4)
})
