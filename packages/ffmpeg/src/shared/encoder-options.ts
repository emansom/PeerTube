import { FfmpegCommand } from 'fluent-ffmpeg'
import { EncoderOptions, VideoResolution, VideoResolutionType } from '@peertube/peertube-models'
import { buildStreamSuffix } from '../ffmpeg-utils.js'

export function addDefaultEncoderGlobalParams (command: FfmpegCommand) {
  // avoid issues when transcoding some files: https://trac.ffmpeg.org/ticket/6375
  command.outputOption('-max_muxing_queue_size 1024')
         // strip all metadata
         .outputOption('-map_metadata -1')
}

export function addDefaultEncoderParams (options: {
  command: FfmpegCommand
  encoder: 'h264_vaapi' | string
  fps: number

  streamNum?: number
}) {
  const { command, encoder, fps, streamNum } = options

  if (encoder === 'libx264' || encoder === 'h264_vaapi') {
    if (fps) {
      // Keyframe interval of 2 seconds for faster seeking and resolution switching.
      // https://streaminglearningcenter.com/blogs/whats-the-right-keyframe-interval.html
      // https://superuser.com/a/908325
      command.outputOption(buildStreamSuffix('-g:v', streamNum) + ' ' + (fps * 2))
    }
  }
}

export function applyEncoderOptions (command: FfmpegCommand, options: EncoderOptions) {
  command.inputOptions(options.inputOptions ?? [])
    .outputOptions(options.outputOptions ?? [])
}

export function widthFromResolution(resolution: VideoResolutionType | Number): Number {
  switch(resolution) {
    case VideoResolution.H_4K:
      return 3840;
    case VideoResolution.H_1440P:
      return 2560;
    default:
    case VideoResolution.H_1080P:
      return 1920;
    case VideoResolution.H_720P:
      return 1280;
    case VideoResolution.H_480P:
      return 854;
    case VideoResolution.H_360P:
      return 640;
    case VideoResolution.H_240P:
      return 426;
    case VideoResolution.H_144P:
      return 256;
  }
}