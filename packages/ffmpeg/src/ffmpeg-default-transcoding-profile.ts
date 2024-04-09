import { getAverageTheoreticalBitrate, getMaxTheoreticalBitrate, getMinTheoreticalBitrate } from '@peertube/peertube-core-utils'
import {
  buildStreamSuffix,
  getAudioStream,
  getMaxAudioBitrate,
  getVideoStream,
  getVideoStreamBitrate,
  getVideoStreamDimensionsInfo,
  getVideoStreamFPS
} from '@peertube/peertube-ffmpeg'
import { EncoderOptionsBuilder, EncoderOptionsBuilderParams } from '@peertube/peertube-models'
import { FfprobeData } from 'fluent-ffmpeg'

const defaultSoftwareH264VODOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { fps, inputRatio, inputBitrate, resolution } = options

  const targetBitrate = getTargetBitrate({ inputBitrate, ratio: inputRatio, fps, resolution })

  return {
    outputOptions: [
      ...getCommonSoftwareH264OutputOptions(targetBitrate),

      `-r ${fps}`
    ]
  }
}

const defaultSoftwareH264LiveOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { streamNum, fps, inputBitrate, inputRatio, resolution } = options

  const targetBitrate = getTargetBitrate({ inputBitrate, ratio: inputRatio, fps, resolution })

  return {
    outputOptions: [
      ...getCommonSoftwareH264OutputOptions(targetBitrate, streamNum),

      `${buildStreamSuffix('-r:v', streamNum)} ${fps}`,
      `${buildStreamSuffix('-b:v', streamNum)} ${targetBitrate}`
    ]
  }
}

// DRI_PRIME=1 LIBVA_DRIVER_NAME=i965
// ffmpeg
// -hwaccel vaapi
// -hwaccel_device /dev/dri/renderD128
// -i Paffie\ met\ PoppenCast\ \#75\  ｜\ Meet\ maten\ met\ Mate\ \[qtSyIh1vy68\].mkv
// -threads 8
// -c:v h264_vaapi
// -qp 18
// -vf 'hwupload,scale_vaapi=w=1920:h=1080:format=nv12'
// -g:v 60
// -movflags +faststart
// -c:a libfdk_aac
// -b:a 384k
// -filter:a 'loudnorm=I=-13:LRA=20:TP=-2' paffie-75-1080p-QP18-aac-libfdk-384k.mp4

const defaultAcceleratedH264VODOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { fps } = options

  return {
    outputOptions: [
      '-qp 18',
      `-r ${fps}`,
    ]
  }
}

const defaultAcceleratedH264LiveOptionsBuilder: EncoderOptionsBuilder = (options: EncoderOptionsBuilderParams) => {
  const { streamNum, fps, inputBitrate, inputRatio, resolution } = options

  const targetBitrate = getTargetBitrate({ inputBitrate, ratio: inputRatio, fps, resolution })

  return {
    outputOptions: [
      ...getCommonAcceleratedH264OutputOptions(targetBitrate, streamNum),

      `${buildStreamSuffix('-r:v', streamNum)} ${fps}`,
      `${buildStreamSuffix('-b:v', streamNum)} ${targetBitrate}`
    ]
  }
}

const defaultAACOptionsBuilder: EncoderOptionsBuilder = async ({ input, streamNum, canCopyAudio, inputProbe }) => {
  const parsedAudio = await getAudioStream(input, inputProbe)

  // We try to reduce the ceiling bitrate by making rough matches of bitrates
  // Of course this is far from perfect, but it might save some space in the end

  const audioCodecName = parsedAudio.audioStream['codec_name']
  const bitrate = getMaxAudioBitrate(audioCodecName, parsedAudio.bitrate)

  // Force stereo as it causes some issues with HLS playback in Chrome
  const base = [ '-channel_layout', 'stereo' ]

  if (bitrate !== -1) {
    return { outputOptions: base.concat([ buildStreamSuffix('-b:a', streamNum), bitrate + 'k' ]) }
  }

  return { outputOptions: base }
}

const defaultLibFDKAACVODOptionsBuilder: EncoderOptionsBuilder = ({ streamNum }) => {
  return { outputOptions: [ buildStreamSuffix('-vbr', streamNum), '5', buildStreamSuffix('-af', streamNum), 'loudnorm=I=-13:LRA=20:TP=-2' ] }
}

export function getDefaultAvailableEncoders () {
  return {
    vod: {
      h264_vaapi: {
        default: defaultAcceleratedH264VODOptionsBuilder
      },
      libx264: {
        default: defaultSoftwareH264VODOptionsBuilder
      },
      aac: {
        default: defaultAACOptionsBuilder
      },
      libfdk_aac: {
        default: defaultLibFDKAACVODOptionsBuilder
      }
    },
    live: {
      h264_vaapi: {
        default: defaultAcceleratedH264LiveOptionsBuilder
      },
      libx264: {
        default: defaultSoftwareH264LiveOptionsBuilder
      },
      aac: {
        default: defaultAACOptionsBuilder
      },
      libfdk_aac: {
        default: defaultLibFDKAACVODOptionsBuilder
      }
    }
  }
}

export function getDefaultEncodersToTry () {
  return {
    vod: {
      video: [ 'h264_vaapi', 'libx264' ],
      audio: [ 'libfdk_aac', 'aac' ]
    },

    live: {
      video: [ 'h264_vaapi', 'libx264' ],
      audio: [ 'libfdk_aac', 'aac' ]
    }
  }
}

export async function canDoQuickAudioTranscode (path: string, probe?: FfprobeData): Promise<boolean> {
  const parsedAudio = await getAudioStream(path, probe)

  if (!parsedAudio.audioStream) {
    return true
  }

  if (parsedAudio.audioStream['codec_name'] !== 'aac') {
    return false
  }

  const audioBitrate = parsedAudio.bitrate
  if (!audioBitrate) {
    return false
  }

  const maxAudioBitrate = getMaxAudioBitrate('aac', audioBitrate)

  if (maxAudioBitrate !== -1 && audioBitrate > maxAudioBitrate) {
    return false
  }

  const channelLayout = parsedAudio.audioStream['channel_layout']

  // Causes playback issues with Chrome
  if (!channelLayout || channelLayout === 'unknown' || channelLayout === 'quad') {
    return false
  }

  return true
}

export async function canDoQuickVideoTranscode (path: string, probe?: FfprobeData): Promise<boolean> {
  const videoStream = await getVideoStream(path, probe)
  const fps = await getVideoStreamFPS(path, probe)
  const bitRate = await getVideoStreamBitrate(path, probe)
  const resolutionData = await getVideoStreamDimensionsInfo(path, probe)

  // If ffprobe did not manage to guess the bitrate
  if (!bitRate) return false

  // check video params
  if (!videoStream) return false
  if (videoStream['codec_name'] !== 'h264') return false
  if (videoStream['pix_fmt'] !== 'yuv420p') return false
  if (fps < 2 || fps > 65) return false
  if (bitRate > getMaxTheoreticalBitrate({ ...resolutionData, fps })) return false

  return true
}

// ---------------------------------------------------------------------------

function getTargetBitrate (options: {
  inputBitrate: number
  resolution: number
  ratio: number
  fps: number
}) {
  const { inputBitrate, resolution, ratio, fps } = options

  const capped = capBitrate(inputBitrate, getAverageTheoreticalBitrate({ resolution, fps, ratio }))
  const limit = getMinTheoreticalBitrate({ resolution, fps, ratio })

  return Math.max(limit, capped)
}

function capBitrate (inputBitrate: number, targetBitrate: number) {
  if (!inputBitrate) return targetBitrate

  // Add 30% margin to input bitrate
  const inputBitrateWithMargin = inputBitrate + (inputBitrate * 0.3)

  return Math.min(targetBitrate, inputBitrateWithMargin)
}

// TODO: two-pass H264 for regular VOD, single-pass for live
function getCommonSoftwareH264OutputOptions (targetBitrate: number, streamNum?: number) {
  return [
    // TODO: make -preset and -tune configurable
    // To allow the server administrator to prefer quality vs encoding speed
    '-preset ultrafast',
    '-tune zerolatency',

    `${buildStreamSuffix('-maxrate:v', streamNum)} ${targetBitrate}`,
    `${buildStreamSuffix('-bufsize:v', streamNum)} ${targetBitrate * 2}`,

    // NOTE: b-strategy 1 - heuristic algorithm, 16 is optimal B-frames for it
    '-b_strategy 1',
    // NOTE: Why 16: https://github.com/Chocobozzz/PeerTube/pull/774. b-strategy 2 -> B-frames<16
    '-bf 16'
  ]
}

// // TODO: two-pass VP9 for regular VOD, single-pass for live
// function getCommonSoftwareVP9OutputOptions (targetBitrate: number, streamNum?: number) {
//   return [
//     // TODO: make -preset and -tune configurable
//     // To allow the server administrator to prefer quality vs encoding speed
//     '-deadline realtime',
//     '-row-mt 1 ',

//     `${buildStreamSuffix('-maxrate:v', streamNum)} ${targetBitrate}`,
//     `${buildStreamSuffix('-bufsize:v', streamNum)} ${targetBitrate * 2}`,

//     // NOTE: b-strategy 1 - heuristic algorithm, 16 is optimal B-frames for it
//     '-b_strategy 1',
//     // NOTE: Why 16: https://github.com/Chocobozzz/PeerTube/pull/774. b-strategy 2 -> B-frames<16
//     '-bf 16'
//   ]
// }

function getCommonAcceleratedH264OutputOptions (targetBitrate: number, streamNum?: number) {
  return [
    `${buildStreamSuffix('-maxrate:v', streamNum)} ${targetBitrate}`,
    `${buildStreamSuffix('-bufsize:v', streamNum)} ${targetBitrate * 2}`
  ]
}
