import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Abstract storage interface. The default impl is local filesystem. Swap to S3/R2 by
 * implementing the same interface and wiring it up in `server.ts`.
 */
export interface StorageService {
  /** Persist a buffer and return the file path (relative to the storage root). */
  save(buf: Buffer, originalName: string): Promise<{ relPath: string; absPath: string }>;
  resolve(relPath: string): string;
  delete(relPath: string): Promise<void>;
}

class LocalStorage implements StorageService {
  constructor(private readonly root: string) {}

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async save(buf: Buffer, originalName: string): Promise<{ relPath: string; absPath: string }> {
    await this.ensureRoot();
    const ext = path.extname(originalName).slice(0, 16);
    const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
    const absPath = path.join(this.root, key);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buf);
    return { relPath: key, absPath };
  }

  resolve(relPath: string): string {
    return path.join(this.root, relPath);
  }

  async delete(relPath: string) {
    try {
      await fs.unlink(this.resolve(relPath));
    } catch {
      // ignore ENOENT
    }
  }
}

export const storage: StorageService = new LocalStorage(path.resolve(config.uploads.dir));
