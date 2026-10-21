SHELL := /bin/bash

.PHONY: all bench-small bench-large bench-threaded-small bench-threaded-large clean

all: dist/.built

node_modules: package.json
	npm install
	@touch node_modules

# One tsc run emits both programs, hence a single stamp target.
dist/.built: mandelbrot.ts mandelbrot_threaded.ts tsconfig.json node_modules
	npx tsc
	@touch $@

bench-small: dist/.built
	time node dist/mandelbrot.js png=1 width=1000 height=750 > image.dat

bench-large: dist/.built
	time node dist/mandelbrot.js png=1 width=5000 height=5000 > image.dat

bench-threaded-small: dist/.built
	time node dist/mandelbrot_threaded.js png=1 width=1000 height=750 > image.dat

bench-threaded-large: dist/.built
	time node dist/mandelbrot_threaded.js png=1 width=5000 height=5000 > image.dat

clean:
	rm -rf dist image.dat
