import { useEffect, useRef, useState } from 'react'
import './App.css'
import ParserWorker from './parser.worker?worker'
import WaterfallCanvas from './components/WaterfallCanvas'

interface BandHeader {
  band_id: string
  band_start: number
  band_end: number
  timestamp: string
  sent_at: number
  length: number
  precision: string
}

interface ParsedFrame {
  header: BandHeader[]
  bands: Record<string, Uint8Array | Uint16Array | Float32Array>
}

const WS_URL = 'ws://localhost:8000/ws'
const ROLLING_WINDOW = 20

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export default function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [frame, setFrame] = useState<ParsedFrame | null>(null)
  const [frameCount, setFrameCount] = useState(0)
  const [avgDelivery, setAvgDelivery] = useState(0)
  const [avgParse, setAvgParse] = useState(0)
  const [avgPush, setAvgPush] = useState(0)
  const [avgRender, setAvgRender] = useState(0)
  const deliveryWindow = useRef<number[]>([])
  const parseWindow    = useRef<number[]>([])
  const pushWindow     = useRef<number[]>([])
  const renderWindow   = useRef<number[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    const worker = new ParserWorker()
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<{ frame: ParsedFrame; deliveryMs: number; parseMs: number }>) => {
      const { frame, deliveryMs, parseMs } = e.data

      const dw = [...deliveryWindow.current, deliveryMs].slice(-ROLLING_WINDOW)
      const pw = [...parseWindow.current, parseMs].slice(-ROLLING_WINDOW)
      deliveryWindow.current = dw
      parseWindow.current = pw

      setFrame(frame)
      setFrameCount(n => n + 1)
      setAvgDelivery(avg(dw))
      setAvgParse(avg(pw))
    }

    function connect() {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => setStatus('connected')
      ws.onclose = () => {
        setStatus('disconnected')
        setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = ({ data }) => {
        const buffer = data as ArrayBuffer
        worker.postMessage({ buffer, receivedAt: Date.now() }, [buffer])
      }
    }

    connect()

    return () => {
      wsRef.current?.close()
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
          <span className="metric-note">rolling {ROLLING_WINDOW}-frame window · parse measured on dedicated thread</span>
        </div>
      )}

      {frame ? (
        <WaterfallCanvas frame={frame} onMetrics={(pushMs, renderMs) => {
          const pw = [...pushWindow.current,   pushMs  ].slice(-ROLLING_WINDOW)
          const rw = [...renderWindow.current, renderMs].slice(-ROLLING_WINDOW)
          pushWindow.current   = pw
          renderWindow.current = rw
          setAvgPush(avg(pw))
          setAvgRender(avg(rw))
        }} />
      ) : (
        <p className="waiting">Waiting for data…</p>
      )}
    </div>
  )
}
