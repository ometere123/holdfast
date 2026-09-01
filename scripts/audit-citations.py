"""Print every `Holdfast.py:N` citation next to the claim it makes and the line it lands on.

`verify-citations.mjs` only checks that a cited line exists and is not blank, which is the cheapest
check that catches a citation pointing past the end of the file. It cannot catch a citation that
still lands on code, just not the code it is talking about, and every re-splice of the archive
region shifts every line below it. This is the tool for the audit that has to follow a re-splice:
it puts the sentence and the target side by side so the drift is readable.

Read-only. Prints; changes nothing.
"""

import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = os.path.join(ROOT, "contracts", "Holdfast.py")
CITATION = re.compile(r"Holdfast\.py:(\d+)(?:-(\d+))?")
ROOTS = ["src", "tests", "docs"]
SUFFIXES = (".ts", ".tsx", ".mjs", ".md")

contract = io.open(CONTRACT, encoding="utf-8").read().split("\n")


def ascii_(text):
    return text.encode("ascii", "replace").decode("ascii")


targets = []
for top in ROOTS:
    base = os.path.join(ROOT, top)
    if not os.path.isdir(base):
        continue
    for folder, _dirs, files in os.walk(base):
        for name in sorted(files):
            if name.endswith(SUFFIXES):
                targets.append(os.path.join(folder, name))
for name in ["README.md"]:
    path = os.path.join(ROOT, name)
    if os.path.exists(path):
        targets.append(path)

count = 0
for path in sorted(targets):
    lines = io.open(path, encoding="utf-8").read().split("\n")
    for number, line in enumerate(lines, start=1):
        for match in CITATION.finditer(line):
            count = count + 1
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else start
            rel = os.path.relpath(path, ROOT).replace("\\", "/")
            print("\n[%d] %s:%d  ->  Holdfast.py:%s" % (count, rel, number, match.group(0)[13:]))
            for i in range(max(0, number - 3), min(len(lines), number + 1)):
                mark = ">" if i + 1 == number else " "
                print("   %s %s" % (mark, ascii_(lines[i].strip()[:150])))
            print("   --- lands on ---")
            for i in range(start, min(end, start + 3) + 1):
                if 1 <= i <= len(contract):
                    print("   %5d %s" % (i, ascii_(contract[i - 1][:150])))
print("\n%d citations" % count)
