import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  SCENE_EXTENT,
  buildConnectionBuffers,
  buildNeuronBuffers,
  connectionKey,
  parseBotEvent,
  pulseIntensity,
  pulseProgress,
  toWebSocketUrl,
  travelPoint,
  type ConnectionBuffers,
  type NeuronBuffers,
} from './connectome'
import type { SeedFile } from './types'
import ConnectomeControls from './ConnectomeControls'
import './ConnectomePanel.css'

// Bot ticks every "several seconds" per its own contract, not a fixed rate -
// this only governs how fast *this panel* retries a dropped connection.
const RECONNECT_DELAY_MS = 3000

const PULSE_DURATION_MS = 250
const PATHWAY_DURATION_MS = 350

// A fixed ring of travelling-pulse slots, reused round-robin - caps how many
// synapse-travel animations can be in flight at once so a burst of pathway
// events faster than PATHWAY_DURATION_MS can't grow the scene without bound.
const MAX_TRAVELERS = 24

const POINT_BASE_SIZE = 3.2
const POINT_PULSE_BOOST = 5
const TRAVELER_RADIUS = 1.6

// Per-vertex size/colour on a point cloud needs a custom shader - stock
// PointsMaterial only supports a single uniform size for every point, which
// can't express "this one neuron is mid-pulse" without per-vertex state.
// gl_PointCoord + a soft circular falloff gives each point a small glow
// instead of a hard square sprite.
const POINT_VERTEX_SHADER = `
  attribute vec3 customColor;
  attribute float pointSize;
  varying vec3 vColor;
  void main() {
    vColor = customColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = pointSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`
const POINT_FRAGMENT_SHADER = `
  varying vec3 vColor;
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, dist);
    gl_FragColor = vec4(vColor, alpha);
  }
`

type Status = 'connecting' | 'live' | 'disconnected'

interface ActivePulse {
  start: number
}

interface ActiveHighlight {
  start: number
}

interface Traveler {
  instanceIndex: number
  start: number
  from: [number, number, number]
  to: [number, number, number]
}

interface ConnectomePanelProps {
  liveServerUrl: string
}

function ConnectomePanel({ liveServerUrl }: ConnectomePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [meta, setMeta] = useState<{ neuronCount: number; connectionCount: number } | null>(null)
  const [seedLoaded, setSeedLoaded] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    // Every dispose()-able Three.js resource this effect creates - built up
    // as the seed loads (geometries/materials don't exist before then) and
    // torn down in one pass on cleanup, rather than tracking each one under
    // its own optional variable.
    const disposables: Array<{ dispose: () => void }> = []

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000)
    camera.position.set(0, 0, SCENE_EXTENT * 1.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 40
    controls.maxDistance = SCENE_EXTENT * 6

    const resize = () => {
      const width = container.clientWidth || 1
      const height = container.clientHeight || 1
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    // Populated once /seed resolves - kept as plain closure variables rather
    // than React state, since every field here is read and mutated on every
    // animation frame and would otherwise fight React's render cycle for no
    // benefit (nothing here needs to trigger a re-render).
    let neuronBuffers: NeuronBuffers | null = null
    let connectionBuffers: ConnectionBuffers | null = null
    let pointSizeAttr: THREE.BufferAttribute | null = null
    let pointColorAttr: THREE.BufferAttribute | null = null
    let lineColorAttr: THREE.BufferAttribute | null = null
    let travelerMesh: THREE.InstancedMesh | null = null

    const activePulses = new Map<number, ActivePulse>()
    const activeHighlights = new Map<number, ActiveHighlight>()
    const travelers: Traveler[] = []
    let nextTravelerSlot = 0

    // Scratch objects reused every frame for the traveler instance matrices,
    // rather than allocating a fresh Vector3/Matrix4 per active traveler
    // per frame.
    const scratchPosition = new THREE.Vector3()
    const scratchQuaternion = new THREE.Quaternion()
    const scratchScale = new THREE.Vector3(1, 1, 1)
    const scratchMatrix = new THREE.Matrix4()
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0)

    function triggerPulse(neuronId: string) {
      const index = neuronBuffers?.indexById.get(neuronId)
      if (index === undefined) return
      activePulses.set(index, { start: performance.now() })
    }

    function triggerPathway(preId: string, postId: string) {
      if (!neuronBuffers) return
      const preIndex = neuronBuffers.indexById.get(preId)
      const postIndex = neuronBuffers.indexById.get(postId)
      if (preIndex === undefined || postIndex === undefined) return

      // The pathway may not be one of the seed's own ~3000 connections (the
      // bot draws from the full underlying dataset) - when it isn't, there's
      // no static edge to brighten, but the travelling point below still
      // makes sense on its own.
      const segmentIndex = connectionBuffers?.segmentIndexByKey.get(connectionKey(preId, postId))
      if (segmentIndex !== undefined) {
        activeHighlights.set(segmentIndex, { start: performance.now() })
      }

      const from: [number, number, number] = [
        neuronBuffers.positions[preIndex * 3],
        neuronBuffers.positions[preIndex * 3 + 1],
        neuronBuffers.positions[preIndex * 3 + 2],
      ]
      const to: [number, number, number] = [
        neuronBuffers.positions[postIndex * 3],
        neuronBuffers.positions[postIndex * 3 + 1],
        neuronBuffers.positions[postIndex * 3 + 2],
      ]

      const slot = nextTravelerSlot
      nextTravelerSlot = (nextTravelerSlot + 1) % MAX_TRAVELERS
      const existing = travelers.find((traveler) => traveler.instanceIndex === slot)
      if (existing) {
        existing.start = performance.now()
        existing.from = from
        existing.to = to
      } else {
        travelers.push({ instanceIndex: slot, start: performance.now(), from, to })
      }
    }

    let seedRetryTimer: number | null = null
    function loadSeed() {
      fetch(`${liveServerUrl}/seed`)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json() as Promise<SeedFile>
        })
        .then((seed) => {
          if (disposed) return

          neuronBuffers = buildNeuronBuffers(seed.neurons)
          connectionBuffers = buildConnectionBuffers(seed.connections, neuronBuffers.positions, neuronBuffers.indexById)

          const pointsGeometry = new THREE.BufferGeometry()
          pointsGeometry.setAttribute('position', new THREE.BufferAttribute(neuronBuffers.positions, 3))
          pointColorAttr = new THREE.BufferAttribute(neuronBuffers.colors.slice(), 3)
          pointsGeometry.setAttribute('customColor', pointColorAttr)
          pointSizeAttr = new THREE.BufferAttribute(new Float32Array(seed.neurons.length).fill(POINT_BASE_SIZE), 1)
          pointsGeometry.setAttribute('pointSize', pointSizeAttr)

          const pointsMaterial = new THREE.ShaderMaterial({
            vertexShader: POINT_VERTEX_SHADER,
            fragmentShader: POINT_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
          scene.add(new THREE.Points(pointsGeometry, pointsMaterial))
          disposables.push(pointsGeometry, pointsMaterial)

          const lineGeometry = new THREE.BufferGeometry()
          lineGeometry.setAttribute('position', new THREE.BufferAttribute(connectionBuffers.positions, 3))
          lineColorAttr = new THREE.BufferAttribute(connectionBuffers.colors.slice(), 3)
          lineGeometry.setAttribute('color', lineColorAttr)
          const lineMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.35,
          })
          scene.add(new THREE.LineSegments(lineGeometry, lineMaterial))
          disposables.push(lineGeometry, lineMaterial)

          const travelerGeometry = new THREE.SphereGeometry(TRAVELER_RADIUS, 8, 8)
          const travelerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
          travelerMesh = new THREE.InstancedMesh(travelerGeometry, travelerMaterial, MAX_TRAVELERS)
          for (let i = 0; i < MAX_TRAVELERS; i++) travelerMesh.setMatrixAt(i, hiddenMatrix)
          travelerMesh.instanceMatrix.needsUpdate = true
          scene.add(travelerMesh)
          disposables.push(travelerGeometry, travelerMaterial)

          setMeta({ neuronCount: seed.meta.neuronCount, connectionCount: seed.meta.connectionCount })
          setSeedLoaded(true)
        })
        .catch(() => {
          if (disposed) return
          seedRetryTimer = window.setTimeout(loadSeed, RECONNECT_DELAY_MS)
        })
    }
    loadSeed()

    let ws: WebSocket | null = null
    let wsRetryTimer: number | null = null

    function connectWebSocket() {
      setStatus((current) => (current === 'live' ? current : 'connecting'))
      const socket = new WebSocket(toWebSocketUrl(liveServerUrl))
      ws = socket

      socket.onopen = () => {
        if (disposed) return
        setStatus('live')
      }

      socket.onmessage = (event) => {
        if (disposed || typeof event.data !== 'string') return
        const botEvent = parseBotEvent(event.data)
        if (!botEvent) return
        if (botEvent.type === 'pathway') {
          triggerPathway(botEvent.preId, botEvent.postId)
        } else {
          triggerPulse(botEvent.neuronId)
        }
      }

      // disposed is already true by the time cleanup below calls ws.close(),
      // so this only ever schedules a retry for a drop this effect didn't
      // itself cause (the bot restarting, a network blip, never having
      // connected in the first place).
      socket.onclose = () => {
        if (disposed) return
        setStatus('disconnected')
        wsRetryTimer = window.setTimeout(connectWebSocket, RECONNECT_DELAY_MS)
      }

      // onclose always follows onerror for a browser WebSocket - closing
      // explicitly here just avoids a stray unhandled error reaching the
      // console; the actual retry is scheduled in onclose above.
      socket.onerror = () => {
        socket.close()
      }
    }
    connectWebSocket()

    let rafId = 0
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      controls.update()
      const now = performance.now()

      if (pointSizeAttr && pointColorAttr && neuronBuffers && activePulses.size > 0) {
        const baseColors = neuronBuffers.colors
        for (const [index, pulse] of activePulses) {
          const progress = pulseProgress(now - pulse.start, PULSE_DURATION_MS)
          const intensity = pulseIntensity(progress)
          ;(pointSizeAttr.array as Float32Array)[index] = POINT_BASE_SIZE + intensity * POINT_PULSE_BOOST
          for (let c = 0; c < 3; c++) {
            const base = baseColors[index * 3 + c]
            ;(pointColorAttr.array as Float32Array)[index * 3 + c] = base + (1 - base) * intensity
          }
          if (progress >= 1) activePulses.delete(index)
        }
        pointSizeAttr.needsUpdate = true
        pointColorAttr.needsUpdate = true
      }

      if (lineColorAttr && connectionBuffers && activeHighlights.size > 0) {
        const baseColors = connectionBuffers.colors
        for (const [segmentIndex, highlight] of activeHighlights) {
          const progress = pulseProgress(now - highlight.start, PATHWAY_DURATION_MS)
          const intensity = pulseIntensity(progress)
          const offset = segmentIndex * 6
          for (let v = 0; v < 6; v++) {
            const base = baseColors[offset + v]
            ;(lineColorAttr.array as Float32Array)[offset + v] = base + (1 - base) * intensity
          }
          if (progress >= 1) activeHighlights.delete(segmentIndex)
        }
        lineColorAttr.needsUpdate = true
      }

      if (travelerMesh && travelers.length > 0) {
        for (let i = travelers.length - 1; i >= 0; i--) {
          const traveler = travelers[i]
          const progress = pulseProgress(now - traveler.start, PATHWAY_DURATION_MS)
          const done = progress >= 1
          if (done) {
            travelerMesh.setMatrixAt(traveler.instanceIndex, hiddenMatrix)
            travelers.splice(i, 1)
            continue
          }
          const [x, y, z] = travelPoint(traveler.from, traveler.to, progress)
          scratchPosition.set(x, y, z)
          scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
          travelerMesh.setMatrixAt(traveler.instanceIndex, scratchMatrix)
        }
        travelerMesh.instanceMatrix.needsUpdate = true
      }

      renderer.render(scene, camera)
    }
    rafId = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      if (seedRetryTimer !== null) window.clearTimeout(seedRetryTimer)
      if (wsRetryTimer !== null) window.clearTimeout(wsRetryTimer)
      ws?.close()
      controls.dispose()
      for (const disposable of disposables) disposable.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [liveServerUrl])

  return (
    <div className="connectome-panel">
      <div className="connectome-panel-canvas" ref={containerRef}>
        <div className={`connectome-panel-status connectome-panel-status--${status}`}>
          <span className="connectome-panel-status-dot" />
          {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Not connected'}
        </div>
        {meta && (
          <div className="connectome-panel-meta">
            {meta.neuronCount.toLocaleString()} neurons · {meta.connectionCount.toLocaleString()} connections
          </div>
        )}
        {!seedLoaded && <div className="connectome-panel-empty">Loading connectome data…</div>}
      </div>
      <ConnectomeControls />
    </div>
  )
}

export default ConnectomePanel
