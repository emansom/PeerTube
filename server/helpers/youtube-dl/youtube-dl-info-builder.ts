import { CONSTRAINTS_FIELDS, VIDEO_CATEGORIES, VIDEO_LANGUAGES, VIDEO_LICENCES } from '../../initializers/constants'
import { peertubeTruncate } from '../core-utils'
import { isUrlValid } from '../custom-validators/activitypub/misc'
import { YoutubeDLBaseBuilder } from './youtube-dl-base-builder'
import { YoutubeDLCLIResult } from './youtube-dl-cli'

type YoutubeDLInfo = {
  name?: string
  description?: string
  category?: number
  language?: string
  licence?: number
  nsfw?: boolean
  tags?: string[]
  thumbnailUrl?: string
  ext?: string
  originallyPublishedAtWithoutTime?: Date
  webpageUrl?: string
  urls?: string[]
  formats?: any[]
  isLive?: boolean
  timestamp?: number
  release_timestamp?: number
}

class YoutubeDLInfoBuilder extends YoutubeDLBaseBuilder {
  private readonly info: any

  constructor (info: any) {
    super()
    this.info = { ...info }
  }

  getInfo () {
    const obj = this.buildVideoInfo(this.normalizeObject(this.info))
    if (obj.name && obj.name.length < CONSTRAINTS_FIELDS.VIDEOS.NAME.min) obj.name += ' video'

    return obj
  }

  private buildOriginallyPublishedAt (obj: any): Date {
    let originallyPublishedAt: Date = null

    const uploadDateMatcher = /^(\d{4})(\d{2})(\d{2})$/.exec(obj.upload_date)
    if (uploadDateMatcher) {
      originallyPublishedAt = new Date()
      originallyPublishedAt.setHours(0, 0, 0, 0)

      const year = parseInt(uploadDateMatcher[1], 10)
      // Month starts from 0
      const month = parseInt(uploadDateMatcher[2], 10) - 1
      const day = parseInt(uploadDateMatcher[3], 10)

      originallyPublishedAt.setFullYear(year, month, day)
    }

    return originallyPublishedAt
  }

  private buildVideoInfo (obj: YoutubeDLCLIResult): YoutubeDLInfo {
    const info: Partial<YoutubeDLInfo> = {
      name: this.titleTruncation(obj.title),
      description: this.descriptionTruncation(obj.description),
      category: this.getCategory(obj.categories),
      licence: this.getLicence(obj.license),
      language: this.getLanguage(obj.language),
      nsfw: this.isNSFW(obj),
      tags: this.getTags(obj.tags),
      thumbnailUrl: obj.thumbnail || undefined,
      urls: this.buildAvailableUrl(obj),
      formats: obj.formats || [],
      originallyPublishedAtWithoutTime: this.buildOriginallyPublishedAt(obj),
      ext: obj.ext,
      webpageUrl: obj.webpage_url
    }

    return info
  }

  private buildAvailableUrl (obj: YoutubeDLCLIResult): string[] {
    const urls: string[] = []

    if (obj.url) urls.push(obj.url)
    if (obj.urls) {
      // TODO: split on \n next line
      if (Array.isArray(obj.urls)) urls.push(...obj.urls)
      else urls.push(obj.urls)
    }

    const formats = Array.isArray(obj.formats)
      ? obj.formats
      : []

    for (const format of formats) {
      if (!format.url) continue

      urls.push(format.url)
    }

    const thumbnails = Array.isArray(obj.thumbnails)
      ? obj.thumbnails
      : []

    for (const thumbnail of thumbnails) {
      if (!thumbnail.url) continue

      urls.push(thumbnail.url)
    }

    if (obj.thumbnail) urls.push(obj.thumbnail)

    for (const subtitleKey of Object.keys(obj.subtitles || {})) {
      const subtitles = obj.subtitles[subtitleKey]
      if (!Array.isArray(subtitles)) continue

      for (const subtitle of subtitles) {
        if (!subtitle.url) continue

        urls.push(subtitle.url)
      }
    }

    return urls.filter(u => u && isUrlValid(u))
  }

  private titleTruncation (title: string): string {
    return peertubeTruncate(title, {
      length: CONSTRAINTS_FIELDS.VIDEOS.NAME.max,
      separator: /,? +/,
      omission: ' […]'
    })
  }

  private descriptionTruncation (description: string): string {
    if (!description || description.length < CONSTRAINTS_FIELDS.VIDEOS.DESCRIPTION.min) return undefined

    return peertubeTruncate(description, {
      length: CONSTRAINTS_FIELDS.VIDEOS.DESCRIPTION.max,
      separator: /,? +/,
      omission: ' […]'
    })
  }

  private isNSFW (info: YoutubeDLCLIResult): boolean {
    return info.age_limit >= 16
  }

  private getTags (tags: string[]): string[] {
    if (Array.isArray(tags) === false) return []

    return tags
      .filter(t => t.length < CONSTRAINTS_FIELDS.VIDEOS.TAG.max && t.length > CONSTRAINTS_FIELDS.VIDEOS.TAG.min)
      .map(t => t.normalize())
      .slice(0, 5)
  }

  private getLicence (licence: string): number | undefined {
    if (!licence) return undefined

    if (licence.includes('Creative Commons Attribution')) return 1

    for (const key of Object.keys(VIDEO_LICENCES)) {
      const peertubeLicence = VIDEO_LICENCES[key]
      if (peertubeLicence.toLowerCase() === licence.toLowerCase()) return parseInt(key, 10)
    }

    return undefined
  }

  private getCategory (categories: string[]): number | undefined {
    if (!categories) return undefined

    const categoryString = categories[0]
    if (!categoryString || typeof categoryString !== 'string') return undefined

    if (categoryString === 'News & Politics') return 11

    for (const key of Object.keys(VIDEO_CATEGORIES)) {
      const category = VIDEO_CATEGORIES[key]
      if (categoryString.toLowerCase() === category.toLowerCase()) return parseInt(key, 10)
    }

    return undefined
  }

  private getLanguage (language: string): string | undefined {
    return VIDEO_LANGUAGES[language] ? language : undefined
  }
}

// ---------------------------------------------------------------------------

export {
  YoutubeDLInfo,
  YoutubeDLInfoBuilder
}
