import { logger } from '@server/helpers/logger'
import { YoutubeDLWrapper } from '@server/helpers/youtube-dl'
import { CONFIG } from '@server/initializers/config'
import { buildYoutubeDLImport } from '@server/lib/video-import'
import { UserModel } from '@server/models/user/user'
import { VideoImportModel } from '@server/models/video/video-import'
import { MChannel, MChannelAccountDefault, MChannelSync } from '@server/types/models'
import { VideoChannelSyncState, VideoPrivacy } from '@shared/models'
import { CreateJobArgument, JobQueue } from './job-queue'
import { lTags } from './object-storage/shared'
import { ServerConfigManager } from './server-config-manager'

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

    let targetUrls: string[]

    targetUrls = await youtubeDL.getInfoForListImport({ latestVideosCount: videosCountLimit })

    logger.info(
      'Fetched %d candidate URLs for sync channel %s.',
      targetUrls.length, channel.Actor.preferredUsername, { targetUrls }
    )

    if (targetUrls.length === 0) {
      if (channelSync) {
        channelSync.state = VideoChannelSyncState.SYNCED
        await channelSync.save()
      }

      return
    }

    const jobs: CreateJobArgument[] = []

    for (const targetUrl of targetUrls) {
      let shouldSkip: boolean

      try {
        shouldSkip = await skipImport(channel, targetUrl, onlyAfter)
      } catch (err) {
        logger.error('Failed fetching info from URL %s', { targetUrl, err, ...lTags()})
        continue
      }

      if (shouldSkip) continue

      const { job } = await buildYoutubeDLImport({
        user,
        channel,
        targetUrl,
        channelSync,
        importDataOverride: {
          privacy: VideoPrivacy.PUBLIC
        }
      })

      jobs.push(job)
    }

    if (jobs.length === 0) {
      logger.warning('Failed fetching %d target URLs, skipping import jobs', targetUrls.length, lTags())
      return
    }

    // Will update the channel sync status
    const parent: CreateJobArgument = {
      type: 'after-video-channel-import',
      payload: {
        channelSyncId: channelSync?.id
      }
    }

    await JobQueue.Instance.createJobWithChildren(parent, jobs)
  } catch (err) {
    logger.error(`Failed to import channel ${channel.name}`, { err })
    channelSync.state = VideoChannelSyncState.FAILED
    await channelSync.save()
  }
}

// ---------------------------------------------------------------------------

async function skipImport (channel: MChannel, targetUrl: string, onlyAfter?: Date): Promise<boolean> {
  if (await VideoImportModel.urlAlreadyImported(channel.id, targetUrl)) {
    logger.debug('%s is already imported for channel %s, skipping video channel synchronization.', targetUrl, channel.name)
    return true
  }

  if (onlyAfter) {
    // TODO: skip spawning new process when channel data published at is populated
    const youtubeDL = new YoutubeDLWrapper(
      targetUrl,
      ServerConfigManager.Instance.getEnabledResolutions('vod'),
      CONFIG.TRANSCODING.ALWAYS_TRANSCODE_ORIGINAL_RESOLUTION
    )

    const videoInfo = await youtubeDL.getInfoForDownload()

    const onlyAfterWithoutTime = new Date(onlyAfter)
    onlyAfterWithoutTime.setHours(0, 0, 0, 0)

    if (videoInfo.originallyPublishedAtWithoutTime.getTime() < onlyAfterWithoutTime.getTime()) {
      return true
    }
  }

  return false
}
