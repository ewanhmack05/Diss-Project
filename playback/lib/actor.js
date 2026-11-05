import { expect } from 'playwright/test'
import { region } from './pixels.js'
import { easedPath, pathThrough, sliderX, stepsFor } from './motion.js'

const STEP_MS = 14

// Side by side, the map right of the panels, clear of the overview, captions and toasts.
const REMOTE_CLIP = { x: 500, y: 60, width: 320, height: 590 }

// One person in a video. Everything goes through the real mouse and keyboard,
// moved at a speed you can follow, so a video shows what using the app is
// actually like - a broken control fails the scene rather than being skipped.
export class Actor {
  constructor(page, name, shown = new Set()) {
    this.page = page
    this.name = name
    this.shown = shown
    this.others = []
    this.at = { x: 400, y: 300 }
    this.tilesInFlight = 0
    this.lastTileAt = 0
    page.on('request', (request) => {
      if (request.url().includes('/tiler/')) {
        this.tilesInFlight++
        this.lastTileAt = Date.now()
      }
    })
    const done = (request) => {
      if (request.url().includes('/tiler/')) {
        this.tilesInFlight = Math.max(0, this.tilesInFlight - 1)
        this.lastTileAt = Date.now()
      }
    }
    page.on('requestfinished', done)
    page.on('requestfailed', done)
  }

  // Called once a scene has checked this feature worked. Goes in the manifest.
  did(feature) {
    this.shown.add(feature)
  }

  pause(ms = 700) {
    return this.page.waitForTimeout(ms)
  }

  // Side by side, a caption left up reads as if it's still happening, so one
  // person's clears the other's. keepOthers is for saying two things at once.
  async caption(text, holdMs = 1100, { keepOthers = false } = {}) {
    await this.page.evaluate((value) => window.__playbackCaption?.(value), text)
    if (!keepOthers) {
      // Their page may be part way through loading - nothing to clear then.
      await Promise.all(
        this.others.map((other) => other.page.evaluate(() => window.__playbackCaption?.('')).catch(() => {}))
      )
    }
    await this.pause(holdMs)
  }

  async pixels(area) {
    return region(await this.page.screenshot(), area)
  }

  // Runs the action, then waits for this person's map to change. It's a canvas,
  // so pixels are the only way to tell what reached their screen.
  async seesChange(action, clip = REMOTE_CLIP) {
    await this.tiles()
    await this.pause(450)
    const before = await this.pixels(clip)
    await action()
    await expect.poll(async () => !before.equals(await this.pixels(clip)), { timeout: 8000 }).toBe(true)
  }

  // The other way - something this person shouldn't see.
  async seesNoChange(action, clip = REMOTE_CLIP) {
    await this.tiles()
    await this.pause(450)
    const before = await this.pixels(clip)
    await action()
    await this.pause(600)
    expect(before.equals(await this.pixels(clip))).toBe(true)
  }

  zoomLevel() {
    return this.page.locator('.ol-overviewmap-zoom').textContent()
  }

  // Waits for the slide's tiles, so a video doesn't show them still arriving.
  async tiles(maxMs = 8000) {
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      if (this.tilesInFlight === 0 && Date.now() - this.lastTileAt > 500) return
      await this.page.waitForTimeout(100)
    }
  }

  async moveTo(point) {
    for (const step of easedPath(this.at, point, stepsFor(this.at, point))) {
      await this.page.mouse.move(step.x, step.y)
      await this.page.waitForTimeout(STEP_MS)
    }
    this.at = point
  }

  async center(locator) {
    await locator.waitFor({ state: 'visible' })
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error(`Nothing to click for ${locator}`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  async clickAt(point, holdMs = 90) {
    await this.moveTo(point)
    await this.page.mouse.down()
    await this.page.waitForTimeout(holdMs)
    await this.page.mouse.up()
  }

  async settled(locator, point) {
    const first = await this.center(locator)
    if (Math.hypot(first.x - point.x, first.y - point.y) < 2) {
      await this.page.waitForTimeout(40)
      const again = await this.center(locator)
      if (Math.hypot(again.x - point.x, again.y - point.y) < 2) return point
    }
    await this.page.waitForTimeout(450)
    return this.center(locator)
  }

  // The mouse hits whatever's on top, so check that's the thing meant - two
  // panels overlapping would otherwise click the wrong one without saying so.
  async click(locator, afterMs = 450) {
    let point = await this.center(locator)
    await this.moveTo(point)
    // Some things move when the pointer gets there, like the overview map growing.
    const settled = await this.settled(locator, point)
    if (settled !== point) {
      point = settled
      await this.moveTo(point)
    }
    const onTop = await locator.evaluate((element, { x, y }) => {
      const hit = document.elementFromPoint(x, y)
      return element === hit || element.contains(hit) || (hit !== null && hit.contains(element))
    }, point)
    if (!onTop) throw new Error(`Something's covering ${locator}`)
    await this.clickAt(point)
    await this.pause(afterMs)
  }

  button(name, within = this.page) {
    return within.getByRole('button', { name, exact: true })
  }

  async press(name, within) {
    await this.click(this.button(name, within))
  }

  async hover(locator) {
    await this.moveTo(await this.center(locator))
  }

  async tool(title) {
    await this.click(this.page.locator(`[title="${title}"]`), 700)
  }

  panel(title) {
    return this.page.locator('.draggable-panel').filter({
      has: this.page.locator('.draggable-panel-title', { hasText: new RegExp(`^${title}$`) }),
    })
  }

  async type(locator, text, delay = 45) {
    await this.click(locator, 150)
    await this.page.keyboard.type(text, { delay })
    await this.pause(250)
  }

  async choose(locator, value) {
    await this.moveTo(await this.center(locator))
    await this.pause(200)
    await locator.selectOption(value)
    await this.pause(400)
  }

  // Follows the points with the button held, for drawing and dragging.
  async drag(points, { stepsEach = 6, stepMs = STEP_MS } = {}) {
    await this.moveTo(points[0])
    await this.page.mouse.down()
    await this.page.waitForTimeout(90)
    for (const step of pathThrough(points, stepsEach)) {
      await this.page.mouse.move(step.x, step.y)
      await this.page.waitForTimeout(stepMs)
    }
    await this.page.waitForTimeout(90)
    await this.page.mouse.up()
    this.at = points.at(-1)
    await this.pause(350)
  }

  async slide(locator, value) {
    const box = await locator.boundingBox()
    const { min, max, now } = await locator.evaluate((input) => ({
      min: Number(input.min),
      max: Number(input.max),
      now: Number(input.value),
    }))
    const y = box.y + box.height / 2
    await this.drag([{ x: sliderX(box, min, max, now), y }, { x: sliderX(box, min, max, value), y }], { stepsEach: 16 })
  }

  async zoomAt(point, ticks) {
    const from = await this.zoomLevel()
    await this.moveTo(point)
    for (let i = 0; i < Math.abs(ticks); i++) {
      await this.page.mouse.wheel(0, ticks > 0 ? -240 : 240)
      await this.page.waitForTimeout(420)
    }
    // Every scene after this relies on being zoomed in, so a scroll that did
    // nothing has to fail here rather than carry on looking fine.
    await expect.poll(() => this.zoomLevel()).not.toBe(from)
    await this.pause(300)
    await this.tiles()
  }
}
