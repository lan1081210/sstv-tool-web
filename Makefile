# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 LAN (BI7KGI)
#
#   make         build www/sstv.wasm
#   make test    headless check of the wasm module (node)
#   make serve   http://localhost:8765
PORT ?= 8765

all:
	./build.sh

test: all
	node test/check.js www/sstv.wasm www/test/Robot36.wav

serve:
	@echo "http://localhost:$(PORT)"
	cd www && python3 -m http.server $(PORT)

clean:
	rm -f www/sstv.wasm www/test/encoded-check.wav

.PHONY: all test serve clean
