import { logger, loggerTagsFactory } from '@server/helpers/logger'
import { YoutubeDLInfo, YoutubeDLWrapper } from '@server/helpers/youtube-dl'
import { CONFIG } from '@server/initializers/config'
import { buildYoutubeDLImport } from '@server/lib/video-import'
import { UserModel } from '@server/models/user/user'
import { VideoImportModel } from '@server/models/video/video-import'
import { MChannel, MChannelAccountDefault, MChannelSync } from '@server/types/models'
import { VideoChannelSyncState, VideoImportCreate, VideoPrivacy } from '@shared/models'
import { CreateJobArgument, JobQueue } from './job-queue'
import { ServerConfigManager } from './server-config-manager'

const lTags = loggerTagsFactory('channel-sync')

export async function synchronizeChannel (options: {
  channel: MChannelAccountDefault
  externalChannelUrl: string
  channelSync?: MChannelSync
  videosCountLimit?: number
  onlyAfter?: Date
}) {
  const { channel, externalChannelUrl, videosCountLimit, onlyAfter, channelSync } = options

  if (channelSync) {
    channelSync.state = VideoChannelSyncState.PROCESSING
    channelSync.lastSyncAt = new Date()
    await channelSync.save()
  }

  try {
    const user = await UserModel.loadByChannelActorId(channel.actorId)
    const youtubeDL = new YoutubeDLWrapper(
      externalChannelUrl,
      ServerConfigManager.Instance.getEnabledResolutions('vod'),
      CONFIG.TRANSCODING.ALWAYS_TRANSCODE_ORIGINAL_RESOLUTION
    )

    const entries = await youtubeDL.getInfoForListImport({ latestVideosCount: videosCountLimit })

    if (entries.length === 0) {
      if (channelSync) {
        channelSync.state = VideoChannelSyncState.SYNCED
        await channelSync.save()
      }

      return
    }

    const targetUrls = entries.map(item => item.webpageUrl)

    logger.info(
      'Fetched %d candidate URLs for sync channel %s.',
      entries.length, channel.Actor.preferredUsername, { targetUrls, ...lTags() }
    )

    const children: CreateJobArgument[] = []

    for (const entry of entries) {
      if (await skipImport(channel, entry.webpageUrl, onlyAfter)) continue

      const importDataOverride: Partial<VideoImportCreate> = {
        // TODO: allow configuring video privacy per channel sync
        privacy: VideoPrivacy.PUBLIC
      }

      // only override if available
      if (entry.originallyPublishedAt !== null) {
        importDataOverride.originallyPublishedAt = entry.originallyPublishedAt
      }

      const { job } = await buildYoutubeDLImport({
        user,
        channel,
        targetUrl: entry.webpageUrl,
        channelSync,
        importDataOverride
      })

      children.push(job)
    }

    // Will update the channel sync status
    const parent: CreateJobArgument = {
      type: 'after-video-channel-import',
      payload: {
        channelSyncId: channelSync?.id
      }
    }

    await JobQueue.Instance.createJobWithChildren(parent, children)
  } catch (err) {
    logger.error(`Failed to import channel ${channel.name}`, { err, ...lTags() })
    channelSync.state = VideoChannelSyncState.FAILED
    await channelSync.save()
  }
}

// ---------------------------------------------------------------------------

async function skipImport (channel: MChannel, targetUrl: string, onlyAfter?: Date) {
  if (await VideoImportModel.urlAlreadyImported(channel.id, targetUrl)) {
    logger.debug('%s is already imported for channel %s, skipping video channel synchronization.', targetUrl, channel.name, lTags())
    return true
  }

  const youtubeDL = new YoutubeDLWrapper(
    targetUrl,
    ServerConfigManager.Instance.getEnabledResolutions('vod'),
    CONFIG.TRANSCODING.ALWAYS_TRANSCODE_ORIGINAL_RESOLUTION
  )

  let videoInfo: YoutubeDLInfo
  try {
    videoInfo = await youtubeDL.getInfoForDownload()
  } catch (err) {
    logger.error(`Cannot fetch information from import for URL ${targetUrl} channel ${channel.name}, skipping import`, { err, ...lTags() })
    return true
  }

  if (onlyAfter) {
    const onlyAfterWithoutTime = new Date(onlyAfter)
    onlyAfterWithoutTime.setHours(0, 0, 0, 0)

    if (videoInfo.originallyPublishedAt.getTime() < onlyAfterWithoutTime.getTime()) {
      return true
    }
  }

  return false
}
