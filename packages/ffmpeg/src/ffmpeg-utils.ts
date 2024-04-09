import { EncoderOptions } from '@peertube/peertube-models'

export type StreamType = 'audio' | 'video'

export function buildStreamSuffix (base: string, streamNum?: number) {
  if (streamNum !== undefined) {
    return `${base}:${streamNum}`
  }

  return base
}

export function getScaleFilter (options: EncoderOptions): string {
  if (options.scaleFilter) return options.scaleFilter.name

  return 'scale'
}

export function getScaleVAAPIFilter (options: EncoderOptions): string {
  if (options.scaleFilter) return options.scaleFilter.name

  return 'scale_vaapi'
}
