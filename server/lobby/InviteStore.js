// Lobby-level persistence (earthborn pattern): in-memory working set mirrored
// to one JSON file via atomic tmp+rename. Only lobby records survive a
// restart — in-progress racks deliberately do not (SDD §5).

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'tables.json');

export class InviteStore {
  constructor(file = FILE) {
    this.file = file;
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.tables) ? parsed.tables : [];
    } catch {
      return [];
    }
  }

  async persist(records) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ tables: records }, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}
