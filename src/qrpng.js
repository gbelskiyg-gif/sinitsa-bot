// QR-код в PNG на сервере (без внешних библиотек): генератор — тот же qrcode-generator,
// что и на сайте (public/vendor/qrcode.js), PNG собираем сами через zlib.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// Файл — обычный браузерный скрипт (в проекте "type": "module"), поэтому выполняем его в песочнице
const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor", "qrcode.js");
const box = { module: { exports: {} } };
box.exports = box.module.exports;
vm.runInNewContext(fs.readFileSync(LIB, "utf8"), box);
const qrcode = box.module.exports;

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG (чёрно-белый) с QR-кодом текста; scale — пикселей на модуль, margin — поле в модулях. */
export function qrPng(text, { scale = 10, margin = 4 } = {}) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  const q = qrcode(0, "M"); q.addData(text, "Byte"); q.make();
  const n = q.getModuleCount(), size = (n + margin * 2) * scale;
  const raw = Buffer.alloc((size + 1) * size, 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0; // фильтр строки: нет
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin;
      if (my >= 0 && my < n && mx >= 0 && mx < n && q.isDark(my, mx)) raw[y * (size + 1) + 1 + x] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8 бит, оттенки серого
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
