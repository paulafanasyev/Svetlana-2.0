// Защита от SSRF: классификация адресов (IPv4, IPv6, IPv4-mapped в любой записи) и проверка в момент соединения.
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";

const block = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) block.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 96], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2002::", 16]]) block.addSubnet(a, p, "ipv6");

/** IPv6, несущий IPv4 (::ffff:a.b.c.d, ::ffff:ac10:1, ::a.b.c.d) → IPv4. */
function embeddedV4(ip) {
  const m = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip) || /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1];
  const h = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip.replace(/^::/, "0:0:0:0:0:"));
  if (h) { const a = parseInt(h[1], 16), b = parseInt(h[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}
export function isPrivateIp(ip) {
  const host = String(ip).replace(/^\[|\]$/g, "").split("%")[0];
  const fam = net.isIP(host); if (!fam) return true;
  if (fam === 6) { const v4 = embeddedV4(host.toLowerCase()); if (v4) return block.check(v4, "ipv4"); return block.check(host, "ipv6"); }
  return block.check(host, "ipv4");
}

export function parsePublicUrl(u) {
  let url; try { url = new URL(u); } catch { throw new Error("некорректный адрес"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("разрешены только http/https");
  if (url.username || url.password) throw new Error("логин в адресе запрещён");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("адрес во внутренней сети — запрещено");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error("адрес во внутренней сети — запрещено");
  return url;
}

/** lookup, который отказывает при любом приватном адресе — проверка происходит при КАЖДОМ соединении (нет DNS rebinding). */
export function guardedLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts?.family || 4 }];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(Object.assign(new Error("адрес во внутренней сети — запрещено"), { code: "EPRIVATE" }));
    return opts?.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}

/** GET с защитой: проверка URL, адреса при соединении, ручные редиректы (до 4), лимит размера и времени. */
export function safeGet(u, { maxBytes = 3_000_000, timeoutMs = 20000, headers = {}, hops = 4 } = {}) {
  return new Promise((resolve, reject) => {
    let url; try { url = parsePublicUrl(u); } catch (e) { return reject(e); }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(url, { lookup: guardedLookup, headers: { "User-Agent": "SvetlanaBot/1.0", Accept: "text/html,application/json,text/plain,*/*", ...headers }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); if (hops <= 0) return reject(new Error("слишком много перенаправлений"));
        let next; try { next = new URL(res.headers.location, url).toString(); } catch { return reject(new Error("некорректное перенаправление")); }
        return safeGet(next, { maxBytes, timeoutMs, headers, hops: hops - 1 }).then(resolve, reject);
      }
      const chunks = []; let n = 0;
      res.on("data", (d) => { n += d.length; if (n > maxBytes) { req.destroy(); resolve({ status: res.statusCode, url: url.toString(), headers: res.headers, body: Buffer.concat(chunks), truncated: true }); } else chunks.push(d); });
      res.on("end", () => resolve({ status: res.statusCode, url: url.toString(), headers: res.headers, body: Buffer.concat(chunks), truncated: false }));
    });
    req.on("timeout", () => req.destroy(new Error("таймаут")));
    req.on("error", reject);
  });
}
