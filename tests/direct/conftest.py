"""Windows compatibility for genlayer-test's direct loader, the value ledger, and the clock.

WHAT THIS SUITE IS FOR, AND WHY IT IS NOT THE ARCHIVE SUITE AGAIN. The decode, gate and judging
logic already has 63 offline tests, run against `_build/holdfast-archive/archive.py` carried here
file is spliced into the contract. Those tests drive the pipeline over real captured bytes under a
hand-written stub, which is what lets them forge a truncated gzip member and a chrome-only page.
This suite runs the assembled contract under the real GenVM SDK, loaded out of the cached tarball,
and that is a different claim: `u256`, `Address`, `TreeMap`, `DynArray` and the `@allow_storage`
dataclass behave as the chain implements them rather than as a stub reimplements them. A contract
can be right about gzip and wrong about `int(gl.message.value)`, about `Address` equality, or about
a storage write that survives a raise.

THE ONE CLAIM THIS SUITE CARRIES ALONE. A payable method that refuses by reverting on StudioNet
keeps the value it was sent: a GenVM revert undoes the storage writes and does not undo the transfer
that funded the call. That was measured on chain, not reasoned about, in transaction 0xc3a12dd2,
which sent 250,000,000,000,000,000 wei into `create_bond` and never got it back. So both payable
methods refuse by RETURNING their tagged sentence and emitting a refund beside it, and this suite is
where that is checkable, because it is the only layer with both a real `gl.message.value` and a
recorder for the transfer that hands it back. `returned_refusal` reads the sentence off the return
value and `value_ledger.retained` proves the money left. `test_create_bond.py` additionally walks
the deterministic refusals in order and proves the stake check is last, which is what turns the
frontend's zero-value simulation into a complete answer rather than one that stops at "no value
attached": that simulation is now a convenience that saves a transaction, not the thing standing
between a typo and a lost stake.

Three pieces of scaffolding, each for a measured property of the harness.

THE UNLINK PATCH. The loader duplicates its temporary message file onto fd 0, then unlinks the path
while that duplicate is still open. POSIX permits that; Windows returns WinError 32. Deferring only
that specific failure to interpreter exit lets the upstream fixture finish, keeps the tests
identical across platforms, and still removes the file rather than leaving it in the temp
directory.

THE VALUE LEDGER. The direct harness has no handler for `EthSend`: a contract can emit a transfer
and the harness will trace "Unknown gl_call request type" and carry on, so a test that does not
watch for the request cannot tell a returned stake from a stranded one. It also credits no value at
all, reporting `self.balance` as zero however much a test sends, which is why every escrow
assertion in this suite is computed from stored bonds plus this ledger and never from the
contract's own balance.

THE CLOCK. `direct_vm.warp()` patches `datetime.now()` and the VM's own timestamp, but the harness
only writes the sender and origin addresses back into `gl.message_raw`. `Holdfast._now()` reads
`gl.message_raw["datetime"]` and returns it as it finds it, so an unmirrored warp leaves the
contract computing an expiry from the empty string. Every test that reaches storage sets the clock.
"""

import atexit
import os
import re
import sys
from pathlib import Path

import pytest


_real_unlink = os.unlink
_deferred: list[str] = []


def _windows_safe_unlink(path, *args, **kwargs):
    try:
        return _real_unlink(path, *args, **kwargs)
    except PermissionError:
        _deferred.append(path)
        return None


os.unlink = _windows_safe_unlink


@atexit.register
def _cleanup_deferred() -> None:
    for path in _deferred:
        try:
            _real_unlink(path)
        except OSError:
            pass


@pytest.fixture
def contract(direct_deploy):
    return direct_deploy("contracts/Holdfast.py")


@pytest.fixture
def archive(direct_vm):
    """An empty mock table this test may register captures into."""
    from archive import Archive

    return Archive(direct_vm)


@pytest.fixture
def archive_server(direct_vm):
    """The same thing under a name that does not shadow the `archive` module.

    A test file that both imports `archive` for its helpers and requests the fixture cannot have
    both under one name: the parameter wins inside the function body and `archive.raw` becomes an
    attribute error on the fixture. Requesting `archive_server` keeps the module reachable, which
    matters most in the files that need `archive.cdx_digest` and `archive.raw` in the same test that
    registers the mocks.
    """
    from archive import Archive

    return Archive(direct_vm)


@pytest.fixture
def bonded(contract, direct_vm, value_ledger):
    """One bond, created against the real gzip capture, whose id is returned.

    Imported inside the fixture rather than at module scope because `bonds` imports this file, and a
    top-level import here would make the two circular. pytest inserts the `tests/direct` directory
    on `sys.path` for conftest, which is what lets both be plain module imports rather than a
    package.
    """
    import bonds

    return bonds.place(contract, direct_vm, value_ledger)


def set_block_time(direct_vm, iso: str) -> str:
    """Move the clock the contract actually reads, and return it for use in assertions.

    Both halves are needed. `warp` moves the VM's timestamp, which is what any SDK call that asks
    the host for a time would see. The `message_raw` write is what `_now()` reads. Setting only the
    first leaves `_now()` returning "", which `_stamp14` turns into a malformed `to=` bound, so the
    test would exercise a query no validator would ever build.
    """
    direct_vm.warp(iso)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = iso
    return iso


_HEX40 = re.compile(r"0x([0-9a-fA-F]{40})")


#: MEASURED, AND A TRAP WORTH NAMING. The SDK's `Address` returns its EIP-55 hex from `str()` and
#: its repr from `format()`, so `str(bob)` is `0x81b6…` while `f"{bob}"` is `Address("0x81b6…")`.
#: Both look right in a diff until the diff is 60 characters wide. Every test in this suite reads
#: `.as_hex` when an address goes into a string it will compare, and never interpolates one.
ADDRESS_IS_NOT_F_STRING_SAFE = True


def address_hex(value) -> str:
    """Normalise whatever an `EthSend` carries as its recipient to lowercase `0x…40`.

    The SDK's `Address` is imported by the loader out of the cached GenVM tarball, so it is not
    importable from the host process and cannot be isinstance-checked here. Hence the accessor
    attempts followed by a repr fallback. The assertion at the end is the part that matters: a
    recipient this function cannot read becomes a failed test, never a transfer silently attributed
    to the wrong account.
    """
    for attr in ("as_hex", "hex"):
        got = getattr(value, attr, None)
        if got is not None:
            text = got() if callable(got) else got
            match = _HEX40.search(str(text) if str(text).startswith("0x") else f"0x{text}")
            if match:
                return "0x" + match.group(1).lower()

    match = _HEX40.search(repr(value))
    assert match, f"could not read an address out of {value!r}"
    return "0x" + match.group(1).lower()


class ValueLedger:
    """Tracks GEN into and out of the contract across a test, to the wei.

    `fund` is the only way a test should attach value to a call. Routing it through here means the
    "paid in" side of the accounting is recorded by the same object that records the "paid out"
    side, so the two cannot drift apart the way they would if each test kept its own running total.
    """

    def __init__(self, vm):
        self._vm = vm
        self.transfers: list[tuple[str, int]] = []
        self.funded = 0

    def fund(self, amount: int) -> int:
        """Attach `amount` wei to the next call and remember that it was sent."""
        self._vm.value = int(amount)
        self.funded += int(amount)
        return int(amount)

    def no_value(self) -> None:
        """Send nothing, which is how the frontend's simulation calls a payable method."""
        self._vm.value = 0

    def _hook(self, vm, request):
        """Record `EthSend`; leave every other request to the harness.

        Returning `None` for anything else is deliberate: the harness treats a hook that returns
        `None` exactly as it treats no hook at all, so installing this cannot change how any other
        host call behaves, including the web mocks the archive module registers.
        """
        send = request.get("EthSend") if isinstance(request, dict) else None
        if send is None:
            return None
        self.transfers.append((address_hex(send["address"]), int(send["value"])))
        return {"ok": None}

    @property
    def paid_out(self) -> int:
        return sum(amount for _, amount in self.transfers)

    @property
    def retained(self) -> int:
        """What the contract is holding, by the ledger's reckoning: in minus out."""
        return self.funded - self.paid_out

    def paid_to(self, account) -> int:
        target = address_hex(account)
        return sum(amount for who, amount in self.transfers if who == target)

    def clear(self) -> None:
        self.transfers.clear()
        self.funded = 0


@pytest.fixture
def value_ledger(direct_vm):
    ledger = ValueLedger(direct_vm)
    direct_vm._gl_call_hook = ledger._hook
    return ledger


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "Holdfast.py"
CONTRACT_SOURCE = CONTRACT_PATH.read_text(encoding="utf-8")


def constant(name: str) -> str:
    """Lift a module-level constant out of the contract source, as written.

    Read rather than restated, for the same reason the frontend tests read it: a limit typed a
    second time in a test proves that the test and the contract were typed by one hand on one
    afternoon, and nothing else. A constant that moves has to break the assertion that depends on
    it, which only happens if the assertion reads the constant.
    """
    match = re.search(rf"^{re.escape(name)} = (.+?)(?:\s+#.*)?$", CONTRACT_SOURCE, re.M)
    assert match, f"the contract no longer declares {name}"
    return match.group(1).strip()


def numeric_constant(name: str) -> int:
    """The same, evaluated, for the constants written as arithmetic like `16 + zlib.MAX_WBITS`."""
    text = constant(name)
    assert re.fullmatch(r"[0-9_ */+e**]+", text), f"{name} is not plain arithmetic: {text}"
    return int(eval(text, {"__builtins__": {}}, {}))  # noqa: S307 - a digits-only literal


def str_constant(name: str) -> str:
    """The same, unquoted, for the state, tag and classification names.

    Used so that an assertion on an outcome reads the contract's own spelling of it. Renaming
    `ST_BREACH_CLAIMED`'s value would then break the test that depends on it, which is the point:
    the interface switches on these strings, so they are part of the contract's surface and not
    private labels.
    """
    text = constant(name)
    assert re.fullmatch(r"""["'].*["']""", text), f"{name} is not a plain string: {text}"
    return text[1:-1]


def user_error_message(exc) -> str:
    """The tagged string a revert carried.

    `gl.vm.UserError.__str__` returns `repr(self)`, so `str(exc)` is
    `UserError(message='[EXPECTED] …')` and a test that matches on `str(exc)` passes on the
    wrapper rather than on the sentence. `.message` is the payload the frontend decodes.
    """
    message = getattr(exc, "message", None)
    if message is None:
        args = getattr(exc, "args", ())
        message = args[0] if args else ""
    return str(message)


#: Every tag a refusal can lead with. Read as a tuple so `startswith` can take all four at once, and
#: kept beside `returned_refusal` because the two are one assertion: a returned string that leads
#: with none of these is not a refusal, it is a receipt.
REFUSAL_TAGS = ("[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]")

#: The same four, one shape further out. A refusal raised by the contract's own `_reject` puts the tag
#: at position 0; a refusal that came out of the embedded region crossed `strict_eq` as
#: `Refusal.message`, which is `repr(self)`, so it arrives as `Refusal([TAG] reason: detail)` with the
#: tag eight characters in. `_refund_and_report` returns whichever it was handed, verbatim and
#: deliberately: rewrapping it would put the boundary's paraphrase between the reader and the
#: measurement. So the accepted heads are both, and the tag is never searched for loosely.
REFUSAL_HEADS = REFUSAL_TAGS + tuple("Refusal(" + tag for tag in REFUSAL_TAGS)


def returned_refusal(value) -> str:
    """The tagged sentence a payable method RETURNED instead of reverting with.

    `create_bond` and `contest_breach` are refusal boundaries: they catch `gl.vm.UserError`, hand the
    value back, and return the refusal's sentence unchanged, tag and all. Nothing about the wording
    moved, so the assertions that read it are the same ones as before; only the delivery moved, from
    an exception a test caught to a string a test is handed.

    Which makes the failure mode worth guarding explicitly. A refusal that stopped happening would no
    longer raise, so a test written as `pytest.raises` would fail loudly, but a test written as
    `assert phrase in contract.create_bond(...)` would compare against a SUCCESS RECEIPT, and the
    receipt is a long string containing the url, the stake and the timestamps. `"must be an https
    URL" in receipt` is false, so that particular case would still fail; `NO_VALUE not in receipt`
    would pass. So the shape check comes first and comes from here rather than from each caller: a
    method that accepted what it should have refused fails on the shape before any phrase is read.
    """
    assert isinstance(value, str), (
        "a payable method answered with %r rather than a string, so there is no refusal to read"
        % (value,))
    assert value.startswith(REFUSAL_HEADS), (
        "expected a tagged refusal and got what reads as a success receipt, which means the call was "
        "ACCEPTED: %s" % value)
    return value
