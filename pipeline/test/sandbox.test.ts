import { describe, expect, it } from 'vitest';
import { runVerifyScript } from '../src/quality.ts';

const blocked = (script: string) => {
  const r = runVerifyScript(script);
  expect(r).toHaveProperty('error');
  return 'error' in r ? r.error : '';
};

describe('verify script sandbox', () => {
  it('still runs normal calculations', () => {
    expect(runVerifyScript('from fractions import Fraction\nimport re, math, itertools\nprint("ANSWER:", Fraction(1, 3) + Fraction(1, 6))')).toEqual({ answer: '1/2' });
  });
  it('blocks network, processes, ctypes, writes and reading outside', () => {
    expect(blocked('import socket')).toMatch(/Sandbox/);
    expect(blocked('import urllib.request\nurllib.request.urlopen("http://example.org")')).toMatch(/Sandbox/);
    expect(blocked('import os\nos.system("id")')).toMatch(/Sandbox/);
    expect(blocked('import subprocess')).toMatch(/Sandbox/);
    expect(blocked('import ctypes')).toMatch(/Sandbox/);
    expect(blocked('import os\nos.fork()')).toMatch(/Sandbox/);
    expect(blocked('open("/etc/passwd").read()')).toMatch(/Sandbox/);
    expect(blocked('import os\nopen(os.path.expanduser("~/.ssh/authorized_keys")).read()')).toMatch(/Sandbox/);
    expect(blocked('open("x.txt", "w").write("hi")')).toMatch(/Sandbox/);
    expect(blocked('import os\nos.listdir("/home")')).toMatch(/Sandbox/);
    expect(blocked('import os\nprint("ANSWER:", os.environ.get("TELEGRAM_BOT_TOKEN", "leer"))\nraise SystemExit(0 if "TELEGRAM_BOT_TOKEN" not in os.environ else 1)')).toBeDefined();
  });
  it('does not leak environment secrets', () => {
    process.env.LQ_SECRET_PROBE = 'geheim';
    expect(runVerifyScript('import os\nprint("ANSWER:", os.environ.get("LQ_SECRET_PROBE", "leer"))')).toEqual({ answer: 'leer' });
  });
  it('stops runaway scripts', () => {
    expect(blocked('x = bytearray(4 << 30)')).toBeTruthy();
  });
});
