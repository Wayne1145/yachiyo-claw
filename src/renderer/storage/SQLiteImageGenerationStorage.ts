import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { ImageGeneration, ImageGenerationPage } from '@shared/types'
import type { ImageGenerationStorage } from './ImageGenerationStorage'

const PAGE_SIZE = 20
const DB_NAME = 'chatbox-image-generation'

export class SQLiteImageGenerationStorage implements ImageGenerationStorage {
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initPromise: Promise<void> | null = null

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
  }

  initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.openDatabase()
    return this.initPromise
  }

  private async openDatabase(): Promise<void> {
    try {
      this.sqlite.closeConnection(DB_NAME, false)
    } catch {
      // ignore - connection may not exist
    }

    // Bump version to 2 for new columns
    this.database = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 2, false)
    await this.database.open()

    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS image_generation (
        id TEXT PRIMARY KEY NOT NULL,
        prompt TEXT NOT NULL,
        reference_images TEXT NOT NULL DEFAULT '[]',
        generated_images TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        model_provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        dalle_style TEXT,
        image_generate_num INTEGER,
        status TEXT NOT NULL,
        parent_id TEXT,
        error TEXT,
        error_code TEXT,
        error_item_uuid TEXT,
        task_id TEXT,
        aspect_ratio TEXT
      )
    `)

    // Migration: add new columns if they don't exist (for existing databases)
    await this.addColumnIfNotExists('task_id', 'TEXT')
    await this.addColumnIfNotExists('aspect_ratio', 'TEXT')
    await this.addColumnIfNotExists('error_item_uuid', 'TEXT')

    await this.database.execute(`
      CREATE INDEX IF NOT EXISTS idx_image_generation_created_at
      ON image_generation(created_at DESC)
    `)
  }

  private async addColumnIfNotExists(columnName: string, columnDef: string): Promise<void> {
    try {
      await this.database.execute(`ALTER TABLE image_generation ADD COLUMN ${columnName} ${columnDef}`)
    } catch {
      // Column likely already exists, ignore error
    }
  }

  private recordToRow(record: ImageGeneration): Record<string, unknown> {
    return {
      id: record.id,
      prompt: record.prompt,
      reference_images: JSON.stringify(record.referenceImages),
      generated_images: JSON.stringify(record.generatedImages),
      created_at: record.createdAt,
      model_provider: record.model.provider,
      model_id: record.model.modelId,
      dalle_style: record.dalleStyle || null,
      image_generate_num: record.imageGenerateNum || null,
      status: record.status,
      parent_id: record.parentIds?.length ? JSON.stringify(record.parentIds) : null,
      error: record.error || null,
      error_code: record.errorCode || null,
      error_item_uuid: record.errorItemUuid || null,
      task_id: record.taskId || null,
      aspect_ratio: record.aspectRatio || null,
    }
  }

  private rowToRecord(row: Record<string, unknown>): ImageGeneration {
    return {
      id: row.id as string,
      prompt: row.prompt as string,
      referenceImages: JSON.parse((row.reference_images as string) || '[]'),
      generatedImages: JSON.parse((row.generated_images as string) || '[]'),
      createdAt: row.created_at as number,
      model: {
        provider: row.model_provider as string,
        modelId: row.model_id as string,
      },
      dalleStyle: row.dalle_style as 'vivid' | 'natural' | undefined,
      imageGenerateNum: row.image_generate_num as number | undefined,
      status: row.status as ImageGeneration['status'],
      parentIds: row.parent_id ? JSON.parse(row.parent_id as string) : undefined,
      error: row.error as string | undefined,
      errorCode: row.error_code as ImageGeneration['errorCode'] | undefined,
      errorItemUuid: row.error_item_uuid as string | undefined,
      taskId: (row.task_id as string) || undefined,
      aspectRatio: row.aspect_ratio as string | undefined,
    }
  }

  async create(record: ImageGeneration): Promise<void> {
    await this.initialize()
    const row = this.recordToRow(record)

    await this.database.run(
      `INSERT INTO image_generation
       (id, prompt, reference_images, generated_images, created_at, model_provider, model_id, dalle_style, image_generate_num, status, parent_id, error, error_code, error_item_uuid, task_id, aspect_ratio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.prompt,
        row.reference_images,
        row.generated_images,
        row.created_at,
        row.model_provider,
        row.model_id,
        row.dalle_style,
        row.image_generate_num,
        row.status,
        row.parent_id,
        row.error,
        row.error_code,
        row.error_item_uuid,
        row.task_id,
        row.aspect_ratio,
      ]
    )
  }

  async update(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated = { ...existing, ...updates }
    const row = this.recordToRow(updated)

    await this.database.run(
      `UPDATE image_generation SET
       prompt = ?, reference_images = ?, generated_images = ?, created_at = ?,
       model_provider = ?, model_id = ?, dalle_style = ?, image_generate_num = ?,
       status = ?, parent_id = ?, error = ?, error_code = ?, error_item_uuid = ?,
       task_id = ?, aspect_ratio = ?
       WHERE id = ?`,
      [
        row.prompt,
        row.reference_images,
        row.generated_images,
        row.created_at,
        row.model_provider,
        row.model_id,
        row.dalle_style,
        row.image_generate_num,
        row.status,
        row.parent_id,
        row.error,
        row.error_code,
        row.error_item_uuid,
        row.task_id,
        row.aspect_ratio,
        id,
      ]
    )

    return updated
  }

  async getById(id: string): Promise<ImageGeneration | null> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM image_generation WHERE id = ?', [id])
    if (!result.values || result.values.length === 0) return null
    return this.rowToRecord(result.values[0])
  }

  async delete(id: string): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM image_generation WHERE id = ?', [id])
  }

  async getPage(cursor: number = 0, limit: number = PAGE_SIZE): Promise<ImageGenerationPage> {
    await this.initialize()

    const countResult = await this.database.query('SELECT COUNT(*) as total FROM image_generation')
    const total = (countResult.values?.[0]?.total as number) || 0

    const result = await this.database.query(
      'SELECT * FROM image_generation ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, cursor]
    )

    const items = (result.values || []).map((row) => this.rowToRecord(row))
    const nextCursor = cursor + limit < total ? cursor + limit : null

    return { items, nextCursor, total }
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    const result = await this.database.query('SELECT COUNT(*) as total FROM image_generation')
    return (result.values?.[0]?.total as number) || 0
  }
}
