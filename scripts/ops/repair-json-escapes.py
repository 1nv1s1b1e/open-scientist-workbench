#!/usr/bin/env python3
"""Repair JSON files corrupted by the win-path rewrite: single backslashes
that start invalid JSON escapes (e.g. \\examples) are rewritten to forward
slashes. Valid escapes (\" \\ / b f n r t u) are preserved. Validates with
json.loads and keeps a .corrupt.bak next to each repaired file."""
import glob
import json
import re
import shutil

BAD = re.compile(r'\\(?!"\\/bfnrtu)')
BAD = re.compile(r'\\(?!["\\/bfnrtu])')


def repair_text(raw: str) -> str:
    fixed = BAD.sub('/', raw)
    for _ in range(3):
        try:
            json.loads(fixed)
            return fixed
        except json.JSONDecodeError:
            new = BAD.sub('/', fixed)
            if new == fixed:
                return fixed
            fixed = new
    return fixed


def main() -> None:
    targets = []
    for pattern in [
        'data/dataset/*/manifest.json',
        'data/dataset/*/*.json',
    ]:
        targets.extend(glob.glob(pattern))
    targets = sorted(set(targets))
    repaired = 0
    for path in targets:
        try:
            with open(path, encoding='utf-8') as f:
                raw = f.read()
            json.loads(raw)
            continue  # already valid
        except json.JSONDecodeError:
            pass
        except Exception as exc:  # unreadable etc.
            print('SKIP', path, exc)
            continue
        fixed = repair_text(raw)
        try:
            json.loads(fixed)
        except json.JSONDecodeError as exc:
            print('STILL-BROKEN', path, exc)
            continue
        shutil.copy(path, path + '.corrupt.bak')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(fixed)
        repaired += 1
        print('REPAIRED', path)
    print('scanned', len(targets), 'repaired', repaired)


if __name__ == '__main__':
    main()
