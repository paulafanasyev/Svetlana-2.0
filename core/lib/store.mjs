// Простое надёжное хранилище: JSON-файл на коллекцию, атомарная запись (tmp + rename), очередь записей.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class Store {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.cache = new Map(); this.chain = Promise.resolve(); }
  file(name) { if (!/^[a-z0-9_-]+$/.test(name)) throw new Error("bad collection"); return path.join(this.dir, name + ".json"); }
  all(name) {
    if (!this.cache.has(name)) {
      const f = this.file(name);
      this.cache.set(name, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []);
    }
    return this.cache.get(name);
  }
  persist(name) {
    const data = JSON.stringify(this.all(name), null, 1);
    const f = this.file(name); const tmp = f + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, data); fs.renameSync(tmp, f);
  }
  insert(name, obj) {
    const row = { id: obj.id || name.slice(0, 3) + "_" + crypto.randomBytes(5).toString("hex"), createdAt: new Date().toISOString(), ...obj };
    this.all(name).push(row); this.persist(name); return row;
  }
  update(name, id, patch) {
    const row = this.all(name).find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() }); this.persist(name); return row;
  }
  remove(name, id) {
    const rows = this.all(name); const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return false; rows.splice(i, 1); this.persist(name); return true;
  }
  find(name, pred) { return this.all(name).filter(pred); }
  get(name, id) { return this.all(name).find((r) => r.id === id) || null; }
}
