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

interface WorkerResult {
  frame: ParsedFrame
  deliveryMs: number
  parseMs: number
}

const MAX_SAMPLES_SHOWN = 16

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; receivedAt: number }>) => {
  const { buffer, receivedAt } = e.data
  const parseStart = performance.now()

  const view = new DataView(buffer)
  const headerLen = view.getUint32(0)
  const header: BandHeader[] = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen))
  )

  const deliveryMs = receivedAt - (header[0]?.sent_at ?? receivedAt)

  const bands: Record<string, number[]> = {}
  let offset = 4 + headerLen

  for (const band of header) {
    let samples: number[]
    if (band.precision === 'float32') {
      samples = Array.from(new Float32Array(buffer, offset, band.length / 4))
    } else if (band.precision === 'uint16') {
      samples = Array.from(new Uint16Array(buffer, offset, band.length / 2))
    } else {
      samples = Array.from(new Uint8Array(buffer, offset, band.length))
    }
    bands[band.band_id] = samples.slice(0, MAX_SAMPLES_SHOWN)
    offset += band.length
  }

  const parseMs = performance.now() - parseStart

  const result: WorkerResult = { frame: { header, bands }, deliveryMs, parseMs }
  self.postMessage(result)
}
