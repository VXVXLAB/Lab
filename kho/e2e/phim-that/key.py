#!/usr/bin/env python3
"""Gửi phím thật ở mức hệ điều hành (X11 XTEST) — đi qua cả phần khung của trình duyệt, như người bấm bàn phím.
   key.py F6 | ctrl+s | alt+Down | click:X,Y | type:abc"""
import sys, time
from Xlib import X, XK, display
from Xlib.ext import xtest
d = display.Display()
def code(name):
    ks = XK.string_to_keysym(name)
    if ks == 0: raise SystemExit(f"không biết phím {name}")
    return d.keysym_to_keycode(ks)
MOD = {'ctrl': 'Control_L', 'alt': 'Alt_L', 'shift': 'Shift_L'}
NAMES = {'/': 'slash', '.': 'period', ' ': 'space', '-': 'minus'}
for arg in sys.argv[1:]:
    if arg.startswith('click:'):
        x, y = map(int, arg[6:].split(','))
        xtest.fake_input(d, X.MotionNotify, x=x, y=y); xtest.fake_input(d, X.ButtonPress, 1); xtest.fake_input(d, X.ButtonRelease, 1)
    elif arg.startswith('type:'):
        for ch in arg[5:]:
            kc = code(NAMES.get(ch, ch)); xtest.fake_input(d, X.KeyPress, kc); xtest.fake_input(d, X.KeyRelease, kc); d.sync(); time.sleep(0.05)
    else:
        parts = arg.split('+'); mods = [code(MOD[m.lower()]) for m in parts[:-1]]; kc = code(NAMES.get(parts[-1], parts[-1]))
        for m in mods: xtest.fake_input(d, X.KeyPress, m)
        xtest.fake_input(d, X.KeyPress, kc); xtest.fake_input(d, X.KeyRelease, kc)
        for m in reversed(mods): xtest.fake_input(d, X.KeyRelease, m)
    d.sync(); time.sleep(0.15)
