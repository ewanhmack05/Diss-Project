// Frame-time benchmark for the viewer's map. Paste into the browser's
// devtools console on the viewer with a slide open, then:
//
//   await mapBench()                 // pan, zoom in, zoom out - prints a table
//   await mapBench({ seconds: 5 })   // longer pans
//   await mapBench({ zoomTicks: 3 }) // zoom in less far
//
// Drives the map with synthetic pointer drags and wheel ticks on OpenLayers'
// viewport, the same events a mouse sends, and records the gap between
// animation frames while it does. 60 fps is a 16.7 ms gap. Gaps over 50 ms
// are what people notice as stutter, and long tasks are main-thread work
// over 50 ms that blocks everything, input included.
//
// On the dev server it also measures the settle cost: the main-thread time
// to redraw once the view stops moving, which is when WebGL layers rebuild
// their buffers. That needs window.viewerMap, which MapNode sets in dev
// only. viewerMap.layers also lets you turn single layers off to see what
// each costs, e.g. viewerMap.layers.annotations.setVisible(false).
//
// Zooms in and back out by the same number of wheel ticks, and the pans are
// circles, so the map ends up roughly where it started. Reload between runs anyway
// so each starts from the slide fitted to the screen. The first run after
// loading data is slower than the next - run it twice and use the second.

window.mapBench = async function mapBench({ seconds = 3, zoomTicks = 5 } = {}) {
  const viewport = document.querySelector('.ol-viewport')
  if (!viewport) throw new Error('No map on this page - open a slide first')
  const box = viewport.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const nextFrame = () => new Promise(requestAnimationFrame)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const pointer = (type, x, y, target = viewport) =>
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    }))
  const wheel = (deltaY) =>
    viewport.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY, deltaMode: 0, clientX: cx, clientY: cy,
    }))

  async function measure(name, drive) {
    const gaps = []
    const longTasks = []
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)))
    try { observer.observe({ type: 'longtask', buffered: false }) } catch { /* not supported */ }

    let running = true
    let last = await nextFrame()
    const sampler = (async () => {
      while (running) {
        const now = await nextFrame()
        gaps.push(now - last)
        last = now
      }
    })()
    await drive()
    running = false
    await sampler
    observer.disconnect()

    gaps.sort((a, b) => a - b)
    const total = gaps.reduce((sum, g) => sum + g, 0)
    const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))]
    return {
      step: name,
      fps: +(1000 * gaps.length / total).toFixed(1),
      'p50 ms': +pct(0.5).toFixed(1),
      'p95 ms': +pct(0.95).toFixed(1),
      'max ms': +gaps[gaps.length - 1].toFixed(1),
      'frames >50ms': gaps.filter((g) => g > 50).length,
      'long tasks': longTasks.length,
      'long task ms': Math.round(longTasks.reduce((sum, d) => sum + d, 0)),
    }
  }

  // A slow circle drag, one move per frame, so every frame has a new view
  // to render. Timed by the clock rather than per frame, so a slow map
  // covers the same circles in the same time. Ends back where it started
  // and holds still before letting go - a release while moving sets off
  // OpenLayers' kinetic pan, which at a low frame rate flings the map off
  // the slide.
  async function pan() {
    const start = performance.now()
    const r = Math.min(box.width, box.height) / 6
    const at = (t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)]
    pointer('pointerdown', ...at(0))
    let elapsed = 0
    while (elapsed < seconds * 1000) {
      elapsed = performance.now() - start
      pointer('pointermove', ...at(Math.min(elapsed, seconds * 1000) / 1000 * 2 * Math.PI), document)
      await nextFrame()
    }
    pointer('pointermove', ...at(0), document)
    await wait(250)
    pointer('pointerup', ...at(0), document)
    await wait(300)
  }

  // One zoom level per tick, spaced so each tick's zoom animation runs
  // into the next, like someone scrolling steadily. A fixed count rather
  // than a time, since ticks past the max or min zoom do nothing and the
  // way back out wouldn't match.
  const zoom = (deltaY) => async () => {
    for (let i = 0; i < zoomTicks; i++) {
      wheel(deltaY)
      await wait(300)
    }
    await wait(400)
  }

  // Jumps the view back and forth with no drag going on, so every frame is
  // a full settled redraw, and times OpenLayers' render on the main thread.
  async function settleCost() {
    const { map } = window.viewerMap
    const view = map.getView()
    const centre = view.getCenter()
    const step = view.getResolution() * 400
    const times = []
    let started = 0
    const pre = map.on('precompose', () => { started = performance.now() })
    const post = map.on('postcompose', () => { times.push(performance.now() - started) })
    for (let i = 0; i < 20; i++) {
      view.setCenter([centre[0] + (i % 2 ? step : -step), centre[1]])
      await nextFrame()
    }
    view.setCenter(centre)
    await wait(300)
    map.un('precompose', pre.listener)
    map.un('postcompose', post.listener)
    times.sort((a, b) => a - b)
    return { 'p50 ms': +times[times.length >> 1].toFixed(1), 'max ms': +times[times.length - 1].toFixed(1) }
  }

  const results = []
  results.push(await measure('idle', () => wait(1000)))
  results.push(await measure('pan', pan))
  results.push(await measure('zoom in', zoom(-100)))
  results.push(await measure('pan zoomed in', pan))
  results.push(await measure('zoom out', zoom(100)))
  results.push(await measure('pan back out', pan))
  if (window.viewerMap) results.push({ step: 'settle (redraw ms)', ...await settleCost() })
  console.table(results)
  return results
}
