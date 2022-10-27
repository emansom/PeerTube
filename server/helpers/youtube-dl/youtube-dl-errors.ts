class YoutubeDLCLIExecError extends Error {
  constructor (url: string) {
    super(`youtube-dl failed to execute, possibly missing or corrupt`)
  }
}

class YoutubeDLCLIRetCodeError extends Error {
  constructor (retcode: number, url: string) {
    super(`youtube-dl return code was not 0, was ${retcode} on ${url}`)
  }
}

class YoutubeDLCLICrashError extends Error {
  constructor (err: string, url: string) {
    super(`youtube-dl crashed on ${url}: ${err}`)
  }
}

class YoutubeDLNoInfoError extends Error {
  constructor (url: string) {
    super(`youtube-dl returned no info for ${url}`)
  }
}

class YoutubeDLNoFormatsError extends Error {
  constructor (url: string) {
    super(`youtube-dl returned no video formats for ${url}`)
  }
}

class YoutubeDLIsLiveError extends Error {
  constructor (url: string) {
    super(`youtube-dl cannot download live streaming ${url}`)
  }
}

class YoutubeDLValidationError extends Error {
  status: YoutubeDLErrorOp
  url?: string
  cause?: Error // TODO: Property to remove once ES2022 is used

  constructor ({ op, url }: { op: YoutubeDLErrorOp, url: string }) {
    super(YoutubeDLValidationError.reasonFromStatus(op, url))
    this.status = op
    this.url = url
  }

  static reasonFromStatus (status: YoutubeDLErrorOp, url: string): string {
    switch (status) {
      case YoutubeDLErrorOp.IS_LIVE:
        return `Video ${url} is currently livestreaming`
      case YoutubeDLErrorOp.TO_BE_PUBLISHED:
        return `Video ${url} has not been published yet`
      case YoutubeDLErrorOp.NOT_POST_PROCESSED:
        return `Video ${url} is currently post processing`
      case YoutubeDLErrorOp.NO_FORMATS_AVAILABLE:
        return `Video ${url} has no downloadable video formats available`
      case YoutubeDLErrorOp.VIDEO_AVAILABILITY_ERROR:
        return `Video ${url} not available for import`
    }
  }

  static fromError (err: Error, op: YoutubeDLErrorOp, url: string) {
    const ytDlErr = new this({ op, url })
    ytDlErr.cause = err
    ytDlErr.stack = err.stack // TODO: Useless once ES2022 is used
    return ytDlErr
  }
}

enum YoutubeDLErrorOp {
  VIDEO_AVAILABILITY_ERROR,
  NO_FORMATS_AVAILABLE,
  NOT_POST_PROCESSED,
  IS_LIVE,
  TO_BE_PUBLISHED
}

// ---------------------------------------------------------------------------

export {
  YoutubeDLCLIExecError,
  YoutubeDLCLIRetCodeError,
  YoutubeDLCLICrashError,
  YoutubeDLNoInfoError,
  YoutubeDLNoFormatsError,
  YoutubeDLIsLiveError,
  YoutubeDLErrorOp
}
