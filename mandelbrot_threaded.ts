/**
 * @file mandelbrot_threaded.ts
 * @brief Multi-threaded Mandelbrot generator (ASCII or gnuplot text).
 *
 * TypeScript port of mandelbrot_pthread.c. A fixed pool of worker threads
 * claims rows one at a time from a shared atomic counter and writes the
 * escape times into a shared buffer. After all workers have finished, the
 * main thread formats and writes the output in a single pass.
 *
 * The same file serves as both the main program and the worker script.
 *
 * Build:
 *   npm install && npx tsc          (emits dist/mandelbrot_threaded.js)
 *
 * Usage:
 *   node dist/mandelbrot_threaded.js
 *   node dist/mandelbrot_threaded.js width=120 ll_x=-0.75 ll_y=0.1 ur_x=-0.74 ur_y=0.11
 *   node dist/mandelbrot_threaded.js png=1 width=800 height=600 > mandelbrot.dat
 */

import { once } from "node:events";
import { isMainThread, Worker, workerData } from "node:worker_threads";

const NUM_THREADS = 10; // Adjust based on CPU core count

interface Config {
    width: number;
    height: number;
    png: boolean;
    llX: number;
    llY: number;
    urX: number;
    urY: number;
    maxIter: number;
}

/** Everything a worker needs; the two buffers are shared, not copied. */
interface WorkerData {
    config: Config;
    pixels: SharedArrayBuffer; // width * height Int32, row-major, y = 0 at the top
    nextRow: SharedArrayBuffer; // single Int32: next row to claim
}

const SYMBOLS = "MW2a_. ";

/** Maps an iteration count in [0, maxIter] to an ASCII character. */
function cnt2char(value: number, maxIter: number): string {
    const idx = Math.trunc((value / maxIter) * (SYMBOLS.length - 1));
    return SYMBOLS.charAt(idx);
}

/** Escape time for the point c = cr + ci*i; returns maxIter - iterations used. */
function escapeTime(cr: number, ci: number, maxIter: number): number {
    let zr = 0.0;
    let zi = 0.0;
    let iter = 0;
    for (; iter < maxIter; ++iter) {
        const zr2 = zr * zr;
        const zi2 = zi * zi;
        if (zr2 + zi2 > 4.0) {
            break;
        }
        const tmp = zr2 - zi2 + cr;
        zi = 2.0 * zr * zi + ci;
        zr = tmp;
    }
    return maxIter - iter;
}

/** Worker body: claim rows from the shared counter until none are left. */
function workerMain(data: WorkerData): void {
    const { config } = data;
    const pixels = new Int32Array(data.pixels);
    const nextRow = new Int32Array(data.nextRow);
    const fwidth = config.urX - config.llX;
    const fheight = config.urY - config.llY;

    for (;;) {
        const y = Atomics.add(nextRow, 0, 1);
        if (y >= config.height) {
            break;
        }
        const base = y * config.width;
        const imag = config.urY - (y * fheight) / config.height;
        for (let x = 0; x < config.width; ++x) {
            const real = config.llX + (x * fwidth) / config.width;
            pixels[base + x] = escapeTime(real, imag, config.maxIter);
        }
    }
}

/** Runs one worker thread (this same file) to completion. */
function spawnWorker(data: WorkerData): Promise<void> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: data });
        worker.once("error", reject);
        worker.once("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`worker exited with code ${code}`)),
        );
    });
}

/** Buffered stdout writer that respects backpressure. */
class Out {
    private parts: string[] = [];
    private size = 0;

    async write(s: string): Promise<void> {
        this.parts.push(s);
        this.size += s.length;
        if (this.size >= 1 << 16) {
            await this.flush();
        }
    }

    async flush(): Promise<void> {
        if (this.parts.length === 0) return;
        const data = this.parts.join("");
        this.parts = [];
        this.size = 0;
        if (!process.stdout.write(data)) {
            await once(process.stdout, "drain");
        }
    }
}

/** Renders the computed pixels as ASCII art to stdout. */
async function asciiOutput(config: Config, pixels: Int32Array, out: Out): Promise<void> {
    for (let y = 0; y < config.height; ++y) {
        const base = y * config.width;
        let line = "";
        for (let x = 0; x < config.width; ++x) {
            line += cnt2char(pixels[base + x] ?? 0, config.maxIter);
        }
        await out.write(line + "\n");
    }
    await out.flush();
}

/** Writes comma-separated iteration counts for gnuplot (bottom row first). */
async function gptextOutput(config: Config, pixels: Int32Array, out: Out): Promise<void> {
    for (let y = config.height - 1; y >= 0; --y) {
        const row = pixels.subarray(y * config.width, (y + 1) * config.width);
        await out.write(row.join(", ") + "\n");
    }
    await out.flush();
}

/** Parses an integer value; warns and returns the fallback if unparseable. */
function intArg(key: string, value: string, fallback: number): number {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) {
        console.error(`Warning: Invalid value '${value}' for '${key}'`);
        return fallback;
    }
    return n;
}

/** Parses a floating point value; warns and returns the fallback if unparseable. */
function floatArg(key: string, value: string, fallback: number): number {
    const n = Number.parseFloat(value);
    if (Number.isNaN(n)) {
        console.error(`Warning: Invalid value '${value}' for '${key}'`);
        return fallback;
    }
    return n;
}

/** Parses a single "key=value" command-line argument into config. */
function parseArg(arg: string, config: Config): void {
    const eq = arg.indexOf("=");
    if (eq < 0) {
        console.error(`Warning: Ignoring invalid argument '${arg}'`);
        return;
    }
    const key = arg.slice(0, eq);
    const value = arg.slice(eq + 1);

    switch (key) {
        case "width":    config.width   = intArg(key, value, config.width); break;
        case "height":   config.height  = intArg(key, value, config.height); break;
        case "png":      config.png     = intArg(key, value, config.png ? 1 : 0) !== 0; break;
        case "ll_x":     config.llX     = floatArg(key, value, config.llX); break;
        case "ll_y":     config.llY     = floatArg(key, value, config.llY); break;
        case "ur_x":     config.urX     = floatArg(key, value, config.urX); break;
        case "ur_y":     config.urY     = floatArg(key, value, config.urY); break;
        case "max_iter": config.maxIter = intArg(key, value, config.maxIter); break;
        default:
            console.error(`Warning: Unknown parameter '${key}'`);
    }
}

async function main(): Promise<void> {
    const config: Config = {
        width: 100,
        height: 75,
        png: false,
        llX: -1.2,
        llY: 0.2,
        urX: -1.0,
        urY: 0.35,
        maxIter: 255,
    };

    for (const arg of process.argv.slice(2)) {
        parseArg(arg, config);
    }

    // Exit quietly when the reader closes the pipe (e.g. `| head`).
    process.stdout.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EPIPE") process.exit(0);
        throw err;
    });

    const data: WorkerData = {
        config,
        pixels: new SharedArrayBuffer(config.width * config.height * Int32Array.BYTES_PER_ELEMENT),
        nextRow: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < NUM_THREADS; ++i) {
        workers.push(spawnWorker(data));
    }
    await Promise.all(workers);

    const pixels = new Int32Array(data.pixels);
    const out = new Out();
    if (config.png) {
        await gptextOutput(config, pixels, out);
    } else {
        await asciiOutput(config, pixels, out);
    }
}

if (isMainThread) {
    await main();
} else {
    workerMain(workerData as WorkerData);
}
