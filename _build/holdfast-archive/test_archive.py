"""Tests for archive.py. Run directly:

    timeout 300 python _build/holdfast-archive/test_archive.py

Stdlib only, no network. Reads the captured fixtures in `_build/fixtures/holdfast/` and never
prints a body: one of them is 2,044,592 bytes.

Every number below is tagged with where it comes from:

    PRD      pinned in genlayer-prds/06-holdfast.md
    MANIFEST pinned in _build/fixtures/holdfast/manifest.json
    MEASURED measured by me from the bytes on disk, in this environment
    MINE     chosen by me because nothing pins it

Two PRD claims are asserted here in CORRECTED form, and both corrections are load bearing.

1. "Gates B, C and D each caught 4 of 4 bad snapshots" (PRD section 2) is WITHDRAWN. There were
   no bad snapshots. The measuring script fetched through `id_` without decoding, so four
   faithful gzip captures scored 0 of N and read as gutted. That finding WAS the gzip trap. All
   five captured content payloads QUALIFY once decoded, measured below. The gates have no true
   positive from the live archive, and the only negative case in the project is
   snap-github-tos-chrome-only, which is synthetic and labelled so in the manifest.

2. "A build that skips gzip decoding fails five of these nine" (PRD section 11) is TRUE, and the
   fifth member is snap-gcp-deprecation-incomplete, not the oversize capture. That file was
   declared a truncated capture that the terminal gate must reject. It is not truncated: it is a
   complete gzip stream that decodes to 696,794 bytes and closes with `</body></html>`. The
   oversize capture is identity, magic 3c21, and never enters the decode branch at all.
"""

import ast
import io
import os
import sys
import traceback
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import archive                                                        # noqa: E402
from archive import (EXPECTED, EXTERNAL, TRANSIENT, Decoded, GateSpec,  # noqa: E402
                     Refusal, is_refusal)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
# tests/fixtures/holdfast/, not _build/fixtures/holdfast/: the former is what this repo actually
# commits and what CI actually clones. An earlier version pointed at the latter, a local
# development workspace path that exists on one machine only, which is why this suite had never
# once been run from a fresh clone before this pass.
FIXTURES = os.path.join(REPO, "tests", "fixtures", "holdfast")
# A cross-project harness this repo does not own or commit. See
# test_reference_parity_and_the_one_deliberate_divergence, the one test that reads this: it
# skips rather than fails when the harness is not present, because a workspace-external tool
# outside this repo's reproducible surface cannot be a hard requirement for CI or a fresh clone.
REFERENCE = os.path.join(os.path.dirname(REPO), "_build", "harness", "verify_fixtures.py")

_CACHE = {}


def fixture(name):
    """Raw bytes of a captured fixture. Cached, because one of them is 2 MB."""
    if name not in _CACHE:
        path = os.path.join(FIXTURES, name)
        if not os.path.exists(path):
            raise AssertionError("fixture missing: %s" % path)
        _CACHE[name] = io.open(path, "rb").read()
    return _CACHE[name]


# ---------------------------------------------------------------------------
# MEASURED from the bytes on disk. Every one of these also appears in the manifest `expect`
# blocks, so a mismatch means either the capture or the manifest drifted.
# ---------------------------------------------------------------------------

GITHUB = "snap-github-tos-gzip.bin"
AWS = "snap-aws-terms-gzip.bin"
GCP_TERMS = "snap-gcp-terms-gzip.bin"
OPENAI_GZIP = "snap-openai-tou-gzip.bin"
OPENAI_IDENTITY = "snap-openai-tou-identity.bin"
GCP_DEPRECATION = "snap-gcp-deprecation-incomplete.bin"   # route renamed to -gzip; file name kept
OVERSIZE = "snap-gcp-deprecation-oversize.bin"
CHROME_ONLY = "snap-github-tos-chrome-only.bin"

# name -> (raw bytes, magic, decoded bytes, encoding, cdx digest, extracted text chars)
MEASURED = {
    GITHUB: (72427, "1f8b", 372058, "gzip", "FO4FOH4ODHA2OQAWMSTZX2GKFRFINKYI", 48934),
    AWS: (215912, "1f8b", 1056588, "gzip", "4MTV3WACV5B5KT3BBAPQSD5CWZ5WNET2", 302245),
    GCP_TERMS: (89652, "1f8b", 819751, "gzip", "ORCARP7HGOXUBBYK4LXACZM7GU5ZBMMY", 89605),
    OPENAI_GZIP: (51163, "1f8b", 364722, "gzip", "5FIEYLXIZ5ZWZ3JZ6UKC4PZU3ORVRTGM", 22024),
    OPENAI_IDENTITY: (178326, "3c21", 178326, "identity",
                      "LK2MDGSANFLNLZKXNJNKGZRBLQ77MRS3", 21241),
    GCP_DEPRECATION: (61023, "1f8b", 696794, "gzip",
                      "PED5JCATNRK4LVPLJT6UU3IL5LORLJQO", 35398),
    OVERSIZE: (2044592, "3c21", 2044592, "identity",
               "4SP7LO2EL5VJ5AZXVGNBSPB6GJNAABE7", 35689),
    CHROME_ONLY: (8015, "1f8b", 35640, "gzip", "Z52OSEZWRK7IEMB5Z2P74ALCGUYQPHV3", 569),
}

# MEASURED: exactly six of the eight payloads are gzip and exactly two are identity. Excluding
# the one synthetic file, the captured set is five gzip and two identity, which is what makes the
# "five of nine" claim in PRD section 11 arithmetically true.
GZIP_MAGIC_COUNT_ALL = 6
IDENTITY_MAGIC_COUNT_ALL = 2
GZIP_MAGIC_COUNT_CAPTURED = 5
IDENTITY_MAGIC_COUNT_CAPTURED = 2
SYNTHETIC = {CHROME_ONLY}

# MANIFEST timestamps.
TS_GITHUB = "20260822123203"
TS_AWS = "20260815145826"
TS_GCP_TERMS = "20260129024608"
TS_OPENAI_GZIP = "20260822225356"
TS_OPENAI_IDENTITY = "20240530181101"
TS_GCP_DEPRECATION = "20231208083742"
TS_OVERSIZE = "20260316010536"
TS_INEXACT = "20230320142125"          # one second past a real capture
TS_EXACT_NEIGHBOUR = "20230320142124"  # PRD section 2: exact, 200, digest matches

# MANIFEST: the oversize route. PRD section 2 caps CDX length at 250,000.
OVERSIZE_CDX_LENGTH = 260662

# PRD section 2: the gate A pair on cloud.google.com/terms/deprecation. The larger figure is
# MEASURED here from the oversize capture; the smaller one is PRD-pinned and its capture is not
# in this fixture set.
SPA_FAITHFUL_CHARS = 2738
SPA_INFLATED_CHARS = 35689

# MEASURED locally by _scan/m06/probe_deflate.py: the two shapes on which a naive raw-deflate
# probe SUCCEEDS and returns garbage instead of raising.
DEFLATE_FP_JSON_LEN = 71095
DEFLATE_FP_JSON_OUT = 1
DEFLATE_FP_JSON_UNUSED = 71092
DEFLATE_FP_JSON_EOF = True

# MINE. The manifest declares an anchor and sections per page but no terminal marker, so gate D
# has no declared input anywhere. These are chosen: each is measured present in its page, and each
# satisfies the gate D independence rule. "governing law" is the manifest's declared terminal for
# the chrome-only fixture, which was derived from the GitHub capture, so GitHub inherits it.
SPECS = {
    GITHUB: ("terms of service", ("account", "license", "termination", "disclaimer"),
             "governing law"),
    AWS: ("service terms", ("universal service terms", "amazon", "content"), "notices"),
    GCP_TERMS: ("terms of service", ("definitions", "payment", "confidential"),
                "governing law"),
    OPENAI_GZIP: ("terms of use", ("registration", "content", "termination"), "governing law"),
    OPENAI_IDENTITY: ("terms of use", ("registration", "content", "termination"),
                      "governing law"),
    CHROME_ONLY: ("terms of service", ("account", "license", "termination", "disclaimer"),
                  "governing law"),
}


def spec_for(name, enable_gate_a=False):
    anchor, sections, terminal = SPECS[name]
    return GateSpec(anchor, sections, terminal, enable_gate_a=enable_gate_a)


# ---------------------------------------------------------------------------
# The captured corpus
# ---------------------------------------------------------------------------

def test_every_fixture_matches_its_measured_shape():
    """Raw size, magic bytes, decoded size, encoding, CDX digest and text length, all eight."""
    print("")
    print("    %-38s %8s %6s %10s %8s %7s" % ("fixture", "raw", "magic", "decoded", "kind",
                                              "text"))
    for name in sorted(MEASURED):
        raw_len, magic, decoded_len, kind, digest, text_len = MEASURED[name]
        raw = fixture(name)
        assert len(raw) == raw_len, (name, len(raw), raw_len)
        assert archive.magic_hex(raw) == magic, (name, archive.magic_hex(raw))
        assert archive.cdx_digest(raw) == digest, (name, archive.cdx_digest(raw))
        result = archive.decode_checked(raw)
        assert isinstance(result, Decoded), (name, result)
        assert result.encoding == kind, (name, result.encoding)
        assert len(result) == decoded_len, (name, len(result))
        text = archive.extract_text(result.data)
        assert len(text) == text_len, (name, len(text), text_len)
        print("    %-38s %8d %6s %10d %8s %7d"
              % (name, raw_len, magic, decoded_len, kind, text_len))


def test_magic_byte_census_is_exact():
    """Exact counts, not floors. MEASURED across every .bin in the fixture directory."""
    on_disk = sorted(f for f in os.listdir(FIXTURES) if f.endswith(".bin"))
    assert set(on_disk) == set(MEASURED), (set(on_disk) ^ set(MEASURED))

    gzip_all = [n for n in on_disk if archive.magic_hex(fixture(n)) == "1f8b"]
    identity_all = [n for n in on_disk if archive.magic_hex(fixture(n)) == "3c21"]
    assert len(gzip_all) + len(identity_all) == len(on_disk), "a third magic appeared"
    assert len(gzip_all) == GZIP_MAGIC_COUNT_ALL, gzip_all
    assert len(identity_all) == IDENTITY_MAGIC_COUNT_ALL, identity_all

    captured_gzip = [n for n in gzip_all if n not in SYNTHETIC]
    captured_identity = [n for n in identity_all if n not in SYNTHETIC]
    assert len(captured_gzip) == GZIP_MAGIC_COUNT_CAPTURED, captured_gzip
    assert len(captured_identity) == IDENTITY_MAGIC_COUNT_CAPTURED, captured_identity

    # The oversize capture is identity, NOT gzip. That is the correction: it never enters the
    # decode branch, so it cannot be the fifth member of the gzip set.
    assert OVERSIZE in captured_identity
    assert OVERSIZE not in gzip_all
    assert GCP_DEPRECATION in captured_gzip, "the fifth gzip member"
    # And not one payload is raw deflate, which is why there is no raw-deflate branch.
    assert not [n for n in on_disk if archive.magic_hex(fixture(n)) not in ("1f8b", "3c21")]


def test_the_file_named_incomplete_is_a_complete_document():
    """MEASURED. It was declared truncated and gate-rejectable. Both claims are false.

    A complete gzip stream, 61,023 raw to 696,794 decoded, closing with `</body></html>` in the
    same shape as the tail of the QUALIFIED GCP terms capture. There is nothing for a decoder or a
    gate to catch. Its value is that it is the fifth gzip member, and without it the "five of
    nine" claim in PRD section 11 is only four.
    """
    raw = fixture(GCP_DEPRECATION)
    assert archive.magic_hex(raw) == "1f8b"
    assert len(raw) == 61023

    result = archive.decode_checked(raw)
    assert isinstance(result, Decoded), result
    assert result.encoding == "gzip"
    assert len(result) == 696794

    # Complete: the stream reached its own declared end, and the document closes properly.
    tail = result.data[-40:].decode("utf-8", "replace")
    assert tail.rstrip().endswith("</html>"), repr(tail)
    assert "</body>" in tail, repr(tail)
    # The same closing shape as a capture that is agreed to be faithful.
    good_tail = archive.decode_checked(fixture(GCP_TERMS)).data[-40:].decode("utf-8", "replace")
    assert good_tail.rstrip().endswith("</html>")
    assert tail == good_tail, "declared truncated, yet byte-identical in its last 40 bytes"

    # And it is not a blank frame: 35,398 characters of extracted text.
    assert len(archive.extract_text(result.data)) == 35398


# ---------------------------------------------------------------------------
# 4. The four gates
# ---------------------------------------------------------------------------

def test_all_five_captured_content_payloads_qualify():
    """The corrected gate result. PRD section 2's "4 of 4 bad snapshots" is withdrawn.

    Every captured page with a declared anchor and sections QUALIFIES once decoded. There is no
    true positive for the gates anywhere in the live archive.
    """
    qualified = []
    for name in (GITHUB, AWS, GCP_TERMS, OPENAI_GZIP, OPENAI_IDENTITY):
        spec = spec_for(name)
        assert spec.validate() is None, (name, spec.validate())
        result = archive.admit_snapshot(fixture(name), MEASURED[name][4], spec)
        assert not is_refusal(result), (name, result)
        q = result.qualification
        assert q.gate_b is True, name
        assert q.gate_c is True and q.gate_c_hits == q.gate_c_total, (name, q.gate_c_hits)
        assert q.gate_d is True, name
        assert q.qualified is True, (name, q.failed_gates)
        assert q.failed_gates == (), (name, q.failed_gates)
        qualified.append(name)
    assert len(qualified) == 5, qualified


def test_chrome_only_shell_is_the_gates_only_negative_case():
    """The one case in the project where a gate fires, and WHICH gate fires is the point.

    MANIFEST expectations for snap-github-tos-chrome-only, all asserted individually:
    B PASS, C 0 of 4 FAIL, D FAIL, composite REJECTED, 569 characters of visible text.

    Gate B passing is required, not incidental. A shell keeps its head, so the title anchor
    survives and B cannot catch it. C and D must. This is the only evidence in the project that
    B, C and D do separate work rather than being one gate wearing three names.
    """
    raw = fixture(CHROME_ONLY)
    assert archive.magic_hex(raw) == "1f8b", "the shell is gzip, so no decoder catches it"
    assert archive.cdx_digest(raw) == "Z52OSEZWRK7IEMB5Z2P74ALCGUYQPHV3"

    spec = spec_for(CHROME_ONLY)
    assert spec.validate() is None, spec.validate()
    result = archive.admit_snapshot(raw, archive.cdx_digest(raw), spec)
    assert not is_refusal(result), result
    assert result.encoding == "gzip" and len(result.decoded) == 35640

    q = result.qualification
    assert q.gate_b is True, "gate B must PASS: the shell kept its title"
    assert q.gate_c is False, "gate C must FAIL"
    assert (q.gate_c_hits, q.gate_c_total) == (0, 4), (q.gate_c_hits, q.gate_c_total)
    assert q.gate_d is False, "gate D must FAIL: no terminal marker survives"
    assert q.qualified is False
    assert q.failed_gates == ("C", "D"), q.failed_gates
    assert q.text_len == 569, q.text_len

    # It decodes cleanly and closes with </html>, so only the gate can catch it.
    assert result.decoded.data.rstrip().endswith(b"</html>")

    # Same page, same spec, intact capture: qualifies. The gate discriminates between the two
    # rather than rejecting everything from this URL.
    good = archive.admit_snapshot(fixture(GITHUB), MEASURED[GITHUB][4], spec_for(GITHUB))
    assert good.qualified is True
    assert good.qualification.text_len == 48934
    # 569 against 48,934 characters: the shell kept 1.2 percent of the visible text.
    assert round(100.0 * 569 / 48934, 1) == 1.2


def test_gate_c_requires_n_minus_one_of_n():
    """N-1 of N, checked by narrowing a real spec against a real document."""
    raw = fixture(GITHUB)
    decoded = archive.decode_checked(raw).data
    text = archive.extract_text(decoded)
    anchor, sections, terminal = SPECS[GITHUB]

    full = archive.qualify(text, GateSpec(anchor, sections, terminal))
    assert (full.gate_c_hits, full.gate_c_total) == (4, 4)
    assert full.gate_c is True and full.qualified is True

    # Three real sections plus one that is not in the document: 3 of 4 still passes.
    with_miss = GateSpec(anchor, sections[:3] + ("force majeure indemnity clause",), terminal)
    assert with_miss.validate() is None, with_miss.validate()
    result = archive.qualify(text, with_miss)
    assert (result.gate_c_hits, result.gate_c_total) == (3, 4)
    assert result.gate_c is True and result.qualified is True

    # Two of four fails.
    two_missing = GateSpec(anchor,
                           sections[:2] + ("force majeure indemnity clause",
                                           "no such heading anywhere"),
                           terminal)
    result = archive.qualify(text, two_missing)
    assert (result.gate_c_hits, result.gate_c_total) == (2, 4)
    assert result.gate_c is False and result.qualified is False
    assert result.failed_gates == ("C",)


def test_gate_d_terminal_must_be_independent_of_every_other_input():
    """PRD section 5, new rule. The two degenerate markers that prompted it are the first two.

    A terminal marker that is the anchor, or one of the sections, cannot fail unless B or C has
    already failed. It contributes nothing, and the composite is three gates wearing four names.
    """
    aws_anchor, aws_sections, _ = SPECS[AWS]
    gcp_anchor, gcp_sections, _ = SPECS[GCP_TERMS]

    degenerate = [
        # MEASURED from the PRD's own declared markers: AWS's terminal WAS its anchor.
        (aws_anchor, aws_sections, "service terms", "anchor"),
        # And GCP's WAS one of its own sections.
        (gcp_anchor, gcp_sections, "definitions", "section"),
        # Substring, both directions, both targets.
        (aws_anchor, aws_sections, "end of service terms", "anchor"),
        (aws_anchor, aws_sections, "servic", "anchor"),
        (gcp_anchor, gcp_sections, "payment", "section"),
        (gcp_anchor, gcp_sections, "confidential information", "section"),
    ]
    for anchor, sections, terminal, target in degenerate:
        refusal = GateSpec(anchor, sections, terminal).validate()
        assert is_refusal(refusal), (terminal, target)
        assert refusal.tag == EXPECTED, refusal
        assert refusal.reason == "gate-spec-terminal-not-independent", (terminal, refusal)
        assert target in refusal.detail, (terminal, refusal.detail)

    # The terminals actually used are independent, and each is measured present in its page.
    for name in (GITHUB, AWS, GCP_TERMS, OPENAI_GZIP, OPENAI_IDENTITY, CHROME_ONLY):
        assert spec_for(name).validate() is None, name
    for name in (GITHUB, AWS, GCP_TERMS, OPENAI_GZIP, OPENAI_IDENTITY):
        text = archive.normalize_text(
            archive.extract_text(archive.decode_checked(fixture(name)).data))
        assert archive.normalize_text(SPECS[name][2]) in text, name


def test_gate_spec_rejects_specs_that_cannot_discriminate():
    assert is_refusal(GateSpec("terms of service", ("account",), "governing law").validate())
    one_section = GateSpec("terms of service", ("account",), "governing law").validate()
    assert one_section.reason == "gate-spec-sections", one_section
    assert is_refusal(GateSpec("", ("a bc", "d ef"), "zzz").validate())
    assert is_refusal(GateSpec("anchor", ("a bc", "d ef"), "").validate())
    assert is_refusal(GateSpec("anchor", ("aa", "d ef"), "zzz").validate())
    assert is_refusal(GateSpec("anchor", ("a bc", "a bc"), "zzz").validate())
    assert is_refusal(GateSpec("anchor", tuple("s%02d" % i for i in range(13)), "z").validate())
    assert GateSpec("anchor", ("a bc", "d ef"), "zzz").validate() is None


def test_gate_a_stays_disabled_and_the_oversize_capture_is_why():
    """The surviving measured reason to keep the length gate off by default.

    PRD section 2 recorded cloud.google.com/terms/deprecation at 2,738 extracted characters and
    then at 35,689 with no policy change, a 13x inflation from single-page-app chrome. The larger
    figure is MEASURED here: the oversize capture extracts to exactly 35,689 characters.

    The companion claim, that gate A "passed 4 of 4 bad snapshots", is withdrawn along with the
    bad snapshots. This one survives because it is a property of one page measured twice.
    """
    text = archive.extract_text(archive.decode_checked(fixture(OVERSIZE)).data)
    assert len(text) == SPA_INFLATED_CHARS == 35689
    assert round(SPA_INFLATED_CHARS / float(SPA_FAITHFUL_CHARS)) == 13

    assert archive.GATE_A_ENABLED_DEFAULT is False
    assert archive.GATE_A_RATIO == 0.60

    # MINE: a change-point pool for a page that has been rebuilt, so recent captures are inflated
    # and the median moves with them. The faithful capture then falls under the floor.
    pool = [SPA_INFLATED_CHARS, SPA_INFLATED_CHARS, SPA_FAITHFUL_CHARS]
    median = sorted(pool)[len(pool) // 2]
    assert median == SPA_INFLATED_CHARS
    assert SPA_FAITHFUL_CHARS < archive.GATE_A_RATIO * median

    # Gate A on the real GitHub capture: with a median dragged up by inflated neighbours, the
    # length floor rejects a document that passes all three structural gates.
    github_text = archive.extract_text(archive.decode_checked(fixture(GITHUB)).data)
    on = spec_for(GITHUB, enable_gate_a=True)
    result = archive.qualify(github_text, on, median_text_len=len(github_text) * 3)
    assert result.gate_a is False
    assert result.gate_b and result.gate_c and result.gate_d
    assert result.qualified is False, "gate A alone sank a fully faithful capture"

    off = spec_for(GITHUB)
    result = archive.qualify(github_text, off, median_text_len=len(github_text) * 3)
    assert result.gate_a is None and result.qualified is True


def test_gate_a_enabled_without_a_median_is_expected():
    refusal = archive.qualify("some text", spec_for(GCP_TERMS, enable_gate_a=True))
    assert is_refusal(refusal) and refusal.tag == EXPECTED
    assert refusal.reason == "gate-a-no-median"


def test_a_gate_rejection_is_a_skip_not_a_loss():
    """A snapshot that fails the gate is skipped, never counted as a loss of the commitment.

    Structurally, not by convention. `admit_snapshot` returns a normal `Admission` with
    `qualified` False, and nothing in this module ever returns "the commitment was lost".
    """
    raw = fixture(CHROME_ONLY)
    result = archive.admit_snapshot(raw, archive.cdx_digest(raw), spec_for(CHROME_ONLY))
    assert not is_refusal(result), result
    assert result.qualified is False
    assert "gates" in result.steps
    assert result.decoded_sha256 == archive.sha256_hex(result.decoded.data)


# ---------------------------------------------------------------------------
# 3. Magic-byte decode, and the branch that is deliberately absent
# ---------------------------------------------------------------------------

def test_decode_has_exactly_two_branches_plus_identity():
    document = archive.decode_checked(fixture(OPENAI_IDENTITY)).data

    raw = _gzip(document)
    out, kind = archive.decode_payload(raw)
    assert kind == "gzip" and out == document and archive.magic_hex(raw) == "1f8b"

    raw = zlib.compress(document, 9)
    assert raw[0] == 0x78
    out, kind = archive.decode_payload(raw)
    assert kind == "zlib" and out == document

    out, kind = archive.decode_payload(document)
    assert kind == "identity" and out == document


def test_there_is_no_raw_deflate_branch():
    """The branch is absent on purpose. Do not add one.

    A genuine raw deflate stream now falls to identity. That is the accepted cost, and it is safe
    in the direction that matters: the gates see binary noise and REJECT the snapshot, and a
    rejection is a skip, never a loss. The alternative failure mode is a probe that succeeds on
    bytes that were never deflate and returns plausible garbage, which every validator computes
    identically and agrees on unanimously.
    """
    assert not hasattr(archive, "_raw_deflate"), "the raw-deflate probe came back"
    source = io.open(os.path.join(HERE, "archive.py"), encoding="utf-8").read()
    tree = ast.parse(source)
    # No negative wbits anywhere in the module: -zlib.MAX_WBITS is the only thing needed to
    # reintroduce the branch, so its absence is the guard.
    for node in ast.walk(tree):
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            operand = node.operand
            if isinstance(operand, ast.Attribute) and operand.attr == "MAX_WBITS":
                raise AssertionError("archive.py contains -zlib.MAX_WBITS")

    document = archive.decode_checked(fixture(OPENAI_IDENTITY)).data
    obj = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    bare = obj.compress(document) + obj.flush()
    assert bare[:1] != b"\x1f" and bare[0] != 0x78, "test input must look like neither wrapper"

    out, kind = archive.decode_payload(bare)
    assert kind == "identity", kind
    assert out == bare, "the compressed bytes are returned untouched"

    # And the consequence is a rejection, not a wrong verdict.
    result = archive.admit_snapshot(bare, archive.cdx_digest(bare), spec_for(OPENAI_IDENTITY))
    assert not is_refusal(result), result
    assert result.encoding == "identity"
    assert result.qualified is False, "undecodable-by-policy means skipped, never counted"


def _naive_deflate_shape(raw):
    """The probe archive.py deliberately does not contain, so its failure can be measured."""
    obj = zlib.decompressobj(-zlib.MAX_WBITS)
    try:
        out = obj.decompress(raw) + obj.flush()
    except zlib.error:
        return None
    return len(out), obj.eof, len(obj.unused_data)


def test_naive_raw_deflate_probe_succeeds_on_bytes_that_were_never_deflate():
    """MEASURED. Two shapes on which the naive probe RETURNS rather than raising.

    A wrong decode that raises costs an hour. A wrong decode that returns is unrecoverable.
    """
    json_like = b"{\n" + b"x" * (DEFLATE_FP_JSON_LEN - 2)
    shape = _naive_deflate_shape(json_like)
    assert shape is not None, "expected the naive probe to succeed, which is the bug"
    assert shape == (DEFLATE_FP_JSON_OUT, DEFLATE_FP_JSON_EOF, DEFLATE_FP_JSON_UNUSED), shape

    empty = _naive_deflate_shape(b"[]")
    assert empty is not None, "expected the naive probe to succeed, which is the bug"
    assert empty == (1, False, 0), empty

    # No single structural guard catches both: eof True/False, unused_data huge/empty.
    assert shape[1] is True and empty[1] is False
    assert shape[2] > 0 and empty[2] == 0

    # This module has no such branch, so both come back byte-intact as identity.
    for raw in (json_like, b"[]", b"[]\n"):
        out, kind = archive.decode_payload(raw)
        assert kind == "identity", (raw[:4], kind)
        assert out == raw and len(out) == len(raw)
        checked = archive.decode_checked(raw)
        assert isinstance(checked, Decoded) and checked.encoding == "identity"
        assert checked.data == raw


def test_gzip_isize_trailer_must_never_gate_a_decision():
    """A bug this suite caught in archive.py, pinned so it cannot come back.

    ISIZE is the last four bytes of the gzip MEMBER. `zlib.decompress` ignores anything after a
    complete member, so a payload with trailing bytes decodes perfectly while `raw[-4:]` reads
    junk. An earlier draft used ISIZE as an early `decoded-cap` rejection and therefore refused
    the intact 372,058 byte GitHub capture because three junk bytes made the trailer read 1.5 GB.

    A false rejection here is a bond that can never be settled, on evidence that was intact.
    """
    member = fixture(GITHUB)
    assert archive.gzip_declared_size(member) == 372058

    for junk in (b"XYZ", b"\x00", b"\n", b"\xff\xff\xff\xff"):
        polluted = member + junk
        assert archive.gzip_declared_size(polluted) != 372058, junk
        decoded = archive.decode_checked(polluted)
        assert isinstance(decoded, Decoded), (junk, decoded)
        assert decoded.encoding == "gzip" and len(decoded) == 372058, junk
    assert archive.gzip_declared_size(member + b"\xff\xff\xff\xff") == 4294967295

    truncated = archive.decode_checked(member[:-6])
    assert is_refusal(truncated), truncated
    assert truncated.tag == TRANSIENT and truncated.reason == "undecodable", truncated


def test_decode_checked_rejects_corrupt_wrappers_as_transient():
    corrupt = archive.decode_checked(b"\x1f\x8b" + b"\x00" * 200)
    assert is_refusal(corrupt) and corrupt.tag == TRANSIENT
    assert corrupt.reason == "undecodable", corrupt
    zlib_corrupt = archive.decode_checked(b"\x78\x9c" + b"\x00" * 50)
    assert is_refusal(zlib_corrupt) and zlib_corrupt.tag == TRANSIENT


def test_decode_checked_agrees_with_decode_payload_on_every_fixture():
    for name in sorted(MEASURED):
        raw = fixture(name)
        want, want_kind = archive.decode_payload(raw)
        got = archive.decode_checked(raw)
        assert isinstance(got, Decoded), (name, got)
        assert got.encoding == want_kind, (name, got.encoding, want_kind)
        assert got.data == want, name


def test_cap_three_is_enforced_during_inflation_not_after():
    """A compression bomb must be refused without being materialised.

    MEASURED: 5,000,000 zero bytes gzip to 4,892 bytes and declare ISIZE 5000000, and the bounded
    loop stops at 4,194,304 bytes after 16 rounds.
    """
    bomb = _gzip(b"\x00" * 5_000_000)
    assert len(bomb) < 10_000, len(bomb)
    assert archive.gzip_declared_size(bomb) == 5_000_000
    refusal = archive.decode_checked(bomb)
    assert is_refusal(refusal) and refusal.tag == EXTERNAL
    assert refusal.reason == "decoded-cap", refusal
    # With the trailer lying about the size, the bounded inflate still fires the cap.
    lying = bomb[:-4] + (1234).to_bytes(4, "little")
    refusal = archive.decode_checked(lying)
    assert is_refusal(refusal) and refusal.reason == "decoded-cap", refusal


def test_reference_parity_and_the_one_deliberate_divergence():
    """Cross-check against a cross-project harness this repo does not commit.

    They agree on every captured payload, because all eight are gzip or identity. They diverge on
    exactly one input class: the harness still carries a guarded raw-deflate branch and this
    module does not. Pinning the divergence is the point, so it stays a decision rather than
    becoming an accident.

    SKIPS rather than fails when the harness is not present. It lives in a workspace this repo
    does not own, so a fresh clone or a CI runner will never have it; that is a fact about the
    harness's location, not a fact this repo's own suite can prove or disprove.
    """
    if not os.path.exists(REFERENCE):
        print("    skip test_reference_parity_and_the_one_deliberate_divergence: "
              "reference harness not present at %s (outside this repo)" % REFERENCE)
        return
    import importlib.util
    spec = importlib.util.spec_from_file_location("_holdfast_reference", REFERENCE)
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)

    for name in sorted(MEASURED):
        raw = fixture(name)
        mine, my_kind = archive.decode_payload(raw)
        theirs, their_kind = reference.decode_payload(raw)
        assert my_kind == their_kind, (name, my_kind, their_kind)
        assert mine == theirs, name

    # They also agree on the two false-positive shapes, because the harness's three guards refuse
    # them and fall through to identity, which is where this module starts.
    for raw in (b"[]", b"[]\n", b"{\n" + b"x" * (DEFLATE_FP_JSON_LEN - 2)):
        assert archive.decode_payload(raw)[1] == reference.decode_payload(raw)[1] == "identity"

    # The divergence: a genuine raw deflate stream.
    document = archive.decode_checked(fixture(OPENAI_IDENTITY)).data
    obj = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    bare = obj.compress(document) + obj.flush()
    assert reference.decode_payload(bare)[1] == "deflate", "harness still has the branch"
    assert archive.decode_payload(bare)[1] == "identity", "this module deliberately does not"


# ---------------------------------------------------------------------------
# 2. Digest classification
# ---------------------------------------------------------------------------

def test_digest_is_base32_sha1_of_the_raw_payload():
    import base64 as _b64
    import hashlib as _h
    for name in sorted(MEASURED):
        raw = fixture(name)
        expected = MEASURED[name][4]
        assert archive.cdx_digest(raw) == expected, name
        assert _b64.b32encode(_h.sha1(raw).digest()).decode("ascii") == expected, name
        assert len(expected) == 32 and "=" not in expected
        assert archive.classify_digest(raw, expected) == archive.DIGEST_AS_ARCHIVED, name
        assert archive.classify_digest(raw, expected.lower()) == archive.DIGEST_AS_ARCHIVED, name


def test_digest_is_of_the_stored_bytes_not_the_decoded_ones():
    """The arithmetic behind the on-chain failure, reproduced offline over 6 captures.

    A digest computed after decoding cannot match the column on a compressed capture. That is not
    a hypothetical: it is what the live contract did, because its transport decoded the body before
    Python saw it. Asserting the inequality here is what makes the live refusal a predictable
    consequence of the fixtures rather than a surprise.
    """
    checked = 0
    for name in (GITHUB, AWS, GCP_TERMS, OPENAI_GZIP, GCP_DEPRECATION, CHROME_ONLY):
        raw = fixture(name)
        decoded = archive.decode_checked(raw).data
        assert archive.magic_hex(raw) == "1f8b", name
        assert archive.cdx_digest(raw) == MEASURED[name][4], name
        assert archive.cdx_digest(decoded) != MEASURED[name][4], name
        checked += 1
    assert checked == 6, checked
    # And on an identity payload raw is decoded, so the ordering is invisible there. That is
    # exactly why the ordering must be enforced structurally and not spot-checked.
    for name in (OPENAI_IDENTITY, OVERSIZE):
        raw = fixture(name)
        assert archive.decode_checked(raw).data == raw
        assert archive.cdx_digest(raw) == MEASURED[name][4]


def test_a_decoded_body_is_transport_decoded_not_a_mismatch():
    """THE REGRESSION TEST FOR THE BUG THAT COST 0.25 GEN, replayed byte for byte.

    Live transaction 0xc3a12dd2 refused with

        Refusal([TRANSIENT] digest-mismatch: want ORCARP7HGOXUBBYK4LXACZM7GU5ZBMMY
                got RH5GAEIT25NBEQBWYIY7FK4KM7ZRDRNR over 819751 raw bytes)

    and the two numbers in it are reproduced below from the fixture, which is why this test can
    stand in for a transaction. Handing `classify_digest` what GenVM hands the contract must not
    produce a refusal, because there is nothing wrong with the capture and no retry can help.
    """
    stored = fixture(GCP_TERMS)
    received = archive.decode_checked(stored).data      # what the transport actually delivers
    published = MEASURED[GCP_TERMS][4]

    assert published == "ORCARP7HGOXUBBYK4LXACZM7GU5ZBMMY"
    assert len(received) == 819751, len(received)
    assert archive.cdx_digest(received) == "RH5GAEIT25NBEQBWYIY7FK4KM7ZRDRNR"

    state = archive.classify_digest(received, published)
    assert not is_refusal(state), state
    assert state == archive.DIGEST_TRANSPORT_DECODED

    # The stored form still classifies as confirmed, so the check did not simply get deleted.
    assert archive.classify_digest(stored, published) == archive.DIGEST_AS_ARCHIVED


def test_digest_mismatch_is_transient_only_where_it_is_checkable():
    """A mismatch refuses when the bytes in hand are the stored ones, and only then.

    The discriminator is the gzip magic, because it answers the one question that matters: did the
    transport already consume the encoding? If it did not, the column hashes precisely these bytes
    and a disagreement is real. If it did, "inflated by the transport" and "a different payload
    than the index listed" are the same observation and no measurement separates them.
    """
    gzipped = fixture(GITHUB)
    assert archive.magic_hex(gzipped) == "1f8b"
    refusal = archive.classify_digest(gzipped, "A" * 32)
    assert is_refusal(refusal)
    assert refusal.tag == TRANSIENT and refusal.reason == "digest-mismatch"
    assert "stored bytes" in refusal.detail

    # An identity capture is stored uncompressed, so it too arrives as stored and stays checkable.
    identity = fixture(OPENAI_IDENTITY)
    assert archive.magic_hex(identity) != "1f8b"
    assert archive.classify_digest(identity, MEASURED[OPENAI_IDENTITY][4]) == \
        archive.DIGEST_AS_ARCHIVED
    # ...but a wrong digest over it cannot be told apart from a decoded body, so it is recorded.
    assert archive.classify_digest(identity, "A" * 32) == archive.DIGEST_TRANSPORT_DECODED

    missing = archive.classify_digest(gzipped, "")
    assert is_refusal(missing) and missing.tag == EXPECTED


def test_admission_records_which_digest_state_it_reached():
    """`digest_state` rides in the equivalence tuple, so it must be set from the bytes every time."""
    stored = fixture(GCP_TERMS)
    spec = spec_for(GCP_TERMS)
    published = MEASURED[GCP_TERMS][4]

    confirmed = archive.admit_snapshot(stored, published, spec, timestamp=TS_GCP_TERMS)
    assert not is_refusal(confirmed), confirmed
    assert confirmed.digest_state == archive.DIGEST_AS_ARCHIVED
    assert confirmed.digest_confirmed is True
    assert confirmed.expected_digest == published
    assert "digest-as-archived" in confirmed.steps

    # The same capture as the transport delivers it: admitted, gated, and honest about the digest.
    received = archive.decode_checked(stored).data
    delivered = archive.admit_snapshot(received, published, spec, timestamp=TS_GCP_TERMS)
    assert not is_refusal(delivered), delivered
    assert delivered.digest_state == archive.DIGEST_TRANSPORT_DECODED
    assert delivered.digest_confirmed is False
    assert delivered.expected_digest == published
    assert "digest-transport-decoded" in delivered.steps

    # Same page, same gates, same pinned content hash. Only the digest story differs, which is the
    # whole point: the decode is idempotent, so what the contract judges is identical either way.
    assert delivered.qualified is confirmed.qualified is True
    assert delivered.decoded_sha256 == confirmed.decoded_sha256
    assert delivered.text == confirmed.text
    assert delivered.digest != confirmed.digest

    # And the two disagree in the tuple that crosses strict_eq, which is what makes a split set of
    # validators revert instead of resolving a payout out of two different bodies.
    assert archive.admissibility_tuple(delivered) != archive.admissibility_tuple(confirmed)


def test_digest_is_verified_before_the_payload_is_decoded():
    """Two proofs, because ordering cannot be checked from a return value.

    One: the recorded step order puts `digest` before `decode`.
    Two: with a wrong digest, a decode callable that raises on any call is never reached.
    """
    raw = fixture(GITHUB)
    spec = spec_for(GITHUB)

    good = archive.admit_snapshot(raw, MEASURED[GITHUB][4], spec, timestamp=TS_GITHUB)
    assert not is_refusal(good), good
    steps = list(good.steps)
    assert steps == ["timestamp", "cap-raw", "digest", "digest-as-archived", "decode",
                     "cap-decoded", "extract", "gates"], steps
    assert steps.index("digest") < steps.index("decode")
    assert steps.index("cap-raw") < steps.index("digest")
    assert steps.index("cap-decoded") > steps.index("decode")

    calls = []

    def exploding_decode(payload, cap=archive.DECODED_MAX_BYTES):
        calls.append(len(payload))
        raise AssertionError("decode ran before the digest was verified")

    refusal = archive.admit_snapshot(raw, "A" * 32, spec, timestamp=TS_GITHUB,
                                     decode=exploding_decode)
    assert is_refusal(refusal), refusal
    assert refusal.tag == TRANSIENT and refusal.reason == "digest-mismatch"
    assert calls == [], "decode must not be reached when the digest fails"


# ---------------------------------------------------------------------------
# 6. Three size caps
# ---------------------------------------------------------------------------

def test_three_size_caps_each_reject_at_their_own_stage():
    assert archive.CDX_WARC_LENGTH_MAX == 250_000
    assert archive.RAW_MAX_BYTES == 2_500_000
    assert archive.DECODED_MAX_BYTES == 4_000_000

    assert archive.check_warc_length(250_000) is None
    cap1 = archive.check_warc_length(250_001)
    assert is_refusal(cap1) and cap1.tag == EXTERNAL and cap1.reason == "cdx-length-cap"

    assert archive.check_raw_len(2_500_000) is None
    cap2 = archive.check_raw_len(2_500_001)
    assert is_refusal(cap2) and cap2.tag == EXTERNAL and cap2.reason == "raw-cap"

    assert archive.check_decoded_len(4_000_000) is None
    cap3 = archive.check_decoded_len(4_000_001)
    assert is_refusal(cap3) and cap3.tag == EXTERNAL and cap3.reason == "decoded-cap"


def test_oversize_capture_exercises_all_three_caps():
    """MANIFEST says `accepted: true` with `cdx_length` 260,662. PRD section 2 caps length at
    250,000. Both hold, and the reconciliation is WHICH caller supplies the length.

    Cap 1 is a pre-filter for scanning an index of candidate change points: skip the ones whose
    compressed WARC record is already large. A bond's pinned baseline is fetched because the bond
    names it, not because it was picked out of a list, so no length pre-filter applies. In this
    module that is not a special case, it is the signature: `warc_length` defaults to None and
    cap 1 only runs when a caller passes one.

    So the oversize capture is accepted when fetched as a pinned baseline, and refused when
    offered as a change point. Both are asserted below.
    """
    raw = fixture(OVERSIZE)
    assert len(raw) == 2044592
    assert archive.magic_hex(raw) == "3c21", "identity, not gzip"
    decoded = archive.decode_checked(raw)
    assert isinstance(decoded, Decoded) and decoded.encoding == "identity"
    assert len(decoded) == 2044592, "raw equals decoded, so it never enters the decode branch"

    spec = spec_for(GCP_TERMS)
    digest = archive.cdx_digest(raw)

    # As a pinned baseline: accepted, and caps 2 and 3 both pass on the real sizes.
    admitted = archive.admit_snapshot(raw, digest, spec)
    assert not is_refusal(admitted), admitted
    assert len(admitted.decoded) == 2044592
    assert archive.check_raw_len(2044592) is None
    assert archive.check_decoded_len(2044592) is None

    # As a change point carrying its CDX length: refused at cap 1, before the digest or decode.
    refused = archive.admit_snapshot(raw, digest, spec, warc_length=OVERSIZE_CDX_LENGTH)
    assert is_refusal(refused) and refused.reason == "cdx-length-cap", refused
    assert OVERSIZE_CDX_LENGTH > archive.CDX_WARC_LENGTH_MAX


def test_cdx_length_is_a_prefilter_never_a_payload_size():
    """MANIFEST: 260,662 declared against a 2,044,592 byte payload is 7.84x.

    A build that reads `length` as the payload size is wrong by nearly a factor of eight on a real
    page. The measured relationships for each storage mode are asserted separately in
    test_cdx_length_relationship_measured_from_real_pairings against the live index rows.
    """
    assert round(2044592 / float(OVERSIZE_CDX_LENGTH), 2) == 7.84
    # A row whose length the index reported as "-" survives parsing and cannot pass cap 1.
    index = archive.parse_cdx(_cdx_body([(TS_GCP_DEPRECATION, "AAAA", "-")]))
    assert not is_refusal(index), index
    assert index.rows[0].warc_length is None
    refusal = archive.check_warc_length(index.rows[0].warc_length)
    assert is_refusal(refusal) and refusal.reason == "cdx-length-unknown"
    # And the pre-filter is the only thing `length` may be used for: it never reaches a verdict.
    raw = fixture(OVERSIZE)
    admitted = archive.admit_snapshot(raw, archive.cdx_digest(raw), spec_for(GCP_TERMS))
    assert not is_refusal(admitted)
    assert len(admitted.decoded) == 2044592, "the real size comes from the bytes, not the index"


def test_cap_two_fires_before_the_digest():
    big = b"<!doctype html>" + b"a" * (archive.RAW_MAX_BYTES + 1 - 15)
    assert len(big) == archive.RAW_MAX_BYTES + 1
    refusal = archive.admit_snapshot(big, "A" * 32, spec_for(GITHUB))
    assert is_refusal(refusal) and refusal.reason == "raw-cap", refusal


# ---------------------------------------------------------------------------
# 1. CDX row parsing
# ---------------------------------------------------------------------------

def _cdx_body(rows, header=("timestamp", "digest", "length")):
    import json as _json
    return _json.dumps([list(header)] + [list(r) for r in rows]).encode("utf-8")


def _cdx_index_files():
    return sorted(f for f in os.listdir(FIXTURES)
                  if f.startswith("cdx-") and f.endswith(".json"))


def test_real_cdx_indexes_parse():
    """The captured CDX responses, parsed, with the invariants that must hold for every row.

    Deliberately no assertion on how many rows a given index has. The index fixtures were being
    regenerated while this suite was written: cdx-github-tos.json went from 40 rows to 1 and
    cdx-gcp-deprecation.json from 5 to 17 inside a two minute window. Row counts are the fixture
    author's business. What this module must get right on any of those snapshots is the per-row
    contract, so that is what is asserted.
    """
    print("")
    seen = 0
    for fname in _cdx_index_files():
        body = io.open(os.path.join(FIXTURES, fname), "rb").read()
        index = archive.parse_cdx(body)
        assert not is_refusal(index), (fname, index)
        assert index.change_points == len(index.rows) >= 1, fname
        for row in index.rows:
            assert archive.is_exact_timestamp(row.timestamp), (fname, row.timestamp)
            assert len(row.digest) == 32 and "=" not in row.digest, (fname, row.digest)
            assert row.digest == row.digest.upper(), (fname, row.digest)
            assert row.warc_length is None or row.warc_length > 0, (fname, row.warc_length)
            assert row.exact, (fname, row.timestamp)
            if row.status is not None:
                assert row.status == "200", (fname, row.status)
        timestamps = [r.timestamp for r in index.rows]
        assert timestamps == sorted(timestamps), "%s is not in timestamp order" % fname
        lengths = [r.warc_length for r in index.rows if r.warc_length is not None]
        print("    %-28s %4d change points, %5d B body, %2d unique digests, median length %s"
              % (fname, index.change_points, len(body),
                 len({r.digest for r in index.rows}),
                 index.median_warc_length() if lengths else "n/a"))
        seen += 1
    assert seen >= 5, "expected at least the five captured indexes, saw %d" % seen


def test_cdx_digest_in_the_index_matches_the_captured_payload():
    """The strongest single check in the suite: index and payload were captured independently.

    base32(sha1(raw)) computed here from the .bin must equal the digest the Wayback CDX API
    published for that timestamp. Nothing in this repo derives one from the other, so a match is
    real evidence that the digest is computed over the RAW payload before any decoding.

    Every pairing that exists on disk is checked and every one must match. The floor is a floor
    because the index fixtures are still being filled in: at the time of writing four of the eight
    payloads had a corresponding index row and the other four had none.
    """
    by_timestamp = {}
    for fname in _cdx_index_files():
        index = archive.parse_cdx(io.open(os.path.join(FIXTURES, fname), "rb").read())
        if is_refusal(index):
            continue
        for row in index.rows:
            by_timestamp.setdefault(row.timestamp, (fname, row))

    candidates = [(GITHUB, TS_GITHUB), (AWS, TS_AWS), (GCP_TERMS, TS_GCP_TERMS),
                  (OPENAI_GZIP, TS_OPENAI_GZIP), (OPENAI_IDENTITY, TS_OPENAI_IDENTITY),
                  (GCP_DEPRECATION, TS_GCP_DEPRECATION), (OVERSIZE, TS_OVERSIZE)]
    matched, absent = [], []
    print("")
    print("    %-38s %-15s %9s %9s %8s %s"
          % ("payload", "timestamp", "cdx len", "raw", "dec/len", "digest"))
    for payload, timestamp in candidates:
        if timestamp not in by_timestamp:
            absent.append(payload)
            print("    %-38s %-15s %9s %9d %8s not in any index"
                  % (payload, timestamp, "-", len(fixture(payload)), "-"))
            continue
        fname, row = by_timestamp[timestamp]
        raw = fixture(payload)
        computed = archive.cdx_digest(raw)
        assert row.digest == computed, \
            "%s at %s: index published %s, payload hashes to %s" % (
                payload, timestamp, row.digest, computed)
        assert archive.classify_digest(raw, row.digest) == archive.DIGEST_AS_ARCHIVED, payload
        decoded = archive.decode_checked(raw)
        ratio = len(decoded) / float(row.warc_length)
        print("    %-38s %-15s %9d %9d %8.2f match"
              % (payload, timestamp, row.warc_length, len(raw), ratio))
        # The digest is over the raw bytes. On a gzip capture it cannot also match the decoded
        # bytes, which is the ordering proof restated against an independently published digest.
        if decoded.encoding != "identity":
            assert archive.cdx_digest(decoded.data) != row.digest, payload
        matched.append(payload)
    assert len(matched) >= 4, "only %d pairings matched: %s (absent: %s)" % (
        len(matched), matched, absent)


def test_cdx_length_relationship_measured_from_real_pairings():
    """MEASURED. What `length` is, and why it cannot stand in for a payload size in either
    direction.

    It is the compressed WARC record length. WARC records are gzip compressed on disk, so:

        identity capture   record is much SMALLER than the payload, because the HTML compresses
                           2,044,592 payload against 260,662 record, 7.84x too small
        gzip capture       record is marginally LARGER than the payload, because the payload is
                           already compressed and only the WARC framing is added
                           61,023 payload against 65,297 record, 4,274 bytes of framing

    Against the DECODED size, which is what a gate actually reads, the understatement measured
    here reaches 10.67x. PRD section 5 says "understating payload by up to 7.84x". That is the
    identity case, and it is not the ceiling in the PRD's own fixture set.
    """
    by_timestamp = {}
    for fname in _cdx_index_files():
        index = archive.parse_cdx(io.open(os.path.join(FIXTURES, fname), "rb").read())
        if is_refusal(index):
            continue
        for row in index.rows:
            by_timestamp.setdefault(row.timestamp, (fname, row))

    worst = 0.0
    checked = 0
    for payload, timestamp in ((GITHUB, TS_GITHUB), (AWS, TS_AWS),
                               (GCP_DEPRECATION, TS_GCP_DEPRECATION), (OVERSIZE, TS_OVERSIZE)):
        if timestamp not in by_timestamp:
            continue
        row = by_timestamp[timestamp][1]
        raw = fixture(payload)
        decoded = archive.decode_checked(raw)
        assert row.warc_length != len(raw), \
            "%s: length happened to equal the raw size, so the test proves nothing" % payload
        assert row.warc_length != len(decoded), payload
        if decoded.encoding == "gzip":
            framing = row.warc_length - len(raw)
            assert 0 < framing < 10_000, (payload, framing)
        else:
            assert row.warc_length < len(raw), (payload, row.warc_length, len(raw))
        worst = max(worst, len(decoded) / float(row.warc_length))
        checked += 1
    assert checked >= 2, "need at least two real pairings, had %d" % checked
    assert worst > 7.84, \
        "measured worst understatement %.2fx did not exceed the PRD's stated 7.84x" % worst

    if TS_GCP_DEPRECATION in by_timestamp:
        row = by_timestamp[TS_GCP_DEPRECATION][1]
        assert row.warc_length == 65297, row.warc_length
        assert row.warc_length - 61023 == 4274
        assert round(696794 / float(row.warc_length), 2) == 10.67
        # And cap 1 passes it, at 65,297 against a 250,000 ceiling, while the decoded 696,794
        # bytes are nearly three times the ceiling. A build that pre-flights the size cap on
        # `length` admits a payload almost 3x over its own limit.
        assert archive.check_warc_length(row.warc_length) is None
        assert 696794 > 2 * archive.CDX_WARC_LENGTH_MAX


def test_manifest_and_payloads_agree():
    """Cross-check every number against the fixture author's manifest, not just my own table.

    If a payload is regenerated, this says the manifest and the bytes disagree instead of blaming
    the constants at the top of this file.
    """
    import json as _json
    manifest = _json.load(io.open(os.path.join(FIXTURES, "manifest.json"), encoding="utf-8"))
    routes = manifest["routes"] if isinstance(manifest, dict) else manifest

    print("")
    checked = 0
    for entry in routes:
        body = entry.get("body") or ""
        if not body.endswith(".bin"):
            continue
        expect = entry.get("expect") or {}
        raw = fixture(body)
        decoded = archive.decode_checked(raw)
        assert isinstance(decoded, Decoded), (body, decoded)

        declared_raw = expect.get("raw_bytes", entry.get("captured_raw_bytes"))
        if declared_raw is not None:
            assert len(raw) == declared_raw, (body, len(raw), declared_raw)
        if "magic" in expect:
            assert archive.magic_hex(raw) == expect["magic"], (body, archive.magic_hex(raw))
        if "decoded_bytes" in expect:
            assert len(decoded) == expect["decoded_bytes"], (body, len(decoded))
        if "cdx_digest" in expect:
            assert archive.cdx_digest(raw) == expect["cdx_digest"], body
        if "sha256_raw" in expect:
            assert archive.sha256_hex(raw) == expect["sha256_raw"], body
        if "visible_text_chars" in expect:
            got = len(archive.extract_text(decoded.data))
            assert got == expect["visible_text_chars"], (body, got)
        if "cdx_length" in expect:
            assert expect["cdx_length"] > archive.CDX_WARC_LENGTH_MAX, body
            assert expect.get("accepted") is True, body

        # The gate verdict, where the manifest declares the inputs to evaluate one.
        if expect.get("anchor") and expect.get("sections") and body in SPECS:
            spec = spec_for(body)
            assert spec.anchor == expect["anchor"], body
            assert list(spec.sections) == list(expect["sections"]), body
            result = archive.admit_snapshot(raw, archive.cdx_digest(raw), spec)
            assert not is_refusal(result), (body, result)
            want = expect.get("gate")
            if want == "QUALIFIED":
                assert result.qualified is True, (body, result.qualification.failed_gates)
            elif want == "REJECTED":
                assert result.qualified is False, body
                # And WHICH gate, when the manifest says which.
                pairs = (("gate_b", result.qualification.gate_b),
                         ("gate_c", result.qualification.gate_c),
                         ("gate_d", result.qualification.gate_d))
                for key, got in pairs:
                    if key in expect:
                        assert got is (expect[key] == "PASS"), (body, key, got, expect[key])
        elif expect.get("anchor") is None:
            # Explicitly nothing to gate. The manifest says so and this suite claims no verdict.
            assert expect.get("sections") is None and expect.get("terminal") is None, body
            assert expect.get("decoded_bytes") == len(decoded), body

        print("    %-38s manifest agrees (%s, %d -> %d B)"
              % (body, expect.get("magic", "?"), len(raw), len(decoded)))
        checked += 1
    assert checked == 8, "expected 8 payload routes, checked %d" % checked


def test_cdx_parses_all_five_columns_by_name():
    body = _cdx_body(
        [(TS_EXACT_NEIGHBOUR, "AAAA", "349", "200", "text/html"),
         (TS_GCP_DEPRECATION, "BBBB", "7278", "200", "text/html")],
        header=("timestamp", "digest", "length", "statuscode", "mimetype"))
    index = archive.parse_cdx(body)
    assert not is_refusal(index), index
    assert index.change_points == 2
    row = index.rows[0]
    assert (row.timestamp, row.digest, row.warc_length) == (TS_EXACT_NEIGHBOUR, "AAAA", 349)
    assert row.status == "200" and row.mimetype == "text/html" and row.exact
    # Columns resolve by name, so a reordered fl= list cannot read the digest out of length.
    shuffled = archive.parse_cdx(_cdx_body([("349", TS_EXACT_NEIGHBOUR, "AAAA")],
                                           header=("length", "timestamp", "digest")))
    assert shuffled.rows[0].timestamp == TS_EXACT_NEIGHBOUR
    assert shuffled.rows[0].warc_length == 349 and shuffled.rows[0].digest == "AAAA"


def test_never_archived_url_is_external_never_unchanged():
    """The most dangerous response in the data path: HTTP 200 carrying `[]`.

    A naive read sees a success status and zero change points and concludes "nothing changed",
    which is exactly backwards. It is a successful call carrying no data.

    The PRD calls the body 3 bytes and the manifest inlines the 2-byte string "[]". Both are
    asserted so the discrepancy cannot become a gap.
    """
    for body in (b"[]", b"[]\n", "[]", b"  []  "):
        refusal = archive.parse_cdx(body)
        assert is_refusal(refusal), body
        assert refusal.tag == EXTERNAL and refusal.reason == "cdx-empty", (body, refusal)
    header_only = archive.parse_cdx(b'[["timestamp","digest","length"]]')
    assert is_refusal(header_only) and header_only.tag == EXTERNAL
    assert header_only.reason == "cdx-no-rows"
    # And the full path through the injected transport still ends [EXTERNAL], so a 200 cannot
    # launder itself into a verdict.
    result = archive.load_change_points(_fetch_returning(200, b"[]"),
                                        "https://example.test/never-archived",
                                        "20260101", "20260901", 40)
    assert is_refusal(result) and result.tag == EXTERNAL and result.reason == "cdx-empty"


def test_cdx_garbage_and_wrong_shapes_refuse():
    for body, reason in ((b"not json", "cdx-not-json"),
                         (b'{"rows": []}', "cdx-not-array"),
                         (b'[42]', "cdx-row-not-array")):
        refusal = archive.parse_cdx(body)
        assert is_refusal(refusal) and refusal.reason == reason, (body, refusal)


def test_collapse_digest_does_not_guarantee_globally_unique_digests():
    """MEASURED on the live index fixtures, and a trap for anything that counts change points.

    `collapse=digest` collapses only ADJACENT runs of the same digest. A non-adjacent repeat
    survives, so an oscillating page produces one row per flip. Measured in
    cdx-openai-tou-2024.json: 200 rows carrying 173 distinct digests, with one digest appearing
    three times at row positions 6, 8 and 12.

    Two consequences. A row count is a count of transitions, not of distinct document states, so
    it overstates how much a page really changed. And a digest is not a unique key into the index,
    so anything keyed by digest must expect several timestamps per digest.

    This module reports `change_points` as the row count, which is the honest reading of what the
    API returned, and never claims the rows are distinct states.
    """
    total_rows = 0
    repeats_found = 0
    for fname in _cdx_index_files():
        index = archive.parse_cdx(io.open(os.path.join(FIXTURES, fname), "rb").read())
        if is_refusal(index):
            continue
        digests = [r.digest for r in index.rows]
        total_rows += len(digests)
        # Adjacent duplicates must never appear: that is what collapse=digest does guarantee.
        for i in range(len(digests) - 1):
            assert digests[i] != digests[i + 1], \
                "%s row %d repeats the previous digest, so collapse=digest was not applied" % (
                    fname, i + 1)
        if len(set(digests)) != len(digests):
            repeats_found += 1
            # change_points still counts every row, including the oscillation.
            assert index.change_points == len(digests)
            assert index.change_points > len(set(digests))
    assert total_rows > 0
    assert repeats_found >= 1, \
        "no index contained a non-adjacent digest repeat, so this property is untested here"


# ---------------------------------------------------------------------------
# 1b. Window anchoring.
#
# CDX returns rows OLDEST FIRST, so `limit=` discards the NEWEST rows. Every test below exists
# because the first version of this suite got two failures that looked like missing captures and
# were actually a malformed query, which is precisely the failure mode the module now refuses to
# report as absence.
# ---------------------------------------------------------------------------

#: The field list the six CDX fixtures were captured with. Four columns, not the module default of
#: three: the recapture asked for `statuscode` as well.
CDX_FIELDS_CAPTURED = ("timestamp", "digest", "length", "statuscode")
CDX_TO_DATE = "20260825"
CDX_LIMIT = 200
#: A wall clock reading later than every row in every fixture. Used only as the wrong answer.
WALL_CLOCK = "20260825000000"


def _manifest_routes():
    import json as _json
    manifest = _json.load(io.open(os.path.join(FIXTURES, "manifest.json"), encoding="utf-8"))
    return manifest["routes"]


def _cdx_routes():
    """The six anchored CDX routes: (name, body, pattern, capture, expect, target, pin)."""
    out = []
    for entry in _manifest_routes():
        body = str(entry.get("body") or "")
        if not (body.startswith("cdx-") and body.endswith(".json")):
            continue
        capture = entry.get("capture") or {}
        expect = entry.get("expect") or {}
        pins = expect.get("contains_timestamp") or []
        out.append((entry["name"], body, entry["pattern"], capture, expect,
                    capture.get("target"), pins[0] if pins else None))
    return out


def test_the_anchored_url_this_module_builds_is_the_url_the_fixture_was_captured_with():
    """`cdx_window_for` must reproduce the capture query byte for byte, and match the route.

    The manifest is the strongest available check on the URL builder, because the route patterns
    are the offline harness's match keys and they carry two order-independent lookaheads, the
    target and `from=<pin>`. An unanchored query matches no route and raises FixtureMiss.

    This test found a real defect. `_percent_encode` originally encoded every character outside the
    RFC 3986 unreserved set, so a target arrived as `https%3A%2F%2Fcloud.google.com%2Fterms`. Three
    of the six patterns spell the target path out with literal slashes, so 3 of 6 routes missed on a
    query that was correct and correctly anchored, and the harness would have reported a missing
    fixture. `:` and `/` are now passed through, which RFC 3986 permits in a query, while `? & = #
    % +` and space stay encoded because those can change how the query parses.
    """
    import re as _re
    print("")
    checked = 0
    for name, body, pattern, capture, expect, target, pin in _cdx_routes():
        assert target and pin, name
        url = archive.cdx_window_for(target, pin, CDX_TO_DATE, CDX_LIMIT,
                                     fields=CDX_FIELDS_CAPTURED)
        assert not is_refusal(url), (name, url)
        assert "from=" + pin in url, name
        assert _re.match(pattern, url), \
            "%s: the harness route would not match this url, so it is a FixtureMiss:\n  %s" % (
                name, url)
        query = url.split("?", 1)[1].rsplit("&url=", 1)[0]
        assert query == capture["query"], (name, query, capture["query"])
        # The same target queried without the anchor matches no route, which is the point of
        # putting from= in the pattern: forgetting to anchor fails offline immediately.
        loose = archive.cdx_query_url(target, "20260101", "20260901", 40,
                                      fields=CDX_FIELDS_CAPTURED)
        assert _re.match(pattern, loose) is None, \
            "%s: an unanchored query matched the anchored route" % name
        print("    %-24s anchored url matches the route and the capture query" % name)
        checked += 1
    assert checked == 6, "expected 6 anchored CDX routes, checked %d" % checked


def test_the_pin_is_at_row_zero_in_every_anchored_fixture():
    """Anchoring is a positive check: `from=<pin>` is inclusive and puts the pin at index 0.

    Row 0 is evidence the window was anchored. A hit anywhere in the list is only evidence the pin
    happened to survive truncation, which is what the four superseded fixtures did not.

    Row counts, body sizes and the saturation flag are asserted against the manifest rather than
    against constants in this file, so a recapture reports a fixture change instead of a bug here.
    """
    print("")
    checked = 0
    for name, body, pattern, capture, expect, target, pin in _cdx_routes():
        index = archive.parse_cdx(io.open(os.path.join(FIXTURES, body), "rb").read(),
                                  requested_limit=CDX_LIMIT)
        assert not is_refusal(index), (name, index)
        row = archive.require_timestamp_at_row_zero(index, pin)
        assert not is_refusal(row), (name, row)
        assert row.timestamp == pin and row.exact, name
        assert index.position_of(pin) == 0, (name, index.position_of(pin))
        assert index.oldest.timestamp == pin, name
        assert expect.get("pin_at_row") == 0, name
        assert len(index) == capture["captured_change_points"], (name, len(index))
        assert index.body_len == capture["captured_bytes"], (name, index.body_len)
        want_saturated = bool(capture.get("captured_saturated", False))
        assert index.saturated is want_saturated, (name, index.saturated, want_saturated)
        assert expect.get("saturated", False) is want_saturated, name
        print("    %-24s pin at row 0 of %3d rows, %5d B, saturated=%s"
              % (name, len(index), index.body_len, index.saturated))
        checked += 1
    assert checked == 6


def test_a_pin_below_row_zero_refuses_as_unanchored_and_never_as_absent():
    """The distinction that stops an operator hunting for a capture that is right in front of them.

    cdx-gcp-deprecation.json holds two pins: its anchor at row 0 and a second capture at row 4,
    recorded in the manifest as `captured_second_pin_row`. The second one is the natural example of
    a present-but-not-anchored timestamp, and the lax lookup finds it happily.
    """
    body = io.open(os.path.join(FIXTURES, "cdx-gcp-deprecation.json"), "rb").read()
    index = archive.parse_cdx(body, requested_limit=CDX_LIMIT)
    assert not is_refusal(index), index

    second = TS_GCP_DEPRECATION
    position = index.position_of(second)
    assert position == 4, ("manifest says the second pin sits at row 4", position)

    # The trap: membership succeeds, so a lax check calls this window fine.
    lax = archive.require_timestamp(index, second)
    assert not is_refusal(lax) and lax.timestamp == second

    strict = archive.require_timestamp_at_row_zero(index, second)
    assert is_refusal(strict), strict
    assert strict.tag == EXPECTED, strict
    assert strict.reason == "cdx-window-not-anchored", strict.reason
    assert strict.reason != "cdx-timestamp-not-in-index"
    assert "row 4" in strict.detail, strict.detail
    assert "not anchored" in strict.detail, strict.detail
    # It must not read as absence. The word would send someone to the wrong place.
    assert "absent" not in strict.detail.lower(), strict.detail

    # A genuinely missing timestamp gets the other reason, and the two are distinguishable.
    missing = archive.require_timestamp_at_row_zero(index, "20200101000000")
    assert is_refusal(missing) and missing.tag == EXPECTED
    assert missing.reason == "cdx-timestamp-not-in-index", missing.reason
    assert "absent" in missing.detail
    assert missing.reason != strict.reason

    # An inexact pin cannot anchor anything and is refused before the index is consulted.
    inexact = archive.require_timestamp_at_row_zero(index, "2023032014")
    assert is_refusal(inexact) and inexact.tag == EXPECTED
    print("\n    row 4 -> %s\n    absent -> %s" % (strict.reason, missing.reason))


def test_next_cursor_is_the_newest_row_examined_and_never_a_clock():
    """The cursor is `rows[-1].timestamp`. A wall clock reading would skip the unread tail.

    Measured on cdx-gcp-terms.json: 200 rows over 78 days, about 2.56 change points a day, and the
    window saturates. The newest row examined is 20260417134054. A check that set the cursor to
    2026-08-25 would step over every change point after 17 April, permanently, because a cursor
    only moves forward. Those are exactly the change points a bond exists to catch.

    `next_cursor` takes one argument, so no clock and no `to=` bound can be handed to it.
    """
    assert archive.next_cursor.__code__.co_argcount == 1, \
        "next_cursor must not accept a clock or a window bound"
    print("")
    for name, body, pattern, capture, expect, target, pin in _cdx_routes():
        index = archive.parse_cdx(io.open(os.path.join(FIXTURES, body), "rb").read(),
                                  requested_limit=CDX_LIMIT)
        cursor = archive.next_cursor(index)
        timestamps = [r.timestamp for r in index.rows]
        assert cursor == index.rows[-1].timestamp, name
        assert cursor == max(timestamps), name
        assert archive.is_exact_timestamp(cursor), (name, cursor)
        assert cursor >= pin, (name, cursor, pin)
        # Never the clock, and never the to= bound the query carried.
        assert cursor != WALL_CLOCK and cursor < WALL_CLOCK, (name, cursor)
        assert not cursor.startswith(CDX_TO_DATE), (name, cursor)
        # Re-anchoring on the cursor is what makes the walk monotonic: the next window starts at
        # the last row read, so the overlap is one row and there is no gap.
        again = archive.cdx_window_for(target, cursor, CDX_TO_DATE, CDX_LIMIT,
                                       fields=CDX_FIELDS_CAPTURED)
        assert not is_refusal(again) and ("from=" + cursor) in again, name
        print("    %-24s cursor=%s (clock %s would skip everything after it)"
              % (name, cursor, WALL_CLOCK))

    saturated = archive.parse_cdx(
        io.open(os.path.join(FIXTURES, "cdx-gcp-terms.json"), "rb").read(),
        requested_limit=CDX_LIMIT)
    assert saturated.saturated is True
    assert archive.next_cursor(saturated) == saturated.rows[-1].timestamp
    assert archive.next_cursor(saturated) < WALL_CLOCK


def test_a_saturated_window_is_usable_and_never_a_refusal():
    """Saturation means the next check has work waiting. It is not an error and not a Refusal.

    Two of the six fixtures saturate at 200 rows. Refusing them would break bonds on exactly the
    pages that are archived most often, which is the wrong population to fail.
    """
    saturating = [r for r in _cdx_routes() if (r[3].get("captured_saturated") is True)]
    assert len(saturating) == 2, "expected 2 saturating fixtures, found %d" % len(saturating)
    print("")
    for name, body, pattern, capture, expect, target, pin in saturating:
        raw = io.open(os.path.join(FIXTURES, body), "rb").read()
        index = archive.parse_cdx(raw, requested_limit=CDX_LIMIT)
        assert not is_refusal(index), (name, index)
        assert index.saturated is True and len(index) == CDX_LIMIT, name
        # Still fully usable: the pin resolves, the cursor resolves, the count rule answers.
        assert not is_refusal(archive.require_timestamp_at_row_zero(index, pin)), name
        assert archive.is_exact_timestamp(archive.next_cursor(index)), name
        assert archive.has_min_change_points(index) is True, name
        print("    %-24s saturated at %d rows and every accessor still answers"
              % (name, len(index)))

    # Parsed without a limit, saturation is unknown rather than guessed in either direction.
    unknown = archive.parse_cdx(
        io.open(os.path.join(FIXTURES, "cdx-gcp-terms.json"), "rb").read())
    assert unknown.saturated is None and unknown.requested_limit is None
    # A short window is not saturated, and asking for fewer rows than arrived flips the flag.
    short = archive.parse_cdx(
        io.open(os.path.join(FIXTURES, "cdx-github-tos.json"), "rb").read(),
        requested_limit=CDX_LIMIT)
    assert short.saturated is False and len(short) == 1
    assert archive.parse_cdx(_cdx_body([(TS_GITHUB, "AAAA", "116")]),
                             requested_limit=1).saturated is True


def test_the_change_point_count_rule_needs_a_limit_strictly_above_the_threshold():
    """PRD section 5: at least 3 change points in the trailing 365 days. The one unanchorable query.

    Truncation can only undercount here, because `limit=` drops the newest rows, so a truncated
    window already showing 3 has satisfied the rule. That safety collapses at `limit == threshold`,
    where every sufficiently archived page returns exactly the threshold and the test passes by
    construction, so the limit is checked rather than trusted.
    """
    assert archive.MIN_CHANGE_POINTS == 3
    assert archive.CHANGE_POINT_WINDOW_DAYS == 365

    three = _cdx_body([("20250101000000", "AAAA", "100"),
                       ("20250601000000", "BBBB", "100"),
                       ("20251201000000", "CCCC", "100")])
    for limit, ok in ((2, False), (3, False), (4, True), (200, True)):
        index = archive.parse_cdx(three, requested_limit=limit)
        verdict = archive.has_min_change_points(index)
        if ok:
            assert verdict is True, (limit, verdict)
        else:
            assert is_refusal(verdict), (limit, verdict)
            assert verdict.tag == EXPECTED and verdict.reason == "change-point-limit-too-low"
            assert str(archive.MIN_CHANGE_POINTS) in verdict.detail

    # No limit recorded at all is unknown, not assumed adequate.
    unknown = archive.has_min_change_points(archive.parse_cdx(three))
    assert is_refusal(unknown) and unknown.reason == "change-point-limit-unknown"
    # An explicitly passed limit overrides whatever the index remembers.
    assert archive.has_min_change_points(archive.parse_cdx(three, requested_limit=3),
                                         requested_limit=40) is True

    # Below the threshold is a plain False, not a Refusal: the URL is ineligible, nothing failed.
    two = archive.parse_cdx(_cdx_body([("20250101000000", "AAAA", "100"),
                                       ("20250601000000", "BBBB", "100")]), requested_limit=40)
    assert archive.has_min_change_points(two) is False

    print("")
    for name, body, pattern, capture, expect, target, pin in _cdx_routes():
        index = archive.parse_cdx(io.open(os.path.join(FIXTURES, body), "rb").read(),
                                  requested_limit=CDX_LIMIT)
        verdict = archive.has_min_change_points(index)
        assert verdict is (len(index) >= 3), name
        print("    %-24s %3d change points -> eligible=%s" % (name, len(index), verdict))


def test_load_anchored_window_refuses_before_it_fetches_and_after_it_parses():
    """The wired path: build anchored, parse with the limit, then check position, not membership."""
    github_body = io.open(os.path.join(FIXTURES, "cdx-github-tos.json"), "rb").read()
    target = "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service"

    seen = []

    def recording_fetch(url, method="GET", headers=None, timeout=None):
        seen.append(url)
        return _Response(200, github_body)

    index = archive.load_anchored_window(recording_fetch, target, TS_GITHUB,
                                         CDX_TO_DATE, CDX_LIMIT)
    assert not is_refusal(index), index
    assert index.position_of(TS_GITHUB) == 0 and index.saturated is False
    assert len(seen) == 1 and ("from=" + TS_GITHUB) in seen[0]

    # An inexact pin is refused before any request is made.
    def exploding_fetch(url, method="GET", headers=None, timeout=None):
        raise AssertionError("fetch must not be called for an inexact pin: %s" % url)

    refusal = archive.load_anchored_window(exploding_fetch, target, "2026082212320",
                                           CDX_TO_DATE, CDX_LIMIT)
    assert is_refusal(refusal) and refusal.tag == EXPECTED, refusal

    # A body whose pin is not at row 0 is refused as unanchored, after the fetch.
    deprecation = io.open(os.path.join(FIXTURES, "cdx-gcp-deprecation.json"), "rb").read()
    unanchored = archive.load_anchored_window(
        _fetch_returning(200, deprecation),
        "https://cloud.google.com/terms/deprecation", TS_GCP_DEPRECATION,
        CDX_TO_DATE, CDX_LIMIT)
    assert is_refusal(unanchored) and unanchored.reason == "cdx-window-not-anchored", unanchored

    # And absence is still absence: `[]` stays [EXTERNAL], never "nothing changed".
    empty = archive.load_anchored_window(_fetch_returning(200, b"[]"), target, TS_GITHUB,
                                         CDX_TO_DATE, CDX_LIMIT)
    assert is_refusal(empty) and empty.tag == EXTERNAL and empty.reason == "cdx-empty"


def test_no_float_reaches_the_consensus_tuple_even_with_gate_a_enabled():
    """Gate A computes a ratio in floating point. That number must not reach an equivalence tuple.

    `Qualification.gate_a_ratio` is a float and is deliberately excluded; `ratio_bucket` is the
    integer that goes in instead. That much the module gets right, and it is asserted first.

    The rest of this test records a limit of the bucketing that I got wrong on the first attempt.
    Bucketing NARROWS the disagreement surface, it does not close it. `int(ratio * 20)` truncates,
    so a ratio sitting exactly on a bucket edge flips buckets on a one character change in the
    median:

        median 48934  ratio 1.000000  bucket 20
        median 48935  ratio 0.999980  bucket 19

    Both agree the gate passed and both agree the snapshot qualified, yet the tuples differ. Under
    strict_eq that is the worst available shape: validators revert over a field that carries no
    decision while unanimously agreeing on the decision itself. The median is derived from a CDX
    response each validator fetches for itself, and this fixture set shows those responses moving,
    so agreement on it cannot be assumed.

    A third independent reason gate A stays off by default, alongside the 2,738 against 35,689
    pair. Bucketing is not a substitute for agreeing on the input.
    """
    raw = fixture(GITHUB)
    spec = spec_for(GITHUB, enable_gate_a=True)
    admission = archive.admit_snapshot(raw, MEASURED[GITHUB][4], spec, timestamp=TS_GITHUB,
                                       median_text_len=48934)
    assert not is_refusal(admission), admission
    q = admission.qualification
    assert isinstance(q.gate_a_ratio, float) and q.gate_a_ratio == 1.0
    assert isinstance(q.ratio_bucket, int) and q.ratio_bucket == 20

    tuple_ = archive.admissibility_tuple(admission)
    for element in tuple_:
        assert not isinstance(element, float), element
    assert 20 in tuple_, "the bucketed integer is what travels"
    # Membership is the wrong test for float leakage and this line records why: `1.0 in tuple_` is
    # True here because the tuple contains True and `1.0 == True` in Python. Only the isinstance
    # loop above actually proves the absence of a float.
    assert 1.0 in tuple_ and not [x for x in tuple_ if isinstance(x, float)]

    def admit(median):
        return archive.admit_snapshot(raw, MEASURED[GITHUB][4], spec, timestamp=TS_GITHUB,
                                      median_text_len=median)

    # Mid-bucket: a large perturbation is absorbed, which is what bucketing is for.
    mid_a, mid_b = admit(49000), admit(51000)
    assert mid_a.qualification.gate_a_ratio != mid_b.qualification.gate_a_ratio
    assert mid_a.qualification.ratio_bucket == mid_b.qualification.ratio_bucket == 19
    assert archive.admissibility_tuple(mid_a) == archive.admissibility_tuple(mid_b)

    # On the edge: a one character perturbation is not absorbed.
    edge_a, edge_b = admit(48934), admit(48935)
    assert edge_a.qualification.ratio_bucket == 20
    assert edge_b.qualification.ratio_bucket == 19
    assert edge_a.qualification.gate_a is edge_b.qualification.gate_a is True
    assert edge_a.qualified is edge_b.qualified is True, "same verdict"
    assert archive.admissibility_tuple(edge_a) != archive.admissibility_tuple(edge_b), \
        "the tuples differ on ratio_bucket alone, which is the hazard being recorded"
    differing = [i for i, (x, y) in enumerate(zip(archive.admissibility_tuple(edge_a),
                                                  archive.admissibility_tuple(edge_b)))
                 if x != y]
    assert differing == [6], "only ratio_bucket differs, and it carries no decision"

    # With gate A off, as it ships, the slot is None and the hazard cannot arise even though the
    # caller supplied a median. This is the bug this test found: `ratio_bucket` used to be emitted
    # whenever a median was supplied, so a DISABLED gate still put its arithmetic into consensus
    # and a one character difference in the median still forced a revert.
    off_a = archive.admit_snapshot(raw, MEASURED[GITHUB][4], spec_for(GITHUB),
                                   timestamp=TS_GITHUB, median_text_len=48934)
    off_b = archive.admit_snapshot(raw, MEASURED[GITHUB][4], spec_for(GITHUB),
                                   timestamp=TS_GITHUB, median_text_len=48935)
    assert off_a.qualification.gate_a is None, "the gate did not run"
    assert off_a.qualification.ratio_bucket == 20, "the diagnostic is still computed"
    assert off_b.qualification.ratio_bucket == 19
    assert archive.admissibility_tuple(off_a)[6] is None, \
        "a disabled gate must contribute nothing to the consensus tuple"
    assert archive.admissibility_tuple(off_b)[6] is None
    assert archive.admissibility_tuple(off_a) == archive.admissibility_tuple(off_b), \
        "with gate A off, a differing median must not be able to force a revert"

    # And with no median at all, nothing changes.
    none = archive.admit_snapshot(raw, MEASURED[GITHUB][4], spec_for(GITHUB),
                                  timestamp=TS_GITHUB)
    assert none.qualification.ratio_bucket is None
    assert archive.admissibility_tuple(none) == archive.admissibility_tuple(off_a)


def test_median_warc_length_is_a_float_on_an_even_row_count():
    """A sharp edge worth knowing about, since the median feeds gate A.

    `median_warc_length` averages the two middle rows on an even count, so it can return a float
    even though every input was an integer. It is a diagnostic and a gate A input, and gate A is
    off by default, so nothing consensus-facing sees it today. Pinned so that if the median ever
    starts feeding an equivalence tuple, this fails first.
    """
    even = archive.parse_cdx(_cdx_body([("20230320142124", "AAAA", "100"),
                                        ("20230322203343", "BBBB", "101")]))
    assert even.median_warc_length() == 100.5
    assert isinstance(even.median_warc_length(), float)
    odd = archive.parse_cdx(_cdx_body([("20230320142124", "AAAA", "100"),
                                       ("20230322203343", "BBBB", "101"),
                                       ("20230930200234", "CCCC", "108")]))
    assert odd.median_warc_length() == 101 and isinstance(odd.median_warc_length(), int)
    none = archive.parse_cdx(_cdx_body([("20230320142124", "AAAA", "-")]))
    assert none.median_warc_length() is None
    # It is not in the consensus tuple, which is the point.
    raw = fixture(OPENAI_IDENTITY)
    admission = archive.admit_snapshot(raw, MEASURED[OPENAI_IDENTITY][4],
                                       spec_for(OPENAI_IDENTITY), timestamp=TS_OPENAI_IDENTITY)
    assert 100.5 not in archive.admissibility_tuple(admission)


def test_only_an_exact_14_digit_timestamp_is_accepted():
    assert archive.is_exact_timestamp(TS_EXACT_NEIGHBOUR)
    for bad in ("2023032014212", "202303201421245", "20230320", "2023", "", "2023-03-20",
                "2023032014212a", " 20230320142124"):
        refusal = archive.require_exact_timestamp(bad)
        assert is_refusal(refusal) and refusal.tag == EXPECTED, bad
        assert refusal.reason.startswith("timestamp-not"), (bad, refusal)
    # The +1 second form is 14 digits, so it is not a caller error. It passes the syntax gate,
    # gets fetched, and comes back 302. The two PRD rules govern different stages.
    assert archive.require_exact_timestamp(TS_INEXACT) is None


def test_snapshot_and_cdx_urls():
    url = archive.snapshot_url(TS_GITHUB, "https://docs.github.com/x")
    assert url == "https://web.archive.org/web/20260822123203id_/https://docs.github.com/x"
    assert "id_/" in url, "without id_ Wayback rewrites the page and the digest is unreproducible"
    query = archive.cdx_query_url("https://cloud.google.com/terms/deprecation",
                                  "20230101", "20240101", 40)
    for required in ("output=json", "fl=timestamp,digest,length", "filter=statuscode:200",
                     "collapse=digest", "from=20230101", "to=20240101", "limit=40"):
        assert required in query, required
    # The target is spelled out, because the harness route patterns match on the literal path.
    assert query.endswith("&url=https://cloud.google.com/terms/deprecation"), query
    # But anything that could change how the query parses is still encoded.
    tricky = archive.cdx_query_url("https://x.test/a?b=1&c=2#d e+f%z", "20230101", "20240101", 1)
    tail = tricky.rsplit("&url=", 1)[1]
    assert tail == "https://x.test/a%3Fb%3D1%26c%3D2%23d%20e%2Bf%25z", tail
    for bad in ("?", "&", "=", "#", " ", "+", "%z"):
        assert bad not in tail.replace("%3F", "").replace("%26", "").replace("%3D", "") \
            .replace("%23", "").replace("%20", "").replace("%2B", "").replace("%25", ""), bad


# ---------------------------------------------------------------------------
# 5. Commitment normalization
# ---------------------------------------------------------------------------

COMMITMENT = ("We will give you at least 30 days notice before we make any change "
              "that materially reduces the functionality of the service.")


def test_normalize_commitment_is_exactly_four_steps():
    assert archive.normalize_commitment("  We Will GIVE\t30  Days' Notice.  ") == \
        "we will give 30 days notice"
    # Step 2 before step 3 means a stripped character between two words joins them.
    assert archive.normalize_commitment("gzip/deflate") == "gzipdeflate"
    assert archive.normalize_commitment("co-operate") == "cooperate"
    assert archive.normalize_commitment("a\n\n\tb\r\nc") == "a b c"
    assert archive.normalize_commitment("a   b") == "a b"
    assert archive.normalize_commitment("   ") == ""
    assert archive.normalize_commitment(None) == ""
    once = archive.normalize_commitment(COMMITMENT)
    assert archive.normalize_commitment(once) == once
    assert once == ("we will give you at least 30 days notice before we make any change that "
                    "materially reduces the functionality of the service")


def test_normalization_is_not_idempotent_on_space_delimited_punctuation():
    """MEASURED, and a live footgun.

    The pinned order collapses whitespace BEFORE stripping, so a character removed from between
    two spaces leaves both spaces behind and nothing re-collapses them:

        "30 EUR / (c) 2026"  ->  "30 eur  c 2026"   second pass  ->  "30 eur c 2026"

    So `commitment_hash(normalize(s))` is not `commitment_hash(s)`. The rule that keeps it
    harmless: hash the caller's ORIGINAL string exactly once, at bond creation, and compare
    against the stored hash forever after. Never normalize defensively on the way in.
    """
    assert archive.normalize_commitment("30 EUR / (c) 2026") == "30 eur  c 2026"
    assert archive.normalize_commitment("a - b") == "a  b"
    assert archive.normalize_commitment("a / b") == "a  b"
    once = archive.normalize_commitment("30 EUR / (c) 2026")
    twice = archive.normalize_commitment(once)
    assert twice == "30 eur c 2026" and once != twice
    assert archive.commitment_hash("30 EUR / (c) 2026") != archive.commitment_hash(once)
    # Punctuation that is not space-delimited is idempotent, which is why the ordinary case never
    # trips over this.
    for text in ("a (b) c", COMMITMENT, "we will give 30 days notice"):
        first = archive.normalize_commitment(text)
        assert archive.normalize_commitment(first) == first, text


def test_commitment_hash_is_over_the_normalized_form():
    a = archive.commitment_hash("  We WILL give 30 Days' notice!  ")
    b = archive.commitment_hash("we will give 30 days notice")
    assert a == b, "hash must be over the normalized form, not the raw words"
    assert len(a) == 64 and all(c in "0123456789abcdef" for c in a)
    assert archive.commitment_hash("we will give 60 days notice") != a


def test_commitment_text_is_found_in_a_real_capture():
    """A normalized substring search against 48,934 characters of real extracted text."""
    text = archive.normalize_text(
        archive.extract_text(archive.decode_checked(fixture(GITHUB)).data))
    for phrase in ("terms of service", "github", "account"):
        assert archive.normalize_commitment(phrase) in text, phrase
    assert archive.normalize_commitment("no such clause exists in this document") not in text


# ---------------------------------------------------------------------------
# Injected transport, and the refusal taxonomy
# ---------------------------------------------------------------------------

class _Response(object):
    """Mirrors GenVM's shape: `.status` is an int, `.body` is bytes."""

    def __init__(self, status, body=b"", headers=None):
        self.status = int(status)
        self.body = body
        self.headers = headers or {}


def _fetch_returning(status, body=b"", response_headers=None):
    def fetch(url, method="GET", headers=None, timeout=None):
        return _Response(status, body, response_headers)
    return fetch


def test_inexact_timestamp_302_is_external_and_never_followed():
    """MANIFEST: one second past a real capture returns 302, and must not be followed.

    A silently substituted snapshot is a different document with a different digest.
    """
    location = "/web/%sid_/https://cloud.google.com/terms/deprecation" % TS_EXACT_NEIGHBOUR
    calls = []

    def fetch(url, method="GET", headers=None, timeout=None):
        calls.append(url)
        return _Response(302, b"", {"location": location})

    result = archive.retrieve_snapshot(fetch, TS_INEXACT,
                                       "https://cloud.google.com/terms/deprecation",
                                       "A" * 32, spec_for(GCP_TERMS))
    assert is_refusal(result), result
    assert result.tag == EXTERNAL and result.reason == "redirect", result
    assert len(calls) == 1, "exactly one fetch, and the redirect was not followed"
    assert TS_INEXACT in calls[0] and TS_EXACT_NEIGHBOUR not in calls[0]


def test_retrieve_snapshot_end_to_end_on_a_real_payload():
    """The whole path with an injected transport serving real captured bytes."""
    raw = fixture(GITHUB)
    calls = []

    def fetch(url, method="GET", headers=None, timeout=None):
        calls.append(url)
        return _Response(200, raw)

    result = archive.retrieve_snapshot(fetch, TS_GITHUB, "https://docs.github.com/tos",
                                       MEASURED[GITHUB][4], spec_for(GITHUB))
    assert not is_refusal(result), result
    assert result.qualified is True
    assert result.encoding == "gzip" and len(result.decoded) == 372058
    assert len(calls) == 1 and "id_/" in calls[0] and TS_GITHUB in calls[0]

    # A digest that does not match the served bytes stops the whole thing.
    bad = archive.retrieve_snapshot(fetch, TS_GITHUB, "https://docs.github.com/tos",
                                    "A" * 32, spec_for(GITHUB))
    assert is_refusal(bad) and bad.tag == TRANSIENT and bad.reason == "digest-mismatch"


def test_403_and_429_and_other_non_200_are_external():
    for status, reason in ((403, "throttled"), (429, "throttled"), (404, "non-200"),
                           (500, "non-200"), (204, "non-200")):
        refusal = archive.fetch_bytes(_fetch_returning(status), "https://example.test/x")
        assert is_refusal(refusal) and refusal.tag == EXTERNAL, status
        assert refusal.reason == reason, (status, refusal)


def test_transport_failure_is_transient():
    def fetch(url, method="GET", headers=None, timeout=None):
        raise IOError("connection reset")
    refusal = archive.fetch_bytes(fetch, "https://example.test/x")
    assert is_refusal(refusal) and refusal.tag == TRANSIENT
    assert refusal.reason == "transport"


def test_fetch_is_called_with_a_long_timeout():
    seen = {}

    def fetch(url, method="GET", headers=None, timeout=None):
        seen["timeout"] = timeout
        seen["method"] = method
        return _Response(200, b"[]")
    archive.fetch_bytes(fetch, "https://example.test/x")
    assert seen["timeout"] == 120 and seen["method"] == "GET", seen


def test_response_parts_prefers_status_over_status_code():
    class Both(object):
        status = 200
        status_code = 500
        body = b"ok"
        headers = {}
    assert archive.response_parts(Both())[0] == 200, \
        "GenVM exposes .status; the documented .status_code does not exist"
    assert archive.response_parts({"status": 200, "body": "ok"})[0] == 200
    assert archive.response_parts({"status_code": 200, "body": b"ok"})[0] == 200
    assert archive.response_parts(object()) is None


def test_refusal_tags_are_exactly_the_four():
    assert (EXPECTED, EXTERNAL, TRANSIENT, archive.LLM_ERROR) == \
        ("[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]")
    try:
        Refusal("[NOPE]", "x")
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown tag must not be constructible")


def test_admissibility_tuple_is_safe_for_strict_equality():
    raw = fixture(OPENAI_IDENTITY)
    admission = archive.admit_snapshot(raw, MEASURED[OPENAI_IDENTITY][4],
                                       spec_for(OPENAI_IDENTITY),
                                       timestamp=TS_OPENAI_IDENTITY)
    assert not is_refusal(admission), admission
    tuple_ = archive.admissibility_tuple(admission)
    assert len(tuple_) == 11, tuple_
    for element in tuple_:
        assert not isinstance(element, float), \
            "a float in a strict_eq tuple is a consensus hazard: %r" % (element,)
        assert isinstance(element, (str, int, bool, type(None))), element
    assert tuple_[0] == TS_OPENAI_IDENTITY
    assert tuple_[1] == MEASURED[OPENAI_IDENTITY][4]
    assert tuple_[2] == archive.DIGEST_AS_ARCHIVED
    assert tuple_[5] == archive.sha256_hex(raw)


# ---------------------------------------------------------------------------
# The section 11 fixture set, and the central claim
# ---------------------------------------------------------------------------

def _gzip(data, level=9):
    obj = zlib.compressobj(level, zlib.DEFLATED, 16 + zlib.MAX_WBITS)
    return obj.compress(data) + obj.flush()


def _identity_only_decode(raw, cap=archive.DECODED_MAX_BYTES):
    """A build with no decompression at all. The bug this project exists to prevent."""
    raw = bytes(raw)
    if len(raw) > cap:
        return Refusal(EXTERNAL, "decoded-cap", "%d > %d" % (len(raw), cap))
    return Decoded(raw, "identity", archive.magic_hex(raw), len(raw), None)


def _unconditional_gunzip(raw, cap=archive.DECODED_MAX_BYTES):
    """The opposite regression: gunzip everything, with no branch."""
    raw = bytes(raw)
    try:
        out = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
    except zlib.error as error:
        return Refusal(TRANSIENT, "undecodable", str(error))
    if len(out) > cap:
        return Refusal(EXTERNAL, "decoded-cap", "%d > %d" % (len(out), cap))
    return Decoded(out, "gzip", archive.magic_hex(raw), len(raw), None)


def _payload_fixture(name, timestamp, gated):
    """A fixture whose check runs the real bytes through the module with a given decode."""
    raw_len, magic, decoded_len, kind, digest, text_len = MEASURED[name]

    def check(decode):
        failures = []
        spec = spec_for(name) if gated else spec_for(GITHUB)
        result = archive.admit_snapshot(fixture(name), digest, spec, timestamp=timestamp,
                                        decode=decode)
        if is_refusal(result):
            return ["refused:%s" % result.reason]
        if result.encoding != kind:
            failures.append("encoding")
        if len(result.decoded) != decoded_len:
            failures.append("decoded_bytes")
        if result.decoded.magic != magic:
            failures.append("magic")
        if gated:
            # No gate is asserted for a page with no declared anchor or sections.
            if not result.qualified:
                failures.append("gate")
            if result.qualification.text_len != text_len:
                failures.append("text_len")
        return failures

    pinned = "%s %d -> %d B" % (magic, raw_len, decoded_len)
    if gated:
        pinned += ", QUALIFIED"
    else:
        pinned += ", no gate declared"
    return {"name": name, "timestamp": timestamp, "pinned": pinned, "check": check,
            "magic": magic}


def _fixtures():
    """The PRD section 11 set as it now stands: nine captured routes, plus the synthetic shell."""
    out = [
        _payload_fixture(GITHUB, TS_GITHUB, True),
        _payload_fixture(AWS, TS_AWS, True),
        _payload_fixture(GCP_TERMS, TS_GCP_TERMS, True),
        _payload_fixture(OPENAI_GZIP, TS_OPENAI_GZIP, True),
        _payload_fixture(OPENAI_IDENTITY, TS_OPENAI_IDENTITY, True),
        # The fifth gzip member. No anchor, sections or terminal are declared for this page
        # anywhere, so no gate is evaluated and none is claimed.
        _payload_fixture(GCP_DEPRECATION, TS_GCP_DEPRECATION, False),
    ]

    # Oversize: identity, accepted as a pinned baseline, refused as a change point.
    def check_oversize(decode):
        raw = fixture(OVERSIZE)
        digest = archive.cdx_digest(raw)
        spec = spec_for(GCP_TERMS)
        admitted = archive.admit_snapshot(raw, digest, spec, timestamp=TS_OVERSIZE,
                                          decode=decode)
        if is_refusal(admitted):
            return ["refused:%s" % admitted.reason]
        if admitted.encoding != "identity" or len(admitted.decoded) != 2044592:
            return ["identity"]
        as_change_point = archive.admit_snapshot(raw, digest, spec, timestamp=TS_OVERSIZE,
                                                 warc_length=OVERSIZE_CDX_LENGTH, decode=decode)
        if not is_refusal(as_change_point) or as_change_point.reason != "cdx-length-cap":
            return ["cap1"]
        if archive.check_raw_len(2044592) is not None:
            return ["cap2"]
        if archive.check_decoded_len(2044592) is not None:
            return ["cap3"]
        return []

    out.append({"name": OVERSIZE, "timestamp": TS_OVERSIZE, "magic": "3c21",
                "pinned": "3c21 2044592 -> 2044592 B, cdx length 260662",
                "check": check_oversize})

    def check_never_archived(decode):
        refusal = archive.load_change_points(
            _fetch_returning(200, b"[]"), "https://example.test/never-archived",
            "20260101", "20260901", 40)
        if not is_refusal(refusal):
            return ["not_refused"]
        if refusal.tag != EXTERNAL or refusal.reason != "cdx-empty":
            return ["classification"]
        return []

    out.append({"name": "cdx-never-archived", "timestamp": "n/a", "magic": "n/a",
                "pinned": "200 with [], [EXTERNAL]", "check": check_never_archived})

    def check_inexact(decode):
        seen = []

        def fetch(url, method="GET", headers=None, timeout=None):
            seen.append(url)
            return _Response(302, b"", {"location": "/web/%sid_/x" % TS_EXACT_NEIGHBOUR})
        result = archive.retrieve_snapshot(fetch, TS_INEXACT, "https://example.test/x",
                                           "A" * 32, spec_for(GCP_TERMS), decode=decode)
        if not is_refusal(result):
            return ["not_refused"]
        if result.tag != EXTERNAL or result.reason != "redirect":
            return ["classification"]
        if len(seen) != 1 or TS_EXACT_NEIGHBOUR in seen[0]:
            return ["followed"]
        return []

    out.append({"name": "snap-inexact-timestamp", "timestamp": TS_INEXACT, "magic": "n/a",
                "pinned": "302, [EXTERNAL], never followed", "check": check_inexact})

    assert len(out) == 9, len(out)

    # The tenth, synthetic and labelled so: the gate's only negative case.
    def check_chrome_only(decode):
        raw = fixture(CHROME_ONLY)
        result = archive.admit_snapshot(raw, archive.cdx_digest(raw), spec_for(CHROME_ONLY),
                                        decode=decode)
        if is_refusal(result):
            return ["refused:%s" % result.reason]
        failures = []
        if len(result.decoded) != 35640:
            failures.append("decoded_bytes")
        q = result.qualification
        if q.gate_b is not True:
            failures.append("gate_b_must_pass")
        if q.gate_c is not False or q.gate_c_hits != 0:
            failures.append("gate_c_must_fail_0_of_4")
        if q.gate_d is not False:
            failures.append("gate_d_must_fail")
        if q.qualified is not False:
            failures.append("must_be_rejected")
        if q.text_len != 569:
            failures.append("text_len")
        return failures

    out.append({"name": CHROME_ONLY + " (synthetic)", "timestamp": "n/a", "magic": "1f8b",
                "pinned": "1f8b 8015 -> 35640 B, B pass C 0/4 D fail, REJECTED",
                "check": check_chrome_only})
    return out


def test_the_section_11_fixture_set_holds():
    fixtures = _fixtures()
    print("")
    print("    %-42s %-15s %s" % ("fixture", "timestamp", "pinned"))
    broken = []
    for entry in fixtures:
        failures = entry["check"](None)
        flag = "ok  " if not failures else "FAIL"
        print("    %s %-41s %-15s %s%s"
              % (flag, entry["name"], entry["timestamp"], entry["pinned"],
                 "  <- " + ",".join(failures) if failures else ""))
        if failures:
            broken.append((entry["name"], failures))
    assert not broken, broken
    assert len(fixtures) == 10, "nine captured routes plus one synthetic"


def test_a_build_that_skips_decompression_fails_five_of_the_nine():
    """The central claim of the project, executable, and now arithmetically true.

    PRD section 11: "A build that skips gzip decoding fails five of these nine and would have
    paid out four wrong bonds."

    MEASURED. Exactly five of the nine captured routes carry magic 1f8b, and identity-only decode
    breaks exactly those five: the four terms pages plus snap-gcp-deprecation-incomplete, which
    is the fifth gzip member and is not incomplete at all. The other four are untouched, and each
    for a different reason: two are identity captures, and two never reach a decode.

    An earlier draft of this test asserted four, because the fifth member had been recorded as a
    truncated capture that a gate would reject. That was wrong about the file, and the count came
    out one short as a direct result.
    """
    fixtures = _fixtures()
    captured = [f for f in fixtures if "synthetic" not in f["name"]]
    assert len(captured) == 9, len(captured)

    skipped = [f["name"] for f in captured if f["check"](_identity_only_decode)]
    gunzipped = [f["name"] for f in captured if f["check"](_unconditional_gunzip)]
    union = sorted(set(skipped) | set(gunzipped))

    print("")
    print("    skip decompression      breaks %d of 9" % len(skipped))
    for name in skipped:
        print("        %s" % name)
    print("    unconditional gunzip    breaks %d of 9" % len(gunzipped))
    for name in gunzipped:
        print("        %s" % name)
    print("    either regression       breaks %d of 9" % len(union))

    assert len(skipped) == 5, skipped
    # Exactly the five 1f8b routes, no more and no fewer.
    assert set(skipped) == {f["name"] for f in captured if f["magic"] == "1f8b"}, skipped
    assert GCP_DEPRECATION in skipped, "the fifth member"
    assert OVERSIZE not in skipped, "identity, so a skipped decode cannot touch it"

    # The opposite regression breaks the two identity captures.
    assert len(gunzipped) == 2, gunzipped
    assert set(gunzipped) == {OPENAI_IDENTITY, OVERSIZE}, gunzipped
    assert len(union) == 7, union

    # "Would have paid out four wrong bonds": of the five broken fixtures, the four with a
    # declared gate spec all fail the gate, which in the live contract is what a deleted clause
    # looks like. The fifth has no declared spec, so it fails on its decoded byte count instead.
    paid_out_wrong = []
    for entry in captured:
        if entry["magic"] != "1f8b":
            continue
        failures = entry["check"](_identity_only_decode)
        assert "decoded_bytes" in failures, (entry["name"], failures)
        if "gate" in failures:
            paid_out_wrong.append(entry["name"])
    assert len(paid_out_wrong) == 4, paid_out_wrong
    assert GCP_DEPRECATION not in paid_out_wrong


def test_skipping_decompression_agrees_unanimously_on_noise():
    """Why consensus is no defence, in one assertion.

    The undecoded bytes are byte-identical for every validator, so the admissibility tuple is
    identical too. Ten validators produce ten identical tuples carrying `qualified=False` on a
    document that is perfectly intact. They do not disagree and revert. They agree, and the bond
    pays out against an innocent promisor.
    """
    raw = fixture(GITHUB)
    spec = spec_for(GITHUB)
    digest = MEASURED[GITHUB][4]

    tuples = set()
    for _ in range(10):
        result = archive.admit_snapshot(raw, digest, spec, timestamp=TS_GITHUB,
                                        decode=_identity_only_decode)
        assert not is_refusal(result), result
        tuples.add(archive.admissibility_tuple(result))
    assert len(tuples) == 1, "every validator computed the same wrong tuple"
    only = tuples.pop()
    assert only[9] is False, "unanimous, deterministic, and wrong"

    # Gate C scores 0 of 4 on the noise: not slightly short, none of them.
    noise = archive.admit_snapshot(raw, digest, spec, timestamp=TS_GITHUB,
                                   decode=_identity_only_decode)
    assert noise.qualification.gate_c_hits == 0
    assert set(noise.qualification.failed_gates) == {"B", "C", "D"}

    # The same bytes, decoded properly, qualify.
    good = archive.admit_snapshot(raw, digest, spec, timestamp=TS_GITHUB)
    assert good.qualified is True and len(good.decoded) == 372058
    assert round(good.decoded.expansion, 2) == round(372058 / 72427.0, 2)


# ---------------------------------------------------------------------------
# Self-containment
# ---------------------------------------------------------------------------

def test_archive_module_is_stdlib_only_with_no_io():
    """Definition of done 1, checked by parsing the module rather than by reading it.

    The spliced copy runs inside a contract. An import this module does not need is an import the
    contract inherits, and an `open` call is a determinism break a reviewer can miss.
    """
    source = io.open(os.path.join(HERE, "archive.py"), encoding="utf-8").read()
    tree = ast.parse(source)

    allowed = {"base64", "hashlib", "json", "re", "zlib"}
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise AssertionError("relative import in a module that gets spliced inline")
            imported.add((node.module or "").split(".")[0])
    assert imported == allowed, "imports drifted: %s" % sorted(imported)

    banned_calls = {"open", "input", "eval", "exec", "compile", "__import__", "globals",
                    "locals", "print"}
    banned_attrs = {"urlopen", "socket", "system", "popen", "getenv", "environ", "time",
                    "now", "utcnow", "monotonic", "random", "urandom", "read_bytes",
                    "read_text", "write_bytes"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            target = node.func
            if isinstance(target, ast.Name) and target.id in banned_calls:
                raise AssertionError("archive.py calls %s()" % target.id)
            if isinstance(target, ast.Attribute) and target.attr in banned_attrs:
                raise AssertionError("archive.py calls .%s()" % target.attr)
        if isinstance(node, ast.Attribute) and node.attr in ("environ", "argv", "stdin",
                                                             "stdout", "stderr"):
            raise AssertionError("archive.py touches %s" % node.attr)

    # Module-level state must be immutable, because the spliced copy is shared by every validator.
    # Literal containers are the obvious form; `set(...)` and `dict(...)` are the form that slipped
    # through the first version of this check, and one of them was a parameter default.
    mutable_builders = {"set", "list", "dict", "bytearray"}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            if isinstance(node.value, (ast.List, ast.Dict, ast.Set)):
                if target.id not in ("_NAMED_ENTITY", "__all__"):
                    raise AssertionError("mutable module-level state: %s" % target.id)
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) \
                    and node.value.func.id in mutable_builders:
                raise AssertionError(
                    "module-level %s(): %s must be a frozenset or a tuple"
                    % (node.value.func.id, target.id))
    # And nothing mutates a module-level container. Function-local `set()` and `dict()` are fine
    # and are used in the CDX header parser; what would not be fine is mutating shared state, so
    # the check is scoped to names bound at module level rather than to the text `update`.
    module_names = set()
    for node in tree.body:
        if isinstance(node, ast.Assign):
            module_names.update(t.id for t in node.targets if isinstance(t, ast.Name))
    mutators = {"update", "setdefault", "popitem", "append", "extend", "add", "discard",
                "clear", "pop", "insert", "remove", "sort"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr in mutators \
                and isinstance(node.func.value, ast.Name) \
                and node.func.value.id in module_names:
            raise AssertionError("archive.py mutates module-level %s with .%s()"
                                 % (node.func.value.id, node.func.attr))
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, (ast.Store, ast.Del)) \
                and isinstance(node.value, ast.Name) and node.value.id in module_names:
            raise AssertionError("archive.py assigns into module-level %s" % node.value.id)
    assert isinstance(archive._QUERY_SAFE, frozenset)
    assert isinstance(archive._UNRESERVED, frozenset)


#: Exported but not named in README.md, each for a stated reason rather than by omission.
#: The five caps and thresholds are documented by VALUE in the README (4_000_000, threshold=3,
#: `365 day`, `gate_a_ratio=0.60`, `enable_gate_a=False`), which is what a reader needs; naming them
#: as well does not fit the 40 line budget. The four tag constants appear in their bracket form.
README_EXEMPT = ("CDX_WARC_LENGTH_MAX", "RAW_MAX_BYTES", "DECODED_MAX_BYTES",
                 "GATE_A_RATIO", "GATE_A_ENABLED_DEFAULT",
                 "MIN_CHANGE_POINTS", "CHANGE_POINT_WINDOW_DAYS")


def test_module_exports_what_the_readme_promises():
    """Both directions, because one direction is how the README went stale on me once already.

    Adding `cdx_window_for`, `require_timestamp_at_row_zero`, `next_cursor`,
    `has_min_change_points` and `load_anchored_window` to the module left `__all__` and the README
    both behind, and nothing failed. Now a name in one and not the other is a test failure.
    """
    import re as _re
    readme = io.open(os.path.join(HERE, "README.md"), encoding="utf-8").read()
    lines = readme.splitlines()
    assert len(lines) <= 42, \
        ("README.md is %d lines against a 42 line cap. The cap was 40 and moved once, to fit the "
         "digest classification the funded transaction forced. It is a reference card: if a change "
         "needs more room than this, the argument belongs in a docstring, not here." % len(lines))
    assert all(ord(ch) < 127 for ch in readme), "README.md is not plain ASCII"

    for name in archive.__all__:
        assert hasattr(archive, name), name

    # Every call-shaped name the README documents must be exported. Trailing `#` comments are
    # prose, not signatures, so `base32(sha1(RAW))` in a comment is not a promise of an export, and
    # a dotted name is a method on a returned object (`index.position_of`, `GateSpec(...).validate`)
    # rather than a module-level export.
    documented = set()
    for line in lines:
        if not line.startswith("    "):
            continue
        signature = line.split("#", 1)[0]
        for token in _re.findall(r"(?<![.\w])([a-z_][a-z0-9_]{3,})\(", signature):
            documented.add(token)
    params = {"fetch", "sha1", "sha256", "int", "str", "len", "bool"}
    for name in sorted(documented - params):
        assert name in archive.__all__, "README documents %s, which is not exported" % name

    # And every exported public name must appear in the README, or be exempt for a stated reason.
    missing = [n for n in archive.__all__
               if n not in README_EXEMPT and n not in readme]
    assert not missing, "exported but undocumented: %s" % ", ".join(missing)

    for name in ("parse_cdx", "cdx_digest", "classify_digest", "decode_payload", "decode_checked",
                 "qualify", "normalize_commitment", "commitment_hash", "check_warc_length",
                 "check_raw_len", "check_decoded_len", "admit_snapshot", "retrieve_snapshot",
                 "cdx_window_for", "require_timestamp_at_row_zero", "next_cursor",
                 "has_min_change_points", "load_anchored_window"):
        assert name in archive.__all__, name
    print("\n    README: %d lines, %d documented call names, %d exported"
          % (len(lines), len(documented - params), len(archive.__all__)))


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def main():
    tests = [(name, obj) for name, obj in sorted(globals().items())
             if name.startswith("test_") and callable(obj)]
    passed, failed = 0, []
    for name, test in tests:
        try:
            test()
        except Exception:                                            # noqa: BLE001
            failed.append(name)
            print("FAIL %s" % name)
            traceback.print_exc()
        else:
            passed += 1
            print("pass %s" % name)
    print("")
    print("%d passed, %d failed, %d total" % (passed, len(failed), len(tests)))
    if failed:
        print("failed: %s" % ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
