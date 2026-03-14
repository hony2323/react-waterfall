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

interface WorkerResult {
  frame: ParsedFrame
  deliveryMs: number
  parseMs: number
}

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; receivedAt: number }>) => {
  const { buffer, receivedAt } = e.data
  const parseStart = performance.now()

  const view = new DataView(buffer)
  const headerLen = view.getUint32(0)
  const header: BandHeader[] = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen))
  )

  const deliveryMs = receivedAt - (header[0]?.sent_at ?? receivedAt)

  const bands: Record<string, Uint8Array | Uint16Array | Float32Array> = {}
  const transferables: ArrayBuffer[] = []
  let offset = 4 + headerLen

  for (const band of header) {
    let typed: Uint8Array | Uint16Array | Float32Array
    if (band.precision === 'float32') {
      typed = new Float32Array(buffer, offset, band.length / 4).slice()
    } else if (band.precision === 'uint16') {
      typed = new Uint16Array(buffer, offset, band.length / 2).slice()
    } else {
      typed = new Uint8Array(buffer, offset, band.length).slice()
    }
    bands[band.band_id] = typed
    transferables.push(typed.buffer)
    offset += band.length
  }

  const parseMs = performance.now() - parseStart

  const result: WorkerResult = { frame: { header, bands }, deliveryMs, parseMs }
  self.postMessage(result, transferables)
}
