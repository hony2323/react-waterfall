import { useEffect, useRef, useState } from 'react'
import './App.css'
import ParserWorker from './parser.worker?worker'
import { WaterfallCanvas } from 'waterfall-canvas/react'
import { interpolateTurbo, type ParsedFrame } from 'waterfall-canvas'

// Inferno: black → deep purple → red → yellow (matplotlib inferno palette)
function interpolateInferno(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  const stops: [number, number, number, number][] = [
    [0.00,   0,   0,   4],
    [0.25,  86,  16, 110],
    [0.50, 187,  55,  84],
    [0.75, 249, 140,   9],
    [1.00, 252, 255, 164],
  ]
  let i = 1
  while (i < stops.length - 1 && stops[i][0] < t) i++
  const [t0, r0, g0, b0] = stops[i - 1]
  const [t1, r1, g1, b1] = stops[i]
  const u = (t - t0) / (t1 - t0)
  return [Math.round(r0 + u * (r1 - r0)), Math.round(g0 + u * (g1 - g0)), Math.round(b0 + u * (b1 - b0))]
}
import type { WaterfallCanvasHandle } from 'waterfall-canvas/react'

const WS_URL = 'ws://localhost:8000/ws'
const ROLLING_WINDOW = 20

const freqFormat = (hz: number) =>
  hz >= 1e6  ? (hz / 1e6).toFixed(4)  + ' MHz' :
  hz >= 1e3  ? (hz / 1e3).toFixed(2)  + ' kHz' :
               hz.toFixed(0)           + ' Hz'
const valueFormat = (t: number) => (t * 100).toFixed(1) + ' dBr'

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export default function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [hasFrame, setHasFrame] = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const waterfallRef = useRef<WaterfallCanvasHandle>(null)
  const [avgDelivery, setAvgDelivery] = useState(0)
  const [avgParse, setAvgParse] = useState(0)
  const [avgPush, setAvgPush] = useState(0)
  const [avgRender, setAvgRender] = useState(0)
  const [isLazy, setIsLazy] = useState(false)
  const [rowHeight, setRowHeight] = useState(1)
  const [binCounts, setBinCounts] = useState<Record<string, number>>({})
  const [contrast, setContrast] = useState(1.5)
  const [sensitivity, setSensitivity] = useState(0.7)
  const deliveryWindow = useRef<number[]>([])
  const parseWindow    = useRef<number[]>([])
  const pushWindow     = useRef<number[]>([])
  const renderWindow   = useRef<number[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    let active = true
    const worker = new ParserWorker()
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<{ frame: ParsedFrame; deliveryMs: number; parseMs: number }>) => {
      const { frame, deliveryMs, parseMs } = e.data

      waterfallRef.current?.push(frame)

      setBinCounts(Object.fromEntries(Object.entries(frame.bands).map(([id, arr]) => [id, arr.length])))

      const dw = [...deliveryWindow.current, deliveryMs].slice(-ROLLING_WINDOW)
      const pw = [...parseWindow.current, parseMs].slice(-ROLLING_WINDOW)
      deliveryWindow.current = dw
      parseWindow.current = pw

      setHasFrame(true)
      setFrameCount(n => n + 1)
      setAvgDelivery(avg(dw))
      setAvgParse(avg(pw))
    }

    function connect() {
      if (!active) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => { if (active) setStatus('connected') }
      ws.onclose = () => {
        if (!active) return
        setStatus('disconnected')
        setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = ({ data }) => {
        if (!active) return
        const buffer = data as ArrayBuffer
        worker.postMessage({ buffer, receivedAt: Date.now() }, [buffer])
      }
    }

    connect()

    return () => {
      active = false
      if (wsRef.current) {
        const ws = wsRef.current
        ws.onclose   = null
        ws.onerror   = null
        ws.onmessage = null
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws.close()
        } else {
          ws.close()
        }
      }
      worker.terminate()
    }
  }, [])

  const statusColor = { connecting: '#f59e0b', connected: '#22c55e', disconnected: '#ef4444' }[status]

  return (
    <div className="app">
      <header>
        <h1>Waterfall Receiver</h1>
        <div className="status">
          <span className="dot" style={{ background: statusColor }} />
          {status}{status === 'connected' && ` · frame #${frameCount}`}
        </div>
      </header>

      {status === 'connected' && frameCount > 0 && (
        <div className="metrics-bar">
          <div className="metric">
            <span className="metric-label">avg delivery</span>
            <span className="metric-value">{avgDelivery.toFixed(1)} ms</span>
          </div>
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">avg parse</span>
            <span className="metric-value">{avgParse.toFixed(2)} ms</span>
          </div>
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">avg push</span>
            <span className="metric-value">{avgPush.toFixed(2)} ms</span>
          </div>
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">avg render</span>
            <span className="metric-value">{avgRender.toFixed(2)} ms</span>
          </div>
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">render mode</span>
            <span className="metric-value" style={{ color: isLazy ? '#f59e0b' : '#22c55e' }}>
              {isLazy ? 'lazy' : 'precise'}
            </span>
          </div>
          <div className="metric-divider" />
          {Object.entries(binCounts).map(([id, count]) => (
            <div className="metric" key={id}>
              <span className="metric-label">{id} bins</span>
              <span className="metric-value">{count}</span>
            </div>
          ))}
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">line height</span>
            <div className="metric-slider-row">
              <input type="range" min={1} max={8} value={rowHeight} onChange={e => setRowHeight(Number(e.target.value))} />
              <span className="metric-value">{rowHeight}px</span>
            </div>
          </div>
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">sensitivity</span>
            <div className="metric-slider-row">
              <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} />
              <span className="metric-value">{sensitivity.toFixed(2)}</span>
            </div>
          </div>
          <div className="metric-divider" />
          <div className="metric">
            <span className="metric-label">contrast</span>
            <div className="metric-slider-row">
              <input type="range" min={0.1} max={2} step={0.05} value={contrast} onChange={e => setContrast(Number(e.target.value))} />
              <span className="metric-value">{contrast.toFixed(2)}</span>
            </div>
          </div>
          <div className="metric-divider" />
          <button className="export-btn" onClick={() => waterfallRef.current?.exportImage({ format: 'bmp' })}>export BMP</button>
        </div>
      )}

      {!hasFrame && <p className="waiting">Waiting for data…</p>}
      <WaterfallCanvas
        ref={waterfallRef}
        colorMap={interpolateTurbo}
        bufferWidth={0}
        minSpan={200}
        rowHeight={rowHeight}
        direction="top"
        tooltip
        timeBar
        // smoothPixels
        // lazyThreshold={Infinity}
        freqFormat={freqFormat}
        valueFormat={valueFormat}
        sensitivity={{ low: (1 - sensitivity) * 0.5, high: 1.0 }}
        gamma={2.1 - contrast}
        onMetrics={(pushMs, renderMs, lazy) => {
          const pw = [...pushWindow.current,   pushMs  ].slice(-ROLLING_WINDOW)
          const rw = [...renderWindow.current, renderMs].slice(-ROLLING_WINDOW)
          pushWindow.current   = pw
          renderWindow.current = rw
          setAvgPush(avg(pw))
          setAvgRender(avg(rw))
          setIsLazy(lazy)
        }}
        heightPx={hasFrame ? 400 : 0}
      />
    </div>
  )
}
