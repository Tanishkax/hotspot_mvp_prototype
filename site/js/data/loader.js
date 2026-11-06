// Static JSON loading with in-memory caching. Tiles are fetched on demand and only once.
import { DataError, validateManifest, validateTile } from './schema.js';

export class DataStore {
  constructor(root, fetchImpl = (...a) => fetch(...a)) {
    this.root = root;
    this.fetch = fetchImpl;
    this.tileCache = new Map(); // id -> Promise<tile>
    this.jsonCache = new Map();
    this.bytesLoaded = 0;
  }

  async json(path) {
    if (!this.jsonCache.has(path)) {
      const p = (async () => {
        const res = await this.fetch(this.root + path);
        if (!res.ok) throw new DataError(`Failed to load ${path} (HTTP ${res.status})`);
        const text = await res.text();
        this.bytesLoaded += text.length;
        try { return JSON.parse(text); } catch { throw new DataError(`Malformed JSON in ${path}`); }
      })();
      p.catch(() => this.jsonCache.delete(path)); // allow retry after failure
      this.jsonCache.set(path, p);
    }
    return this.jsonCache.get(path);
  }

  async manifest() {
    if (!this._manifest) this._manifest = this.json('manifest.json').then(validateManifest);
    return this._manifest;
  }

  async cells() { return this.json('cells.json'); }

  tile(id, nMonths) {
    if (!this.tileCache.has(id)) {
      const p = this.json(`tiles/${id}.json`).then((t) => validateTile(t, nMonths));
      p.catch(() => this.tileCache.delete(id));
      this.tileCache.set(id, p);
    }
    return this.tileCache.get(id);
  }

  /** Load several tiles; onProgress(done, total) is called as each resolves. */
  async tiles(ids, nMonths, onProgress = () => {}) {
    let done = 0;
    onProgress(0, ids.length);
    return Promise.all(ids.map((id) => this.tile(id, nMonths).then((t) => { onProgress(++done, ids.length); return t; })));
  }

  isCached(id) { return this.tileCache.has(id); }

  validation(name) { return this.json(`validation/${name}.json`); }
}
