"""Lifting a function out of the contract source and running it, verbatim, in this process.

WHY THIS IS NOT A RESTATEMENT. Nothing here retypes a rule. The extractor finds a named block in
`contracts/Holdfast.py`, takes its lines exactly as they are written, and hands them to `exec`. A
method is wrapped in a class shell rather than dedented, so not one character of its body is edited
on the way in. If the contract's normalization changes, the code that runs here changes with it.

WHY IT IS WORTH DOING AT ALL, GIVEN THE HARNESS ALREADY LOADS THE CONTRACT. Two of the contract's
deterministic rules are mirrored in TypeScript, and the mirror is what keeps a typo from becoming a
signed transaction. It used to be load bearing for a harder reason: `create_bond` refused by
reverting, and StudioNet does not return `gl.message.value` on a revert, so a rule the client got
wrong stranded a stake. Both payable methods are refusal boundaries now and refund instead, which
lowers the stakes of a wrong mirror without making one correct. Asserting the two agree needs the
Python side of every case, and most cases are not reachable through a public method. `normalize_text`
has no caller that echoes its output, and `_derive_anchor`'s output is only ever visible inside a
refusal message. So `test_parity.py` does both: it runs the whole table through the extracted
source, and it runs a subset through the real SDK to prove the extracted source is the code that
actually executes on chain.

WHAT THIS DELIBERATELY DOES NOT DO. It does not import the contract module. `Holdfast.py` opens with
`from genlayer import *` and its class body is decorated, so importing it means standing up the SDK,
which is exactly what the harness already does better. Extracting the two pure functions costs a
regex and gives a plain callable a test can loop ten thousand cases through.
"""

from __future__ import annotations

import re

from conftest import CONTRACT_SOURCE


def source_block(name: str, indent: int = 0) -> str:
    """The lines that declare `name`, exactly as the contract writes them.

    Handles both a single-line assignment and a `def` block. The block ends at the first line that
    is neither blank nor indented past the declaration, which is the same rule the reader's eye
    uses, and it keeps the original indentation so a method can be re-parsed inside a class shell.
    """
    pad = " " * indent
    opener = re.compile(rf"^{pad}(?:def {re.escape(name)}\(|{re.escape(name)} = )")
    lines = CONTRACT_SOURCE.splitlines()
    start = None
    for i, line in enumerate(lines):
        if opener.match(line):
            start = i
            break
    assert start is not None, f"the contract no longer declares {name} at indent {indent}"

    if not lines[start].lstrip().startswith("def "):
        return lines[start]

    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line.strip() == "":
            end += 1
            continue
        if len(line) - len(line.lstrip()) <= indent:
            break
        end += 1
    return "\n".join(lines[start:end])


def _load() -> dict:
    """Execute the extracted blocks and hand back the callables.

    `re` is the only name the extracted code needs from outside, and it is the stdlib module the
    contract imports under the same name. The class shell is what lets a method be exec'd without
    being edited: its body still opens with `self`, and the instance supplies it.
    """
    namespace: dict = {"re": re}
    text = "\n".join([
        source_block("_WHITESPACE_RUN"),
        source_block("_OUTSIDE_ALPHABET"),
        source_block("normalize_text"),
        "class _Shell(object):",
        source_block("_derive_anchor", indent=4),
    ])
    exec(compile(text, "<Holdfast.py extract>", "exec"), namespace)  # noqa: S102
    return namespace


_NS = _load()

#: The contract's own `normalize_text`, running here.
normalize_text = _NS["normalize_text"]

#: The contract's own `_derive_anchor`, bound to a shell instance so `self` resolves.
derive_anchor = _NS["_Shell"]()._derive_anchor
