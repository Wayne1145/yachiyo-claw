import type { WriteFileOptions, WriteFileResult } from '@capacitor/filesystem'
import { Toast } from '@capacitor/toast'
import i18n from '@/i18n'
import { getLogger } from '@/lib/utils'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import { AndroidFilterWriter, type FilterWriter, IOSFilterWriter } from './filter_writer'
import type { Exporter } from './interfaces'

const log = getLogger('mobile_exporter')

export default class MobileExporter implements Exporter {
  private writer: FilterWriter

  constructor() {
    const platform = CHATBOX_BUILD_PLATFORM
    this.writer = platform === 'ios' ? new IOSFilterWriter() : new AndroidFilterWriter()
  }

  async writeFileAutoRenameOnConflict(options: WriteFileOptions): Promise<WriteFileResult> {
    log.info('writeFileAutoRenameOnConflict called', { path: options.path, directory: options.directory })
    try {
      const result = await this.writer.writeFileAutoRenameOnConflict(options)
      log.info('writeFileAutoRenameOnConflict success', { uri: result.uri })
      return result
    } catch (error) {
      log.error('writeFileAutoRenameOnConflict failed', { path: options.path, error })
      throw error
    }
  }

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') {
    log.info('exportBlob called', { filename, blobSize: blob.size, blobType: blob.type, encoding })
    try {
      await this.writer.exportBlob(filename, blob, encoding)
      log.info('exportBlob success', { filename })
    } catch (error) {
      log.error('exportBlob failed', { filename, error })
      throw error
    }
  }

  async exportTextFile(filename: string, content: string) {
    log.info('exportTextFile called', { filename, contentLength: content.length })
    try {
      await this.writer.exportTextFile(filename, content)
      log.info('exportTextFile success', { filename })
    } catch (error) {
      log.error('exportTextFile failed', { filename, error })
      throw error
    }
  }

  async exportImageFile(basename: string, base64Data: string) {
    log.info('exportImageFile called', { basename, dataLength: base64Data.length })
    try {
      await this.writer.exportImageFile(basename, base64Data)
      log.info('exportImageFile success', { basename })
    } catch (error) {
      log.error('exportImageFile failed', { basename, error })
      throw error
    }
  }

  async exportByUrl(filename: string, url: string) {
    log.info('exportByUrl called', { filename, url })
    try {
      await this.writer.exportByUrl(filename, url)
      log.info('exportByUrl success', { filename })
    } catch (error) {
      log.error('exportByUrl failed', { filename, url, error })
      throw error
    }
  }

  async exportStreamingJson(filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) {
    log.info('exportStreamingJson started', { filename })
    try {
      await this.writeStreamingContent(filename, dataCallback)
      log.info('exportStreamingJson completed', { filename })
    } catch (error) {
      log.error('exportStreamingJson failed', { filename, error })
      await Toast.show({
        text: i18n.t('Failed to export file: {{error}}', { error: error }),
      })
      throw error
    }
  }

  private async writeStreamingContent(filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) {
    let tempContent = ''
    let isFirstWrite = true
    let chunkCount = 0
    let totalBytesWritten = 0
    let actualPath: string | undefined // Track the actual file path (may differ if renamed on conflict)
    const generator = dataCallback()
    const CHUNK_SIZE = 1024 * 1024 // 1MB chunks

    log.debug('writeStreamingContent started', { filename, chunkSize: CHUNK_SIZE })

    for await (const chunk of generator) {
      tempContent += chunk
      // 如果内容太长，分批写入文件
      if (tempContent.length > CHUNK_SIZE) {
        chunkCount++
        totalBytesWritten += tempContent.length
        if (isFirstWrite) {
          // 第一次写入创建文件，获取实际路径
          actualPath = await this.writeFirstChunk(filename, tempContent)
          isFirstWrite = false
        } else {
          // 后续写入追加内容，使用实际路径
          await this.appendChunk(filename, tempContent, actualPath)
        }
        tempContent = ''
      }
    }

    // 写入剩余内容
    if (tempContent.length > 0) {
      totalBytesWritten += tempContent.length
      if (isFirstWrite) {
        // 如果所有内容都小于1MB，直接创建完整文件
        await this.writeCompleteFile(filename, tempContent)
      } else {
        // 追加最后一块内容并完成，使用实际路径
        chunkCount++
        await this.finishWriting(filename, tempContent, actualPath)
      }
    } else if (!isFirstWrite) {
      // 没有剩余内容但之前已经写入过，需要完成操作
      await this.completeExport(filename, actualPath)
    }

    log.info('writeStreamingContent finished', { filename, actualPath, totalChunks: chunkCount, totalBytesWritten })
  }

  private async writeFirstChunk(filename: string, content: string): Promise<string> {
    return await this.writer.writeFirstChunk(filename, content)
  }

  private async appendChunk(filename: string, content: string, actualPath?: string) {
    await this.writer.appendChunk(filename, content, actualPath)
  }

  private async writeCompleteFile(filename: string, content: string) {
    await this.writer.writeCompleteFile(filename, content)
  }

  private async finishWriting(filename: string, content: string, actualPath?: string) {
    await this.writer.finishWriting(filename, content, actualPath)
  }

  private async completeExport(filename: string, actualPath?: string) {
    await this.writer.completeExport(filename, actualPath)
  }
}
