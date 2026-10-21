SHELL := /bin/bash

.PHONY: all bench-small bench-large clean

all: dist/mandelbrot.js

node_modules: package.json
	npm install
	@touch node_modules

dist/mandelbrot.js: mandelbrot.ts tsconfig.json node_modules
	npx tsc

bench-small: dist/mandelbrot.js
	time node dist/mandelbrot.js png=1 width=1000 height=750 > image.dat

bench-large: dist/mandelbrot.js
	time node dist/mandelbrot.js png=1 width=5000 height=5000 > image.dat

clean:
	rm -rf dist image.dat
