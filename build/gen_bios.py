#!/usr/bin/env python3
"""Deprecated: player bios are now regenerated from live data on EVERY build by
build/bio_engine.py (called from parse.py), so there is nothing to run separately.
Kept so old habits (parse -> gen_bios -> parse) still work: this just runs a build.
Hand-written lore goes in data/player_bio_notes.json (see bio_engine.py)."""
import os, subprocess, sys
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "parse.py")], check=True)
