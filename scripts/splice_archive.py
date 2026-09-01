#!/usr/bin/env python3
"""Splice the archive path into the Holdfast contract, and prove the copy still behaves.

A GenLayer Intelligent Contract is a single module and cannot import a sibling Python file. So
`_build/holdfast-archive/archive.py` is written and unit-tested standalone, then copied verbatim
into `holdfast/contracts/Holdfast.py` between two markers. Copying code is how copies drift, and
the copy is the one that runs on chain, so the copy is what this script checks.

    python holdfast/scripts/splice_archive.py --write     # splice, then verify
    python holdfast/scripts/splice_archive.py             # verify only, exit 1 on drift

Verification has three layers, because the cheap one is not enough on its own.

TEXTUAL: the region between the markers must be byte-identical to `archive.py` from `__all__ = [`
to end of file. This catches an edit made in the contract instead of in the source.

STRUCTURAL: the spliced region is re-parsed and the two invariants that the standalone suite can
only check by reading its own source file are checked again HERE, against the region that actually
ships. Those two tests (`test_there_is_no_raw_deflate_branch` and
`test_archive_module_is_stdlib_only_with_no_io`) open `archive.py` from disk by absolute path, so
when the suite is re-run against the spliced copy they pass without looking at it. That is not a
failure of those tests, it is a limit of them, and closing it here is the point of this layer
rather than something to leave implied.

BEHAVIOURAL: the region is executed as a module named `archive`, injected into `sys.modules`, and
the full standalone suite is run against that module. If a splice truncates a function, drops a
constant, or lands inside a string literal, this is the layer that says so.

The region deliberately starts at `__all__ = [` rather than at the first import. Every constant,
class and function in `archive.py` is defined after `__all__`, and its five imports are hoisted
into the contract's own head where a reviewer can see them next to `from genlayer import *`.
"""

import ast
import io
import os
import sys
import hashlib
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
REPO = os.path.dirname(PROJECT)

SOURCE = os.path.join(REPO, "_build", "holdfast-archive", "archive.py")
SUITE_DIR = os.path.join(REPO, "_build", "holdfast-archive")
CONTRACT = os.path.join(PROJECT, "contracts", "Holdfast.py")

REGION_ANCHOR = "__all__ = ["
BEGIN = "# BEGIN embedded archive path"
END = "# END embedded archive path"

#: The five modules the region needs, hoisted into the contract head. `archive.py`'s own
#: stdlib-only test pins this exact set, so a sixth import appearing in the source is a signal
#: that the contract head needs updating too, not something to paper over here.
REGION_IMPORTS = ("base64", "hashlib", "json", "re", "zlib")

#: What the contract's own head is allowed to import, on top of the five above.
CONTRACT_EXTRA_IMPORTS = ("genlayer", "dataclasses")

#: Mirrored from `test_archive_module_is_stdlib_only_with_no_io`.
BANNED_CALLS = {"open", "input", "eval", "exec", "compile", "__import__", "globals",
                "locals", "print"}
BANNED_ATTRS = {"urlopen", "socket", "system", "popen", "getenv", "environ", "time",
                "now", "utcnow", "monotonic", "random", "urandom", "read_bytes",
                "read_text", "write_bytes"}
BANNED_TOUCHES = ("environ", "argv", "stdin", "stdout", "stderr")

#: The two tests that read `archive.py` from disk and therefore say nothing about the splice.
#: Named here so the report can state which checks were re-run rather than trusted.
VACUOUS_AGAINST_SPLICE = (
    "test_there_is_no_raw_deflate_branch",
    "test_archive_module_is_stdlib_only_with_no_io",
)


def read(path):
    return io.open(path, encoding="utf-8", newline="").read()


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def source_region():
    """`archive.py` from `__all__ = [` at column 0 to end of file."""
    source = read(SOURCE)
    marker = "\n" + REGION_ANCHOR
    at = source.find(marker)
    if at < 0:
        raise SystemExit("no %r at column 0 in %s" % (REGION_ANCHOR, SOURCE))
    if source.find(marker, at + 1) >= 0:
        raise SystemExit("%r appears twice in %s; the region start is ambiguous"
                         % (REGION_ANCHOR, SOURCE))
    region = source[at + 1:]
    if not region.endswith("\n"):
        region = region + "\n"
    return source, region


def split_contract():
    """The contract as (head, current region, tail), split on the two markers."""
    text = read(CONTRACT)
    begin = text.find(BEGIN)
    end = text.find(END)
    if begin < 0:
        raise SystemExit("no %r marker in %s" % (BEGIN, CONTRACT))
    if end < 0:
        raise SystemExit("no %r marker in %s" % (END, CONTRACT))
    if end < begin:
        raise SystemExit("the END marker precedes the BEGIN marker in %s" % CONTRACT)
    if text.find(BEGIN, begin + 1) >= 0 or text.find(END, end + 1) >= 0:
        raise SystemExit("a marker appears more than once in %s" % CONTRACT)

    # The region runs from the end of the BEGIN marker's comment block to the start of the END
    # marker's. Both markers sit inside a banner of `# ===` rules, so the split is taken at the
    # blank line after the banner that follows BEGIN, and at the banner rule before END.
    head_end = text.index("\n", begin)
    while True:
        nxt = text.index("\n", head_end + 1)
        line = text[head_end + 1:nxt]
        if not line.startswith("#"):
            break
        head_end = nxt
    tail_start = text.rindex("\n# " + "=" * 10, head_end, end)

    return text[:head_end + 1], text[head_end + 1:tail_start + 1], text[tail_start + 1:]


def write_splice():
    _, region = source_region()
    head, current, tail = split_contract()
    if current.strip() == region.strip():
        print("region already current; nothing rewritten")
        return
    body = "\n" + region + "\n"
    io.open(CONTRACT, "w", encoding="utf-8", newline="\n").write(head + body + tail)
    print("spliced %d lines (%d bytes) of %s into %s"
          % (region.count("\n"), len(region.encode("utf-8")),
             os.path.basename(SOURCE), os.path.relpath(CONTRACT, REPO)))


# ----------------------------------------------------------------------------------
# Layer 1: textual
# ----------------------------------------------------------------------------------

def check_textual(region, current):
    want = sha256(region)
    got = sha256(current.strip("\n") + "\n")
    if want != got:
        print("  FAIL region differs from source")
        print("       source region sha256 %s (%d lines)" % (want, region.count("\n")))
        print("       spliced region sha256 %s (%d lines)" % (got, current.count("\n")))
        want_lines = region.splitlines()
        got_lines = current.strip("\n").splitlines()
        for i in range(min(len(want_lines), len(got_lines))):
            if want_lines[i] != got_lines[i]:
                print("       first difference at region line %d:" % (i + 1))
                print("         source:  %r" % want_lines[i][:120])
                print("         spliced: %r" % got_lines[i][:120])
                break
        else:
            print("       identical for %d lines, then the lengths diverge (%d vs %d)"
                  % (min(len(want_lines), len(got_lines)), len(want_lines), len(got_lines)))
        return False
    print("  pass region is byte-identical to source, sha256 %s, %d lines"
          % (want, region.count("\n")))
    return True


# ----------------------------------------------------------------------------------
# Layer 2: structural, run against the spliced region rather than against archive.py
# ----------------------------------------------------------------------------------

def check_region_has_no_imports(tree):
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.append(node.module or ".")
    if found:
        print("  FAIL the region imports %s; those imports belong in the contract head, above "
              "the BEGIN marker, because a contract cannot import mid-module and a reviewer "
              "cannot see them buried in a splice" % ", ".join(sorted(set(found))))
        return False
    print("  pass the region declares no imports of its own; its five are hoisted into the "
          "contract head")
    return True


def check_contract_imports(contract_tree):
    imported = set()
    for node in ast.walk(contract_tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                print("  FAIL relative import in a contract module")
                return False
            imported.add((node.module or "").split(".")[0])
    want = set(REGION_IMPORTS) | set(CONTRACT_EXTRA_IMPORTS)
    if imported != want:
        missing = sorted(want - imported)
        extra = sorted(imported - want)
        print("  FAIL contract imports drifted; missing %s, unexpected %s"
              % (missing or "none", extra or "none"))
        return False
    print("  pass contract head imports exactly %s" % ", ".join(sorted(want)))
    return True


def check_no_raw_deflate(tree, region):
    """Mirrors `test_there_is_no_raw_deflate_branch`, against the copy that ships.

    Raw deflate has no header and no checksum, so `zlib.decompress(raw, -zlib.MAX_WBITS)` inside a
    bare `except zlib.error` is not a safe probe: it succeeds on bytes that were never deflate and
    returns plausible garbage, identically for every validator, which is agreement on noise. The
    negative wbits constant is the only thing needed to bring the branch back, so its absence is
    the guard.
    """
    if "_raw_deflate" in region:
        print("  FAIL the raw-deflate probe came back into the region")
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            operand = node.operand
            if isinstance(operand, ast.Attribute) and operand.attr == "MAX_WBITS":
                print("  FAIL the region contains -zlib.MAX_WBITS")
                return False
            if isinstance(operand, ast.Constant) and operand.value == 15:
                print("  FAIL the region contains a literal -15 window size")
                return False
    print("  pass no raw-deflate branch and no negative window size in the region")
    return True


def check_no_io(tree, label):
    ok = True
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            target = node.func
            if isinstance(target, ast.Name) and target.id in BANNED_CALLS:
                print("  FAIL %s calls %s()" % (label, target.id))
                ok = False
            if isinstance(target, ast.Attribute) and target.attr in BANNED_ATTRS:
                print("  FAIL %s calls .%s()" % (label, target.attr))
                ok = False
        if isinstance(node, ast.Attribute) and node.attr in BANNED_TOUCHES:
            print("  FAIL %s touches %s" % (label, node.attr))
            ok = False
    if ok:
        print("  pass %s makes no filesystem, clock, randomness or stream call" % label)
    return ok


def check_no_mutable_module_state(tree):
    """Module-level state must be immutable: the spliced copy is shared by every validator.

    Mirrors the standalone suite's own rule, including its two exemptions. `__all__` is read only
    by the suite, and `_NAMED_ENTITY` is the HTML entity table read by `extract_text`, which the
    mutation check below proves is never written to. Everything else at module level has to be a
    tuple or a frozenset, and `set(...)` / `dict(...)` / `list(...)` / `bytearray(...)` are banned
    outright because a builder call is the form that reads as immutable and is not.
    """
    exempt = ("_NAMED_ENTITY", "__all__")
    builders = ("set", "list", "dict", "bytearray")
    ok = True
    module_names = set()
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        module_names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            if isinstance(node.value, (ast.List, ast.Dict, ast.Set)):
                if target.id not in exempt:
                    print("  FAIL module-level mutable container: %s must be a tuple or a "
                          "frozenset" % target.id)
                    ok = False
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) \
                    and node.value.func.id in builders:
                print("  FAIL module-level %s(): %s must be a tuple or a frozenset"
                      % (node.value.func.id, target.id))
                ok = False

    mutators = ("update", "setdefault", "popitem", "append", "extend", "add", "discard",
                "clear", "pop", "insert", "remove", "sort")
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr in mutators \
                and isinstance(node.func.value, ast.Name) \
                and node.func.value.id in module_names:
            print("  FAIL the region mutates module-level %s with .%s()"
                  % (node.func.value.id, node.func.attr))
            ok = False

    if ok:
        print("  pass module-level state in the region is immutable and never mutated (%s "
              "excepted, and read only)" % ", ".join(exempt))
    return ok


def contract_constant(contract_tree, name):
    """One module-level integer constant from the contract head, or None."""
    for node in contract_tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == name:
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, int):
                    return node.value.value
    return None


def check_exports_present(module, expected_callables=None):
    missing = [name for name in module.__all__ if not hasattr(module, name)]
    if missing:
        print("  FAIL the spliced region exports names it does not define: %s"
              % ", ".join(missing))
        return False
    functions = sum(1 for name in module.__all__ if callable(getattr(module, name)))
    if expected_callables is not None and functions != expected_callables:
        print("  FAIL the region exposes %d callables; the contract declares "
              "EMBEDDED_FUNCTION_COUNT = %d. A splice that silently drops a function would "
              "otherwise only surface as a NameError on a live bond."
              % (functions, expected_callables))
        return False
    print("  pass all %d exported names resolve in the spliced region (%d callable, matching "
          "the contract's declared count)" % (len(module.__all__), functions))
    return True


# ----------------------------------------------------------------------------------
# Layer 3: behavioural
# ----------------------------------------------------------------------------------

def load_region_as_module(region):
    """Execute the spliced region as a module named `archive`, with only its five imports."""
    import types
    module = types.ModuleType("archive")
    module.__file__ = CONTRACT + " (embedded region)"
    for name in REGION_IMPORTS:
        setattr(module, name, __import__(name))
    code = compile(region, "<Holdfast.py embedded archive path>", "exec")
    exec(code, module.__dict__)                                          # noqa: S102
    return module


def run_suite_against(module):
    """Run the standalone suite with `archive` bound to the spliced copy."""
    if SUITE_DIR not in sys.path:
        sys.path.insert(0, SUITE_DIR)
    sys.modules["archive"] = module
    for stale in ("test_archive",):
        sys.modules.pop(stale, None)
    import test_archive

    tests = [(name, obj) for name, obj in sorted(vars(test_archive).items())
             if name.startswith("test_") and callable(obj)]
    passed, failed = 0, []
    for name, test in tests:
        try:
            test()
        except Exception:                                                # noqa: BLE001
            failed.append(name)
            print("  FAIL %s" % name)
            traceback.print_exc()
        else:
            passed += 1
    return passed, failed, len(tests)


def main(argv):
    write = "--write" in argv[1:]
    quiet = "--quiet" in argv[1:]

    if write:
        write_splice()
        print("")

    source, region = source_region()
    _, current, _ = split_contract()

    print("splice guard: %s -> %s" % (os.path.relpath(SOURCE, REPO),
                                      os.path.relpath(CONTRACT, REPO)))
    print("  source file sha256 %s (%d lines)" % (sha256(source), source.count("\n")))
    print("")

    if current.strip() == "":
        print("  FAIL the region between the markers is empty; run with --write first")
        return 1

    results = []
    print("textual")
    results.append(check_textual(region, current))
    print("")

    print("structural, against the spliced region and not against archive.py")
    try:
        tree = ast.parse(current)
    except SyntaxError as exc:
        print("  FAIL the spliced region does not parse: %s at line %s" % (exc.msg, exc.lineno))
        return 1
    contract_tree = ast.parse(read(CONTRACT))
    results.append(check_region_has_no_imports(tree))
    results.append(check_contract_imports(contract_tree))
    results.append(check_no_raw_deflate(tree, current))
    results.append(check_no_io(tree, "the region"))
    results.append(check_no_io(contract_tree, "the contract"))
    results.append(check_no_mutable_module_state(tree))
    print("")

    print("behavioural, the standalone suite re-run against the spliced copy")
    try:
        module = load_region_as_module(current)
    except Exception as exc:                                             # noqa: BLE001
        print("  FAIL the region will not execute as a module: %r" % (exc,))
        traceback.print_exc()
        return 1
    results.append(check_exports_present(
        module, contract_constant(contract_tree, "EMBEDDED_FUNCTION_COUNT")))
    passed, failed, total = run_suite_against(module)
    if failed:
        print("  FAIL %d of %d tests failed against the spliced copy: %s"
              % (len(failed), total, ", ".join(failed)))
        results.append(False)
    else:
        print("  pass %d of %d tests pass against the spliced copy" % (passed, total))
        results.append(True)
    print("  note %d of those %d read archive.py from disk by absolute path, so they say "
          "nothing about the splice: %s. Both are re-checked above, against the region."
          % (len(VACUOUS_AGAINST_SPLICE), total, ", ".join(VACUOUS_AGAINST_SPLICE)))
    print("")

    if all(results):
        print("splice verified: %d checks, %d tests, region sha256 %s"
              % (len(results), total, sha256(region)))
        return 0
    print("splice NOT verified: %d of %d checks failed"
          % (len([r for r in results if not r]), len(results)))
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
