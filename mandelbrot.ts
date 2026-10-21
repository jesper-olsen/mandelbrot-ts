/**
 * @file mandelbrot.ts
 * @brief Generates Mandelbrot set visualizations in ASCII or for gnuplot.
 *
 * TypeScript port of mandelbrot.c for the cross-language comparison project.
 * Arguments are given as key=value, exactly as in the C version.
 *
 * Build:
 *   npm install && npx tsc          (emits dist/mandelbrot.js)
 *
 * Usage:
 *   node dist/mandelbrot.js
 *   node dist/mandelbrot.js width=120 ll_x=-0.75 ll_y=0.1 ur_x=-0.74 ur_y=0.11
 *   node dist/mandelbrot.js png=1 width=800 height=600 > mandelbrot.dat
 */

import { once } from "node:events";

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

/** Renders the Mandelbrot set as ASCII art to stdout. */
async function asciiOutput(config: Config, out: Out): Promise<void> {
    const fwidth = config.urX - config.llX;
    const fheight = config.urY - config.llY;

    for (let y = 0; y < config.height; ++y) {
        let line = "";
        for (let x = 0; x < config.width; ++x) {
            const real = config.llX + (x * fwidth) / config.width;
            const imag = config.urY - (y * fheight) / config.height;
            const iter = escapeTime(real, imag, config.maxIter);
            line += cnt2char(iter, config.maxIter);
        }
        await out.write(line + "\n");
    }
    await out.flush();
}

/** Generates comma-separated iteration counts for gnuplot (bottom row first). */
async function gptextOutput(config: Config, out: Out): Promise<void> {
    const fwidth = config.urX - config.llX;
    const fheight = config.urY - config.llY;
    const row = new Int32Array(config.width);

    for (let y = config.height - 1; y >= 0; --y) {
        for (let x = 0; x < config.width; ++x) {
            const real = config.llX + (x * fwidth) / config.width;
            const imag = config.urY - (y * fheight) / config.height;
            row[x] = escapeTime(real, imag, config.maxIter);
        }
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

    const out = new Out();
    if (config.png) {
        await gptextOutput(config, out);
    } else {
        await asciiOutput(config, out);
    }
}

await main();
