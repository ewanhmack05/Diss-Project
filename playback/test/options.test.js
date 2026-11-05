import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enoughMemory, mergeManifest, MIN_FREE_BYTES, parseArgs, pickScenes } from '../lib/options.js'

const SCENES = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]

test('defaults point at the local viewer and Keycloak', () => {
  const options = parseArgs([])
  assert.equal(options.url, 'https://localhost:5173')
  assert.equal(options.keycloak, 'http://localhost:8080/auth')
  assert.deepEqual(options.only, [])
})

test('--only takes several scenes and stops at the next flag', () => {
  const options = parseArgs(['--only', 'a', 'b', '--headed'])
  assert.deepEqual(options.only, ['a', 'b'])
  assert.equal(options.headed, true)
})

test('--only with nothing after it is an error', () => {
  assert.throws(() => parseArgs(['--only']), /at least one/)
  assert.throws(() => parseArgs(['--only', '--headed']), /at least one/)
})

test('a flag missing its value is an error', () => {
  assert.throws(() => parseArgs(['--url']), /needs a value/)
  assert.throws(() => parseArgs(['--out', '--headed']), /needs a value/)
})

test('an unknown flag is an error, not ignored', () => {
  assert.throws(() => parseArgs(['--nope']), /Don't know --nope/)
})

test('trailing slashes come off the addresses', () => {
  const options = parseArgs(['--url', 'https://localhost:5173/', '--keycloak', 'http://localhost:8080/auth//'])
  assert.equal(options.url, 'https://localhost:5173')
  assert.equal(options.keycloak, 'http://localhost:8080/auth')
})

test('no --only means every scene', () => {
  assert.deepEqual(pickScenes(SCENES, []), SCENES)
})

test('scenes run in defined order however they were typed', () => {
  assert.deepEqual(pickScenes(SCENES, ['c', 'a']).map((s) => s.name), ['a', 'c'])
})

test('an unknown scene says what there is', () => {
  assert.throws(() => pickScenes(SCENES, ['z']), /No scene called z - there's a, b, c/)
})

const ORDER = ['a', 'b', 'c']

test('recording one scene keeps the others in the manifest', () => {
  const existing = { videos: [{ scene: 'a', seconds: 1 }, { scene: 'c', seconds: 3 }], failed: [] }
  const merged = mergeManifest(existing, { scene: 'b', seconds: 2 }, ORDER, 'now')
  assert.deepEqual(merged.videos.map((v) => v.scene), ['a', 'b', 'c'])
  assert.equal(merged.recordedAt, 'now')
})

test('a new recording replaces the old entry for that scene', () => {
  const existing = { videos: [{ scene: 'a', seconds: 1 }], failed: [] }
  const merged = mergeManifest(existing, { scene: 'a', seconds: 9 }, ORDER, 'now')
  assert.deepEqual(merged.videos, [{ scene: 'a', seconds: 9 }])
})

test('a scene that now works is no longer listed as failed', () => {
  const merged = mergeManifest({ videos: [], failed: ['a', 'b'] }, { scene: 'a', seconds: 1 }, ORDER, 'now')
  assert.deepEqual(merged.failed, ['b'])
})

test('a failed scene drops its old entry rather than claiming a stale video is good', () => {
  const existing = { videos: [{ scene: 'a', seconds: 1 }], failed: [] }
  const merged = mergeManifest(existing, { scene: 'a', failed: true }, ORDER, 'now')
  assert.deepEqual(merged.videos, [])
  assert.deepEqual(merged.failed, ['a'])
})

test('no manifest yet is fine', () => {
  const merged = mergeManifest(null, { scene: 'a', seconds: 1 }, ORDER, 'now')
  assert.deepEqual(merged.videos, [{ scene: 'a', seconds: 1 }])
  assert.deepEqual(merged.failed, [])
})

test('recording stops short of running the machine out of memory', () => {
  assert.equal(enoughMemory(MIN_FREE_BYTES), true)
  assert.equal(enoughMemory(MIN_FREE_BYTES - 1), false)
})
