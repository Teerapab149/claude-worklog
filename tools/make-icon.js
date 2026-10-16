#!/usr/bin/env node
// node tools/make-icon.js   draws public/icon.svg into public/icon.ico
//
// Windows shortcuts need an .ico file. The icon is a few simple shapes, so it
// is drawn here directly instead of pulling in an image library. Keep the
// shapes in step with public/icon.svg.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { APP_ROOT } from '../src/config.js';

const BG = [0x1f, 0x5f, 0x57];
const INK = [0xf3, 0xef, 0xe6];
// Lines from icon.svg: M8 10h16 M8 16h11 M8 22h7, stroke width 3, round caps.
const LINES = [[8, 24, 10], [8, 19, 16], [8, 15, 22]];
const SAMPLES = 4;

function inBackground(x, y) {
	const dx = Math.max(8 - x, 0, x - 24), dy = Math.max(8 - y, 0, y - 24);
	return dx * dx + dy * dy <= 64;
}

function inLine(x, y) {
	return LINES.some(([x1, x2, ly]) => {
		const cx = Math.min(Math.max(x, x1), x2);
		return (x - cx) ** 2 + (y - ly) ** 2 <= 1.5 ** 2;
	});
}

/** RGBA pixels of the icon at size x size, smoothed by supersampling. */
function draw(size) {
	const px = Buffer.alloc(size * size * 4);
	for (let py = 0; py < size; py++) {
		for (let pxl = 0; pxl < size; pxl++) {
			let bg = 0, ink = 0;
			for (let sy = 0; sy < SAMPLES; sy++) {
				for (let sx = 0; sx < SAMPLES; sx++) {
					const x = ((pxl + (sx + 0.5) / SAMPLES) / size) * 32;
					const y = ((py + (sy + 0.5) / SAMPLES) / size) * 32;
					if (!inBackground(x, y)) continue;
					if (inLine(x, y)) ink++;
					else bg++;
				}
			}
			const covered = bg + ink;
			const i = (py * size + pxl) * 4;
			for (let c = 0; c < 3; c++) px[i + c] = covered ? Math.round((BG[c] * bg + INK[c] * ink) / covered) : 0;
			px[i + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
		}
	}
	return px;
}

function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

function png(size) {
	const px = draw(size);
	const rows = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
	]);
}

// An .ico file may hold PNG images directly (Windows Vista and later).
const sizes = [16, 24, 32, 48, 64, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
	const e = 6 + 16 * i;
	header[e] = size === 256 ? 0 : size;
	header[e + 1] = size === 256 ? 0 : size;
	header.writeUInt16LE(1, e + 4);
	header.writeUInt16LE(32, e + 6);
	header.writeUInt32LE(images[i].length, e + 8);
	header.writeUInt32LE(offset, e + 12);
	offset += images[i].length;
});
const out = path.join(APP_ROOT, 'public', 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, ...images]));
console.log(`เขียน ${out} แล้ว (${sizes.join(', ')} px)`);
