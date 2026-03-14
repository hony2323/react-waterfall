import { useEffect, useRef, useState } from 'react'
import './App.css'
import ParserWorker from './parser.worker?worker'

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
  bands: Record<string, number[]>
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
  const deliveryWindow = useRef<number[]>([])
  const parseWindow = useRef<number[]>([])
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
        // Transfer the buffer to the worker (zero-copy)
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
          <span className="metric-note">rolling {ROLLING_WINDOW}-frame window · parse measured on dedicated thread</span>
        </div>
      )}

      {frame ? (
        <div className="content">
          <section>
            <h2>Header</h2>
            <pre>{JSON.stringify(frame.header, null, 2)}</pre>
          </section>
          {Object.entries(frame.bands).map(([id, samples]) => (
            <section key={id}>
              <h2>{id} <span className="note">(first 16 samples)</span></h2>
              <pre>{JSON.stringify(samples, null, 2)}</pre>
            </section>
          ))}
        </div>
      ) : (
        <p className="waiting">Waiting for data…</p>
      )}
    </div>
  )
}
