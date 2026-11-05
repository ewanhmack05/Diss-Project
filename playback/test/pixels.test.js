import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { region } from '../lib/pixels.js'

function image(width, height, paint = () => [0, 0, 0]) {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const [r, g, b] = paint(x, y)
      png.data[at] = r
      png.data[at + 1] = g
      png.data[at + 2] = b
      png.data[at + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

const AREA = { x: 2, y: 1, width: 2, height: 2 }

test('cuts out the right pixels, row by row', () => {
  const out = region(image(5, 4, (x, y) => [x, y, 9]), AREA)
  assert.deepEqual([...out], [2, 1, 9, 255, 3, 1, 9, 255, 2, 2, 9, 255, 3, 2, 9, 255])
})

test('a change inside the area shows', () => {
  const before = region(image(5, 4), AREA)
  const after = region(image(5, 4, (x, y) => (x === 3 && y === 2 ? [1, 0, 0] : [0, 0, 0])), AREA)
  assert.equal(before.equals(after), false)
})

test('a change outside it doesn\'t, so a caption or toast can\'t pass a check', () => {
  const before = region(image(5, 4), AREA)
  const after = region(image(5, 4, (x, y) => (x === 0 || y === 3 ? [255, 255, 255] : [0, 0, 0])), AREA)
  assert.equal(before.equals(after), true)
})

test('an area off the edge of the screenshot is an error, not a short compare', () => {
  assert.throws(() => region(image(5, 4), { x: 4, y: 0, width: 2, height: 2 }), /outside/)
  assert.throws(() => region(image(5, 4), { x: 0, y: 3, width: 2, height: 2 }), /outside/)
})

test('nothing asks the browser for a clipped screenshot - it flashes grey on video', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const files = [
    join(root, 'record.js'),
    ...['lib', 'scenes'].flatMap((dir) =>
      readdirSync(join(root, dir)).filter((file) => file.endsWith('.js')).map((file) => join(root, dir, file))
    ),
  ]
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /screenshot\(\s*\{[^}]*clip/, file)
  }
})
