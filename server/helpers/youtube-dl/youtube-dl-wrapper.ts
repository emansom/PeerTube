import { move, pathExists, readdir, remove } from 'fs-extra'
import { dirname, join } from 'path'
import { inspect } from 'util'
import { CONFIG } from '@server/initializers/config'
import { isVideoFileExtnameValid } from '../custom-validators/videos'
import { logger, loggerTagsFactory } from '../logger'
import { generateVideoImportTmpPath } from '../utils'
import { YoutubeDLCLI, YoutubeDLCLIResult } from './youtube-dl-cli'
import { YoutubeDLInfo, YoutubeDLInfoBuilder } from './youtube-dl-info-builder'
import { YoutubeDLListBuilder } from './youtube-dl-list-builder'
import { YoutubeDLSubs } from './youtube-dl-subs'
import { YoutubeDLIsLiveError, YoutubeDLNoFormatsError, YoutubeDLNoInfoError } from './youtube-dl-errors'

const lTags = loggerTagsFactory('youtube-dl')

const processOptions = {
  maxBuffer: 1024 * 1024 * 30 // 30MB
}

class YoutubeDLWrapper {

  constructor (
    private readonly url: string,
    private readonly enabledResolutions: number[],
    private readonly useBestFormat: boolean
  ) {

  }

  async getInfoForDownload (youtubeDLArgs: string[] = []): Promise<YoutubeDLInfo> {
    const youtubeDL = await YoutubeDLCLI.safeGet()

    const info = await youtubeDL.getInfo({
      url: this.url,
      format: YoutubeDLCLI.getYoutubeDLVideoFormat(this.enabledResolutions, this.useBestFormat),
      additionalYoutubeDLArgs: youtubeDLArgs,
      processOptions
    }) as YoutubeDLCLIResult

    if (!info) throw new YoutubeDLNoInfoError(this.url)

    const builder = new YoutubeDLInfoBuilder(info)
    const serializedInfo = builder.getInfo()

    if (serializedInfo.isLive === true) {
      throw new YoutubeDLIsLiveError(serializedInfo.webpageUrl)
    }

    if (serializedInfo.formats.length === 0) {
      throw new YoutubeDLNoFormatsError(serializedInfo.webpageUrl)
    }

    return serializedInfo
  }

  async getInfoForListImport (options: {
    latestVideosCount?: number
  }): Promise<string[]> {
    const youtubeDL = await YoutubeDLCLI.safeGet()

    const list = await youtubeDL.getListInfo({
      url: this.url,
      latestVideosCount: options.latestVideosCount,
      processOptions
    }) as YoutubeDLCLIResult[]

    if (list.length === 0) throw new Error(`YoutubeDL could not get info from ${this.url}`)

    if (!Array.isArray(list)) throw new Error(`YoutubeDL could not get list info from ${this.url}: ${inspect(list)}`)

    const builder = new YoutubeDLListBuilder(list)
    const serializedList = builder.getList()

    const filteredList = this.filterUnavailable(serializedList)

    return filteredList.map(info => info.webpageUrl)
  }

  async getSubtitles (): Promise<YoutubeDLSubs> {
    const cwd = CONFIG.STORAGE.TMP_DIR

    const youtubeDL = await YoutubeDLCLI.safeGet()

    const files = await youtubeDL.getSubs({ url: this.url, format: 'vtt', processOptions: { cwd } })
    if (!files) return []

    logger.debug('Get subtitles from youtube dl.', { url: this.url, files, ...lTags() })

    const subtitles = files.reduce((acc, filename) => {
      const matched = filename.match(/\.([a-z]{2})(-[a-z]+)?\.(vtt|ttml)/i)
      if (!matched || !matched[1]) return acc

      return [
        ...acc,
        {
          language: matched[1],
          path: join(cwd, filename),
          filename
        }
      ]
    }, [])

    return subtitles
  }

  async downloadVideo (fileExt: string, timeout: number): Promise<string> {
    // Leave empty the extension, youtube-dl will add it
    const pathWithoutExtension = generateVideoImportTmpPath(this.url, '')

    logger.info('Importing youtubeDL video %s to %s', this.url, pathWithoutExtension, lTags())

    const youtubeDL = await YoutubeDLCLI.safeGet()

    try {
      await youtubeDL.download({
        url: this.url,
        format: YoutubeDLCLI.getYoutubeDLVideoFormat(this.enabledResolutions, this.useBestFormat),
        output: pathWithoutExtension,
        timeout,
        processOptions
      })

      // If youtube-dl did not guess an extension for our file, just use .mp4 as default
      if (await pathExists(pathWithoutExtension)) {
        await move(pathWithoutExtension, pathWithoutExtension + '.mp4')
      }

      return this.guessVideoPathWithExtension(pathWithoutExtension, fileExt)
    } catch (err) {
      this.guessVideoPathWithExtension(pathWithoutExtension, fileExt)
        .then(path => {
          logger.debug('Error in youtube-dl import, deleting file %s.', path, { err, ...lTags() })

          return remove(path)
        })
        .catch(innerErr => logger.error('Cannot remove file in youtubeDL error.', { innerErr, ...lTags() }))

      throw err
    }
  }

  private async guessVideoPathWithExtension (tmpPath: string, sourceExt: string) {
    if (!isVideoFileExtnameValid(sourceExt)) {
      throw new Error('Invalid video extension ' + sourceExt)
    }

    const extensions = [ sourceExt, '.mp4', '.mkv', '.webm' ]

    for (const extension of extensions) {
      const path = tmpPath + extension

      if (await pathExists(path)) return path
    }

    const directoryContent = await readdir(dirname(tmpPath))

    throw new Error(`Cannot guess path of ${tmpPath}. Directory content: ${directoryContent.join(', ')}`)
  }

  private filterUnavailable(list: Partial<YoutubeDLInfo>[]): Partial<YoutubeDLInfo>[] {
    const now = Math.floor(Date.now() / 1000)

    return list.filter(item => {
      const toBePremiered = item.release_timestamp > now

      // filter out videos that haven't premiered yet
      if (toBePremiered) {
        return false
      }

      return true
    })
  }
}

// ---------------------------------------------------------------------------

export {
  YoutubeDLWrapper
}
