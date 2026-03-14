import { useEffect, useRef, useState } from 'react'
import './App.css'

interface BandHeader {
  band_id: string
  band_start: number
  band_end: number
  timestamp: number
  length: number
  precision: string
}

interface ParsedFrame {
  header: BandHeader[]
  bands: Record<string, number[]>
}

const WS_URL = 'ws://localhost:8000/ws'
const MAX_SAMPLES_SHOWN = 16

function parseFrame(data: ArrayBuffer): ParsedFrame {
  const view = new DataView(data)
  const headerLen = view.getUint32(0)
  const header: BandHeader[] = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, 4, headerLen))
  )

  const bands: Record<string, number[]> = {}
  let offset = 4 + headerLen

  for (const band of header) {
    let samples: number[]
    if (band.precision === 'float32') {
      const arr = new Float32Array(data, offset, band.length / 4)
      samples = Array.from(arr)
    } else if (band.precision === 'uint16') {
      const arr = new Uint16Array(data, offset, band.length / 2)
      samples = Array.from(arr)
    } else {
      const arr = new Uint8Array(data, offset, band.length)
      samples = Array.from(arr)
    }
    bands[band.band_id] = samples.slice(0, MAX_SAMPLES_SHOWN)
    offset += band.length
  }

  return { header, bands }
}

export default function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [frame, setFrame] = useState<ParsedFrame | null>(null)
  const [frameCount, setFrameCount] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
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
        try {
          setFrame(parseFrame(data as ArrayBuffer))
          setFrameCount(n => n + 1)
        } catch (e) {
          console.error('Parse error', e)
        }
      }
    }

    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const statusColor = { connecting: '#f59e0b', connected: '#22c55e', disconnected: '#ef4444' }[status]

  return (
    <div className="app">
      <header>
        <h1>Waterfall Receiver</h1>
        <div className="status">
          <span className="dot" style={{ background: statusColor }} />
          {status} {status === 'connected' && `· frame #${frameCount}`}
        </div>
      </header>

      {frame ? (
        <div className="content">
          <section>
            <h2>Header</h2>
            <pre>{JSON.stringify(frame.header, null, 2)}</pre>
          </section>
          {Object.entries(frame.bands).map(([id, samples]) => (
            <section key={id}>
              <h2>{id} <span className="note">(first {MAX_SAMPLES_SHOWN} samples)</span></h2>
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
