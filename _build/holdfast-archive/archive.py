"""Holdfast archive path: parse, verify, decode and structurally qualify one archived snapshot.

Standalone and stdlib-only on purpose. A GenLayer Intelligent Contract cannot import a sibling
Python file, so this module is written and unit-tested here and then spliced verbatim into
`contracts/holdfast.py` behind a drift guard. See README.md for the splice contract.

Every input arrives as a function argument. There is no clock, no filesystem, no network and no
global state. The only way bytes enter this module is through a `fetch` callable the caller
injects, and the only thing this module does with that callable is call it and inspect the
result.

Why the module exists at all, from `genlayer-prds/06-holdfast.md` section 2:

Wayback's `id_` replay mode serves the archived payload verbatim. When the origin served the page
with `Content-Encoding: gzip`, the stored payload is gzip and nothing on the replay path
decompresses it. Four major terms-of-service pages were measured stored both ways at different
times. A contract that hands those bytes to a model is handing it binary noise, and in binary
noise every commitment clause is absent, which is indistinguishable from the promisor having
deleted the clause.

The reason that is the worst failure class in the project rather than an ordinary bug: those
bytes are byte-identical for every validator. A contract in this state does not disagree and
revert. Every validator independently reads noise, independently concludes the clause is gone,
and they agree unanimously. Consensus is agreement, so consensus offers no protection at all
here. Measured outcome across five pages: 0 true positives, 8 false positives, four of the eight
caused by one missing line of decompression.

So the defence cannot live in consensus. It lives here, ahead of any prompt, in integer
arithmetic and substring tests:

  * the CDX digest is verified against the RAW bytes, before any decode, because that is what it
    is a digest of, and verifying after decoding would silently accept a corrupted payload;
  * the encoding is detected by magic bytes and decoded in a BRANCH, because most archived HTML
    is stored uncompressed and an unconditional gunzip would fail on all of it;
  * that branch is exactly two wide, `1f8b` gzip and `78` zlib, else identity. There is NO raw
    deflate branch: raw deflate has no header and no checksum, so a probe for it cannot fail
    safely, and across all eight captured payloads six are 1f8b and two are 3c21, so the branch
    would carry false-positive risk with no true positive to earn it (see `decode_payload`);
  * four structural gates ask whether the artefact is the document it claims to be, and length is
    deliberately not one of the discriminating ones. Note that the "gate A passed 4 of 4 known-bad
    snapshots" result in PRD section 2 has since been withdrawn: the four "bad" snapshots were
    faithful captures misread by an undecoded measuring script. The surviving measured reason to
    keep gate A off by default is the 2,738 against 35,689 extracted-character pair on
    cloud.google.com/terms/deprecation, where the larger figure is a chrome-inflated rebuild of
    the same unchanged policy;
  * three size caps are enforced in the order `warc length -> raw -> decoded`, cheapest first.

And the rule that outranks all of them: absence is never success. An empty index, a 403, a 429,
a redirect, a cap breach: all of these are `[EXTERNAL]`. None of them is ever "the commitment
still holds".

`decode_payload` is a deliberate PARTIAL twin of the same-named function in
`_build/harness/verify_fixtures.py`: identical on the gzip, zlib and identity branches, and
deliberately divergent in that the harness still carries a guarded raw-deflate branch and this
module does not. `test_archive.py` pins both the agreement on every captured payload and the one
divergence, so neither can drift unnoticed.
"""

import base64
import hashlib
import json
import re

import zlib

__all__ = [
    "EXPECTED", "EXTERNAL", "TRANSIENT", "LLM_ERROR",
    "CDX_WARC_LENGTH_MAX", "RAW_MAX_BYTES", "DECODED_MAX_BYTES",
    "GATE_A_RATIO", "GATE_A_ENABLED_DEFAULT",
    "MIN_CHANGE_POINTS", "CHANGE_POINT_WINDOW_DAYS",
    "Refusal", "is_refusal",
    "CdxRow", "CdxIndex", "parse_cdx", "find_timestamp", "require_timestamp",
    "require_timestamp_at_row_zero", "next_cursor", "has_min_change_points",
    "cdx_digest", "classify_digest", "DIGEST_AS_ARCHIVED", "DIGEST_TRANSPORT_DECODED",
    "sha256_hex",
    "decode_payload", "decode_checked", "Decoded", "gzip_declared_size", "magic_hex",
    "GateSpec", "Qualification", "qualify", "extract_text",
    "normalize_text", "normalize_commitment", "commitment_hash",
    "check_warc_length", "check_raw_len", "check_decoded_len",
    "is_exact_timestamp", "require_exact_timestamp",
    "cdx_query_url", "cdx_window_for", "snapshot_url",
    "response_parts", "fetch_bytes", "load_change_points", "load_anchored_window",
    "Admission", "admit_snapshot", "retrieve_snapshot", "admissibility_tuple",
]


# ---------------------------------------------------------------------------
# Refusal taxonomy (PRD section 7)
# ---------------------------------------------------------------------------

#: Bad caller input, wrong actor, wrong state. Revert, no state change.
EXPECTED = "[EXPECTED]"
#: Source unreachable: index empty, id_ non-200, 403, 429, or a size cap exceeded.
#: Reverts and leaves the bond ACTIVE. Nothing is ever inferred from absence.
EXTERNAL = "[EXTERNAL]"
#: Transport failure, digest mismatch, or an undecodable encoding. Safe to retry.
TRANSIENT = "[TRANSIENT]"
#: Malformed model output, or a cited excerpt not found verbatim in the decoded body.
#: Fails closed.
LLM_ERROR = "[LLM_ERROR]"

_TAGS = (EXPECTED, EXTERNAL, TRANSIENT, LLM_ERROR)


class Refusal(object):
    """A refusal is a value, not an exception.

    The contract turns one of these into a revert at the top of the call. Keeping it a value
    means every function here stays pure and directly testable, and the spliced copy does not
    depend on exception control flow surviving the splice.
    """

    __slots__ = ("tag", "reason", "detail")

    def __init__(self, tag, reason, detail=None):
        if tag not in _TAGS:
            raise ValueError("unknown refusal tag %r" % (tag,))
        self.tag = tag
        self.reason = reason
        self.detail = detail

    def __repr__(self):
        if self.detail is None:
            return "Refusal(%s %s)" % (self.tag, self.reason)
        return "Refusal(%s %s: %s)" % (self.tag, self.reason, self.detail)

    def __eq__(self, other):
        return (isinstance(other, Refusal) and self.tag == other.tag
                and self.reason == other.reason)

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash((self.tag, self.reason))

    @property
    def message(self):
        return repr(self)


def is_refusal(value):
    return isinstance(value, Refusal)


# ---------------------------------------------------------------------------
# Size caps (PRD section 2, "Size discipline")
# ---------------------------------------------------------------------------

#: Cap 1. CDX `length` is the COMPRESSED WARC RECORD length. It is a cheap pre-filter and it is
#: never the payload size: the worst measured understatement is 7.84x, where a declared 260,662
#: fronted a 2,044,592 byte payload.
CDX_WARC_LENGTH_MAX = 250_000

#: Cap 2. Raw payload, checked after the fetch and before anything else touches the bytes.
RAW_MAX_BYTES = 2_500_000

#: Cap 3. Decoded payload, checked before any parsing. Enforced during decompression rather
#: than after it, so a compression bomb cannot allocate its way past the check.
DECODED_MAX_BYTES = 4_000_000

#: Worst measured expansion from CDX `length` to raw payload bytes: 260,662 -> 2,044,592.
#: Exposed so callers can reason about the pre-filter, never to size an allocation.
CDX_WORST_OBSERVED_EXPANSION = 7.84

#: Wayback needs a long timeout. It fails at 30 seconds.
WAYBACK_TIMEOUT_SECONDS = 120


def check_warc_length(warc_length):
    """Cap 1. `warc_length` may be None when the index did not report an integer."""
    if warc_length is None:
        return Refusal(EXTERNAL, "cdx-length-unknown",
                       "index row carried no integer length, so the pre-filter cannot pass it")
    if warc_length < 0:
        return Refusal(EXTERNAL, "cdx-length-negative", warc_length)
    if warc_length > CDX_WARC_LENGTH_MAX:
        return Refusal(EXTERNAL, "cdx-length-cap",
                       "%d > %d" % (warc_length, CDX_WARC_LENGTH_MAX))
    return None


def check_raw_len(raw_len):
    """Cap 2."""
    if raw_len > RAW_MAX_BYTES:
        return Refusal(EXTERNAL, "raw-cap", "%d > %d" % (raw_len, RAW_MAX_BYTES))
    return None


def check_decoded_len(decoded_len):
    """Cap 3."""
    if decoded_len > DECODED_MAX_BYTES:
        return Refusal(EXTERNAL, "decoded-cap", "%d > %d" % (decoded_len, DECODED_MAX_BYTES))
    return None


# ---------------------------------------------------------------------------
# Timestamps (PRD section 2, "Only an exact timestamp resolves")
# ---------------------------------------------------------------------------

_TIMESTAMP_RE = re.compile(r"\A[0-9]{14}\Z")


def is_exact_timestamp(value):
    """True only for exactly 14 ASCII digits.

    Measured against a known capture at 20230320142124: the exact 14-digit form returns 200 and
    a digest that matches the index, while +1s, -1s, +1h, date-only and year-only all return
    302. There is no silent nearest-match substitution, which is what makes snapshot identity
    pinnable.

    Note the split this creates, because the PRD is easy to misread here. A timestamp that is
    not 14 digits is caller error and is rejected `[EXPECTED]` before any fetch. A timestamp
    that IS 14 digits but is one second off a real capture is syntactically fine, so it gets
    fetched, comes back 302, and is `[EXTERNAL]`. Both rules are in the PRD and they are about
    different stages.
    """
    return isinstance(value, str) and _TIMESTAMP_RE.match(value) is not None


def require_exact_timestamp(value):
    if not isinstance(value, str):
        return Refusal(EXPECTED, "timestamp-not-string", type(value).__name__)
    if _TIMESTAMP_RE.match(value) is None:
        return Refusal(EXPECTED, "timestamp-not-14-digit", "len=%d" % len(value))
    return None


# ---------------------------------------------------------------------------
# URL construction
# ---------------------------------------------------------------------------

CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx"
SNAPSHOT_ENDPOINT = "https://web.archive.org/web"

#: The field list the contract asks for. `statuscode` is CDX's own name for the status column.
CDX_DEFAULT_FIELDS = ("timestamp", "digest", "length")

_UNRESERVED = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~")

#: `:` and `/` are left literal inside a query value. RFC 3986 allows both there, and the offline
#: harness matches CDX routes on a pattern that spells the target path out, `cloud\.google\.com/
#: terms/deprecation` and the like. Measured: encoding the slashes made 3 of the 6 CDX fixture
#: routes miss on a query that was otherwise correct and correctly anchored, which would surface as
#: FixtureMiss rather than as a URL problem. Everything that could change how the query string
#: parses stays encoded, so `? & = # % +` and space are never passed through.
#:
#: frozenset, not set. This is module state in a module that gets spliced into a contract and run
#: by every validator, and it is the default value of a parameter. A mutable one could be edited in
#: place by anything sharing the process, and two validators encoding a URL differently is a
#: consensus failure rather than a bug in one node.
_QUERY_SAFE = frozenset(_UNRESERVED | frozenset(":/"))


def _percent_encode(value, safe=_QUERY_SAFE):
    """Deterministic percent-encoding for a query value. Uppercase hex, fixed safe set.

    Deterministic matters more than minimal here: two validators building the same query must
    build the same bytes, so the safe set is a constant in this file and never a caller's choice.
    """
    out = []
    for byte in value.encode("utf-8"):
        char = chr(byte)
        if char in safe:
            out.append(char)
        else:
            out.append("%%%02X" % byte)
    return "".join(out)


def cdx_query_url(target, from_date, to_date, limit,
                  fields=CDX_DEFAULT_FIELDS, status_filter="200", collapse="digest"):
    """Build a date-bounded, limited CDX query.

    Date bounding is mandatory rather than polite. Measured index sizes for one page: unbounded
    3,504 bytes over 55 change points, `to=20240101` 2,739 bytes over 43, and
    `from=20230101&to=20240101` 349 bytes over 5. One heavily archived page indexes 262,950
    change points, which alone would blow the payload budget.

    `collapse=digest` removes ADJACENT duplicate digests only. It is a real reduction, measured
    2,589 captures down to 1,986 change points, but it is not global deduplication and it is not
    a substitute for the bounds.

    Parameter order is fixed here so two validators building the same query build the same
    string. The harness matches CDX routes on a pattern rather than an exact URL precisely
    because this order is the contract's business.

    THIS FORM DOES NOT ANCHOR. `from_date` is whatever the caller passes, and because CDX returns
    rows oldest first, `limit=` truncates the NEWEST end of the window. A window that starts before
    the timestamp you care about can therefore exclude it. Use `cdx_window_for` for anything that
    needs a specific capture. The general form is kept for the one query that genuinely cannot be
    anchored, the trailing-365-day change point count, where there is no single pin to anchor on.
    """
    parts = [
        "output=json",
        "fl=" + ",".join(fields),
    ]
    if status_filter:
        parts.append("filter=statuscode:" + str(status_filter))
    if collapse:
        parts.append("collapse=" + str(collapse))
    if from_date:
        parts.append("from=" + str(from_date))
    if to_date:
        parts.append("to=" + str(to_date))
    parts.append("limit=" + str(int(limit)))
    parts.append("url=" + _percent_encode(target))
    return CDX_ENDPOINT + "?" + "&".join(parts)


def cdx_window_for(target, timestamp, to_date, limit,
                   fields=CDX_DEFAULT_FIELDS, status_filter="200", collapse="digest"):
    """Anchored CDX query: `from=<the exact 14-digit timestamp you care about>`.

    THIS IS THE FORM TO USE. `cdx_query_url` takes a free `from_date` and therefore lets a caller
    build a window that does not contain its own pin.

    CDX returns rows OLDEST FIRST, so `limit=` discards the NEWEST rows, not the oldest. A window
    that starts before the pin spends its whole row budget on captures older than the pin and then
    truncates before reaching it. Measured live on the GitHub terms page:

        from=20260101&to=20260901&limit=40         40 rows, 20260101..20260113, pin ABSENT
        from=20260822123203&to=20260901&limit=40    1 row, the pin, at row 0
        from=20260822123203&to=20260901&limit=5     1 row, the pin, still at row 0

    Four of the five original CDX fixtures in this project did not contain the timestamp their
    paired snapshot names, for exactly this reason.

    `from=` with a full 14-digit timestamp is INCLUSIVE of the row at that instant and places it at
    index 0, and it stays at index 0 as the limit shrinks. So anchoring is what makes
    `require_timestamp_at_row_zero` a usable check rather than a coin toss.

    The pin must be an exact timestamp, because an inexact one cannot anchor anything.
    """
    bad = require_exact_timestamp(timestamp)
    if bad is not None:
        return bad
    return cdx_query_url(target, timestamp, to_date, limit,
                         fields=fields, status_filter=status_filter, collapse=collapse)


def snapshot_url(timestamp, target):
    """`id_` replay URL. The `id_` suffix is load-bearing.

    It returns the archived bytes with no Wayback rewriting, no injected toolbar and no URL
    substitution, which is the only reason a content digest is reproducible inside consensus.
    Without `id_` every validator would hash a page that Wayback rewrote on the way out.
    """
    return "%s/%sid_/%s" % (SNAPSHOT_ENDPOINT, timestamp, target)


# ---------------------------------------------------------------------------
# 1. CDX row parsing
# ---------------------------------------------------------------------------

class CdxRow(object):
    """One change point.

    `warc_length` is deliberately not called `length`. CDX's `length` field is the compressed
    WARC record length and using it as a payload size is a measured 7.84x error.
    """

    __slots__ = ("timestamp", "digest", "warc_length", "status", "mimetype", "cells")

    def __init__(self, timestamp, digest, warc_length, status, mimetype, cells):
        self.timestamp = timestamp
        self.digest = digest
        self.warc_length = warc_length
        self.status = status
        self.mimetype = mimetype
        self.cells = tuple(cells)

    @property
    def exact(self):
        return is_exact_timestamp(self.timestamp)

    def __repr__(self):
        return "CdxRow(%s digest=%s warc_length=%r status=%r)" % (
            self.timestamp, self.digest, self.warc_length, self.status)


class CdxIndex(object):
    """A parsed, non-empty CDX response.

    `requested_limit` is carried so `saturated` can be answered. A caller that parses a body
    without saying what limit produced it gets `saturated is None`, meaning unknown, which is
    honest rather than a guess in either direction.
    """

    __slots__ = ("rows", "fields", "body_len", "requested_limit")

    def __init__(self, rows, fields, body_len, requested_limit=None):
        self.rows = tuple(rows)
        self.fields = tuple(fields)
        self.body_len = body_len
        self.requested_limit = requested_limit

    def __len__(self):
        return len(self.rows)

    def __iter__(self):
        return iter(self.rows)

    @property
    def change_points(self):
        """The row count. A count of TRANSITIONS, not of distinct document states.

        `collapse=digest` collapses adjacent runs only, so an oscillating page contributes a row
        per flip. Measured in cdx-openai-tou-2024.json: 200 rows carrying 173 distinct digests,
        one digest appearing three times at positions 6, 8 and 12.
        """
        return len(self.rows)

    @property
    def oldest_first(self):
        """Rows sorted by timestamp ascending. Cursor walking is oldest first.

        CDX already returns rows oldest first. This is here so nothing depends on that promise.
        """
        return tuple(sorted(self.rows, key=lambda row: row.timestamp))

    @property
    def oldest(self):
        return self.rows[0]

    @property
    def newest(self):
        """The NEWEST ROW EXAMINED, which is not the newest capture that exists.

        `limit=` truncates the newest end of the window, so this is the boundary of what was
        actually seen and it is the only defensible cursor value.
        """
        return self.oldest_first[-1]

    @property
    def saturated(self):
        """True when the row count reached the requested limit, so the window was truncated.

        NOT an error, and deliberately not a Refusal. A saturated window means the next check has
        work waiting. Treating it as a failure would break bonds on exactly the pages that are
        archived most often: two of the six CDX fixtures here saturate at 200 rows, and one of
        them spans 78 days at 2.56 change points a day.
        """
        if self.requested_limit is None:
            return None
        return len(self.rows) >= int(self.requested_limit)

    def position_of(self, timestamp):
        """Row index of `timestamp`, or None. Position is evidence, not decoration.

        A hit at row 0 proves the window was anchored at that instant. A hit anywhere else means
        the window started earlier and the rows above it are older captures, so the newest end was
        truncated and the timestamp being sought may not be the only thing missing.
        """
        for position, row in enumerate(self.oldest_first):
            if row.timestamp == timestamp:
                return position
        return None

    def median_warc_length(self):
        """Median compressed WARC record length. Returns a FLOAT on an even row count.

        A gate A input and a diagnostic, never a consensus value. See `admissibility_tuple`.
        """
        known = sorted(r.warc_length for r in self.rows if r.warc_length is not None)
        if not known:
            return None
        middle = len(known) // 2
        if len(known) % 2:
            return known[middle]
        return (known[middle - 1] + known[middle]) / 2.0

    def __repr__(self):
        return "CdxIndex(%d rows, %d body bytes, limit=%r, saturated=%r)" % (
            len(self.rows), self.body_len, self.requested_limit, self.saturated)


#: Aliases for the status column, because CDX calls it `statuscode` and callers say `status`.
_STATUS_KEYS = ("statuscode", "status", "statusCode")
_MIME_KEYS = ("mimetype", "mime", "mimeType")


def parse_cdx(body, requested_limit=None):
    """Parse a CDX `output=json` response into a `CdxIndex`, or refuse.

    The single most dangerous response in this whole data path is handled here. A URL that was
    never archived answers **HTTP 200 with a 3-byte `[]` body**, not a 404. A naive read sees a
    success status and zero change points and concludes "nothing changed", which is exactly
    backwards: it is a successful HTTP call carrying no data. It refuses `[EXTERNAL]` with
    reason `cdx-empty`, and there is no code path in this module by which an empty index can
    become a statement about the commitment.

    A header-only response is the same thing wearing a hat, and refuses the same way.

    Columns are resolved by NAME from the header row rather than by position, so the contract
    can change its `fl=` list without silently reading the digest out of the length column.

    Pass `requested_limit` to make `CdxIndex.saturated` answerable. Without it saturation is None,
    meaning unknown, and a caller that needs to know whether the newest end of the window was
    truncated has to supply the limit it asked for.
    """
    if body is None:
        return Refusal(EXTERNAL, "cdx-no-body")
    if isinstance(body, (bytes, bytearray)):
        body_len = len(body)
        try:
            text = bytes(body).decode("utf-8")
        except UnicodeDecodeError as error:
            return Refusal(EXTERNAL, "cdx-not-utf8", str(error))
    elif isinstance(body, str):
        text = body
        body_len = len(body.encode("utf-8"))
    else:
        return Refusal(EXTERNAL, "cdx-body-type", type(body).__name__)

    try:
        data = json.loads(text)
    except ValueError as error:
        # An index that answers with something other than JSON has not answered. Classified
        # [EXTERNAL] rather than [TRANSIENT] because the transport succeeded; the source did
        # not deliver an index. The PRD does not name this case, so it is documented here.
        return Refusal(EXTERNAL, "cdx-not-json", str(error))

    if not isinstance(data, list):
        return Refusal(EXTERNAL, "cdx-not-array", type(data).__name__)
    if not data:
        return Refusal(EXTERNAL, "cdx-empty",
                       "200 with a %d byte body and zero change points; this is absence of "
                       "data, never absence of change" % body_len)

    first = data[0]
    if not isinstance(first, list):
        return Refusal(EXTERNAL, "cdx-row-not-array", type(first).__name__)

    known = set(("timestamp", "digest", "length", "original", "urlkey"))
    known.update(_STATUS_KEYS)
    known.update(_MIME_KEYS)
    header_present = all(isinstance(c, str) for c in first) and bool(
        known.intersection(first))
    if header_present:
        fields = [str(c) for c in first]
        data_rows = data[1:]
    else:
        fields = list(CDX_DEFAULT_FIELDS)
        data_rows = data

    if not data_rows:
        return Refusal(EXTERNAL, "cdx-no-rows",
                       "header row only, zero change points")

    index_of = {}
    for position, name in enumerate(fields):
        index_of.setdefault(name, position)

    def cell(cells, names):
        for name in names:
            position = index_of.get(name)
            if position is not None and position < len(cells):
                return cells[position]
        return None

    rows = []
    for number, cells in enumerate(data_rows):
        if not isinstance(cells, list):
            return Refusal(EXTERNAL, "cdx-row-not-array", "row %d" % number)
        timestamp = cell(cells, ("timestamp",))
        digest = cell(cells, ("digest",))
        raw_length = cell(cells, ("length",))
        rows.append(CdxRow(
            timestamp=None if timestamp is None else str(timestamp),
            digest=None if digest is None else str(digest),
            warc_length=_as_int(raw_length),
            status=_as_text(cell(cells, _STATUS_KEYS)),
            mimetype=_as_text(cell(cells, _MIME_KEYS)),
            cells=cells,
        ))
    return CdxIndex(rows, fields, body_len, requested_limit)


def _as_int(value):
    """CDX sometimes reports `-` for a length, on revisit records.

    That is not fatal and it is not a parse failure. The row survives with `warc_length=None`,
    which cap 1 then refuses, so the change point is skippable rather than poisonous. The PRD
    does not specify this case; the conservative reading is taken.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_text(value):
    return None if value is None else str(value)


def find_timestamp(index, timestamp):
    for row in index.rows:
        if row.timestamp == timestamp:
            return row
    return None


def require_timestamp(index, timestamp):
    """Membership of the requested timestamp in the returned rows, as PRD section 6 requires.

    A baseline the index does not list is caller error, so `[EXPECTED]`, and it is caught before
    a single wei is escrowed.

    A searched hit in a truncated list is luck. Prefer `require_timestamp_at_row_zero` when the
    window was built by `cdx_window_for`, because there a hit at row 0 is proof of anchoring.
    """
    bad = require_exact_timestamp(timestamp)
    if bad is not None:
        return bad
    row = find_timestamp(index, timestamp)
    if row is None:
        return Refusal(EXPECTED, "timestamp-not-in-index",
                       "%s absent from %d change point(s)" % (timestamp, len(index)))
    return row


def require_timestamp_at_row_zero(index, timestamp):
    """Strict form: the timestamp must be the OLDEST row in the window.

    `cdx_window_for` sets `from=` to the pin, and CDX includes the row at that exact instant and
    puts it first. So row 0 is a positive check that the window was anchored, where a search hit
    anywhere in the list is only a check that the pin happened to survive truncation.

    The two failures are reported differently on purpose, and the distinction is the whole point:

        cdx-timestamp-not-in-index    the archive really does not list this capture
        cdx-window-not-anchored       the capture is right there at row N, and the window was
                                      built starting earlier, so the newest end was truncated

    Reporting the second as the first is the hazard. It would read as "the archive does not have
    your timestamp" about a snapshot sitting in the response being examined, and the operator would
    go looking for a missing capture instead of a malformed query.
    """
    bad = require_exact_timestamp(timestamp)
    if bad is not None:
        return bad
    position = index.position_of(timestamp)
    if position is None:
        return Refusal(EXPECTED, "cdx-timestamp-not-in-index",
                       "%s absent from %d change point(s)" % (timestamp, len(index)))
    if position != 0:
        return Refusal(EXPECTED, "cdx-window-not-anchored",
                       "%s is present at row %d of %d, not row 0; the window was not anchored "
                       "with from=%s, so the newest end of it was truncated"
                       % (timestamp, position, len(index), timestamp))
    return index.oldest_first[0]


def next_cursor(index):
    """The cursor for the next check: the timestamp of the NEWEST ROW EXAMINED.

    Never a wall clock reading, and never the window's `to=` bound. This is the rule that moves
    money, so the reasoning is recorded in full.

    A cursor only moves forward. `limit=` truncates the newest end of the window. So a check that
    fetched a saturated window and then set the cursor to "now" would skip every change point
    between the last row it read and the moment it ran, permanently and silently, and those are
    precisely the change points a bond exists to catch.

    Measured: cloud.google.com/terms anchored at its pin with limit=200 returned a full 200 rows
    spanning 78 days, about 2.56 change points a day. Setting the cursor past that window would
    discard the unread remainder of the page's history.

    Setting the cursor to the newest row examined leaves the unread tail for the next check, which
    then re-anchors on it and continues. Overlap of one row is cheap; a gap is unrecoverable.
    """
    return index.newest.timestamp


#: PRD section 5: a page must show at least this many change points in the trailing window to be
#: eligible, so the archive is demonstrably watching it.
MIN_CHANGE_POINTS = 3

#: The trailing window that count is taken over.
CHANGE_POINT_WINDOW_DAYS = 365


def has_min_change_points(index, threshold=MIN_CHANGE_POINTS, requested_limit=None):
    """Does the trailing window show at least `threshold` change points?

    This is the one query that cannot be anchored: it asks about a whole trailing period rather
    than about one capture, so there is no pin to put in `from=`.

    Truncation is safe here in one direction only. `limit=` discards the newest rows, so a
    truncated window can only UNDERCOUNT, never overcount. A truncated response that already shows
    `threshold` rows has therefore satisfied the rule and no further paging is needed.

    That safety collapses if `limit <= threshold`, because then the limit caps the count at exactly
    the number being tested and every sufficiently archived page returns exactly `threshold`. The
    test would pass by construction and stop measuring anything. So the limit is checked here
    rather than trusted, and `limit == threshold` is refused as loudly as a smaller one.
    """
    limit = requested_limit if requested_limit is not None else index.requested_limit
    if limit is None:
        return Refusal(EXPECTED, "change-point-limit-unknown",
                       "cannot judge a count without the limit that produced it")
    if int(limit) <= int(threshold):
        return Refusal(EXPECTED, "change-point-limit-too-low",
                       "limit=%d caps the count at the threshold %d being tested, so the check "
                       "would pass by construction; use limit > %d"
                       % (int(limit), int(threshold), int(threshold)))
    return index.change_points >= int(threshold)


# ---------------------------------------------------------------------------
# 2. Digest verification
# ---------------------------------------------------------------------------

def cdx_digest(raw):
    """base32(sha1(raw)). The CDX `digest` field, recomputed.

    Verified 6 of 6 exact matches in a dedicated probe across snapshots from 2015 to 2026,
    including payloads of 27,948, 61,152 and 2,044,592 bytes, and it held on every subsequent
    fetch in four further probes.

    IT IS NOT AN INTEGRITY CHECK OVER A NETWORK FETCH, AND THE ORIGINAL VERSION OF THIS DOCSTRING
    CLAIMING IT WAS COST A FUNDED TRANSACTION. It said the digest "converts one source into two
    independent confirmations" and that computing it over the raw payload "is not reorderable".
    Both sentences are true only for a client that is handed the bytes as stored. GenVM's transport
    decompresses first, so on chain the argument to this function is the inflated body and the
    column is a hash of something the contract never holds. See `classify_digest`, which is where
    that measurement now lives, and which keeps the comparison only in the case where it can fail
    for the right reason.

    What the column IS good for, and what it is used for here: it is `collapse=digest`'s notion of
    identity, so two index rows with the same digest are the same version of the page. That makes it
    a version label, and the change-point walk is built on exactly that property.
    """
    return base64.b32encode(hashlib.sha1(raw).digest()).decode("ascii")


DIGEST_AS_ARCHIVED = "as-archived"
DIGEST_TRANSPORT_DECODED = "transport-decoded"


def classify_digest(raw, expected):
    """Is the index's digest checkable against the bytes in hand, and does it check out?

    THIS FUNCTION USED TO BE `verify_digest` AND IT USED TO REFUSE UNCONDITIONALLY. That cost a
    funded transaction, and the reason is worth stating precisely because the old code was correct
    about everything except one fact it could not see.

    The CDX `digest` column is base32(sha1(bytes as stored in the WARC)). For a capture the archive
    stored compressed, that is a hash of a gzip stream. The contract's transport, GenVM's
    `gl.nondet.web.request`, transparently undoes `Content-Encoding: gzip` before Python is handed
    the body, and no request header prevents it: measured three times against the same URL with no
    `Accept-Encoding`, with `identity`, and with `gzip`, Wayback replayed the archived gzip verbatim
    and declared `Content-Encoding: gzip` every time, so a conforming client always decompresses.
    Live proof, transaction 0xc3a12dd2:

        Refusal([TRANSIENT] digest-mismatch: want ORCARP7HGOXUBBYK4LXACZM7GU5ZBMMY
                got RH5GAEIT25NBEQBWYIY7FK4KM7ZRDRNR over 819751 raw bytes)

    where 819751 and RH5GAEIT are exactly `len(gzip.decompress(archived))` and
    `base32(sha1(gzip.decompress(archived)))`. Nothing was wrong with the capture. The digest was
    simply of bytes the contract is never given.

    SO THE CHECK IS KEPT EXACTLY WHERE IT REMAINS SOUND, AND NOWHERE ELSE:

      * bytes in hand start 1f8b  ->  the transport did not decompress, so the digest is over
                                      precisely these bytes. Checkable. A mismatch here is real
                                      and still refuses [TRANSIENT].
      * digest agrees             ->  `as-archived`. Definitive, whatever the encoding: agreement
                                      cannot happen by accident over sha1.
      * otherwise                 ->  `transport-decoded`. NOT a refusal, and not a pass either.

    Why the third case cannot be an integrity gate, stated plainly so no future edit restores one:
    once the bytes arrive plain and disagree, "the transport inflated a compressed record" and "the
    archive served a different payload than the index listed" are the same observation. Both give
    plain bytes, a mismatched digest, and a payload larger than the index's length column. There is
    no third measurement that separates them, because the only hash of the stored record is the one
    that just failed. A gate that cannot fail for the right reason is not a gate.

    WHAT CARRIES INTEGRITY INSTEAD. `Admission.decoded_sha256`, over the decoded body, pinned at
    baseline and required to reproduce on every later read of the same timestamp. That is a
    stronger property than the digest ever supplied here: the digest could only confirm that the
    archive agreed with itself within a single call, while the pin makes every re-read of a capture
    answerable to what the bond was opened against. A capture is immutable, so a changed pin means
    the replay changed, and that is worth a refusal.
    """
    if not expected:
        return Refusal(EXPECTED, "digest-missing", "no expected digest supplied")
    actual = cdx_digest(raw)
    want = str(expected).strip().upper()
    if actual == want:
        return DIGEST_AS_ARCHIVED
    if raw[:2] == b"\x1f\x8b":
        return Refusal(TRANSIENT, "digest-mismatch",
                       "want %s got %s over %d stored bytes" % (want, actual, len(raw)))
    return DIGEST_TRANSPORT_DECODED


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# 3. Magic-byte decode
# ---------------------------------------------------------------------------

_GZIP_WBITS = 16 + zlib.MAX_WBITS
_ZLIB_WBITS = zlib.MAX_WBITS
# There is deliberately no -zlib.MAX_WBITS constant here. Its absence is the guard: a raw-deflate
# window size is the only thing a future edit would need to reintroduce the branch, so not having
# it means the branch cannot come back by accident.
_INFLATE_CHUNK = 262144


def magic_hex(raw, count=2):
    if len(raw) < count:
        return "??"
    return bytes(raw[:count]).hex()


def gzip_declared_size(raw):
    """The gzip ISIZE trailer: uncompressed size mod 2**32, little endian.

    DIAGNOSTIC ONLY. This value must never gate a decision, in either direction.

    It cannot accept, because it is mod 2**32, it covers a single member, and it is
    attacker-controlled, so a small declared size proves nothing.

    It cannot reject either, which is less obvious and was a real bug in an earlier draft of this
    module. ISIZE is the last four bytes of the MEMBER, not of the input, and `zlib.decompress`
    ignores trailing bytes after a complete member. So a payload with junk appended decodes
    perfectly while `raw[-4:]` reads nonsense. Measured locally: a valid gzip member with b"XYZ"
    appended declared 1,515,804,672 bytes. A truncated member misreads it the same way.

    The real enforcement is the bounded inflate in `_inflate_capped`, which stops allocating the
    moment cap 3 is crossed. Verified locally: a 5,000,000 byte payload compresses to 4,892 bytes
    and declares 5000000, and the bounded loop stops at 4,194,304 bytes after 16 rounds.
    """
    if len(raw) < 4:
        return None
    return int.from_bytes(bytes(raw[-4:]), "little")


def decode_payload(raw):
    """Deterministic magic-byte decode. Returns `(bytes, encoding)`. Exactly two branches.

        1f8b  ->  gzip
        78    ->  zlib
        else  ->  identity

    THERE IS NO RAW DEFLATE BRANCH, AND ITS ABSENCE IS THE POINT. Do not add one.

    A raw deflate stream has no header and no checksum, so `zlib.decompress(raw, -MAX_WBITS)`
    inside a bare `except zlib.error` is not a safe probe: there is nothing for it to fail on, and
    any byte whose low bits happen to encode a plausible block header starts a "valid" stream.
    Measured locally, both of these SUCCEED and neither raises:

        {\\n  + filler, total 71,095 B  ->  1 byte out, eof=True,  71,092 B unused_data
        []    a never-archived response ->  1 byte out, eof=False,      0 B unused_data

    No single structural guard catches both. `eof` is True for the first and False for the second;
    `unused_data` is huge for the first and empty for the second. An earlier draft of this module
    carried three guards (eof, empty unused_data, output larger than input) and they did hold
    against both shapes, but they are only heuristics, and the third is a bare domain assumption.

    The branch was removed because it buys nothing measurable and risks the worst failure mode in
    the project. Measured across all eight captured payloads: six are 1f8b and two are 3c21. Not
    one is raw deflate, so the branch has no true positive to earn its keep. Against that, a false
    positive returns plausible-looking bytes rather than raising, every validator computes the same
    wrong bytes from the same input, and they agree unanimously on a document that does not exist.

    The cost of removing it is bounded and safe in the other direction: if Wayback ever does serve
    a bare deflate body, it falls to identity, the gates see binary noise, and the snapshot is
    REJECTED. A rejection is a skip, never a loss. That is the trade this build takes.

    This function raises `zlib.error` on a corrupt wrapper. Contract code should call
    `decode_checked`, which enforces cap 3 during inflation and converts failure into a `Refusal`.
    """
    if len(raw) >= 2 and raw[0] == 0x1F and raw[1] == 0x8B:
        return zlib.decompress(raw, _GZIP_WBITS), "gzip"
    if len(raw) >= 1 and raw[0] == 0x78:
        return zlib.decompress(raw), "zlib"
    return raw, "identity"


class Decoded(object):
    __slots__ = ("data", "encoding", "magic", "raw_len", "declared")

    def __init__(self, data, encoding, magic, raw_len, declared=None):
        self.data = data
        self.encoding = encoding
        self.magic = magic
        self.raw_len = raw_len
        self.declared = declared

    def __len__(self):
        return len(self.data)

    @property
    def expansion(self):
        if not self.raw_len:
            return None
        return len(self.data) / float(self.raw_len)

    def __repr__(self):
        return "Decoded(%s %d -> %d bytes, magic %s)" % (
            self.encoding, self.raw_len, len(self.data), self.magic)


def _inflate_capped(raw, wbits, cap):
    """Inflate with a hard output ceiling. Returns `(bytes, None)` or `(None, reason)`.

    Bounded rather than `zlib.decompress`, because a 2,500,000 byte deflate stream can expand
    past a gigabyte and cap 3 checked after the fact is not a cap at all.
    """
    obj = zlib.decompressobj(wbits)
    out = bytearray()
    data = raw
    while True:
        try:
            piece = obj.decompress(data, _INFLATE_CHUNK)
        except zlib.error as error:
            return None, "inflate-error: %s" % (error,)
        out.extend(piece)
        if len(out) > cap:
            return None, "over-cap"
        if obj.eof:
            break
        data = obj.unconsumed_tail
        if not data:
            # All input consumed and the stream never declared its own end.
            try:
                out.extend(obj.flush())
            except zlib.error as error:
                return None, "inflate-error: %s" % (error,)
            if len(out) > cap:
                return None, "over-cap"
            if not obj.eof:
                return None, "truncated-stream"
            break
    return bytes(out), None


def decode_checked(raw, cap=DECODED_MAX_BYTES):
    """Cap-enforcing decode. Returns a `Decoded` or a `Refusal`.

    Same branch order and same three guards as `decode_payload`. The differences, both
    deliberate:

      * cap 3 is enforced DURING inflation, so an over-cap payload refuses `[EXTERNAL]`
        `decoded-cap` without ever being fully materialised;
      * a corrupt or truncated wrapper refuses `[TRANSIENT]` `undecodable` instead of raising,
        because "encoding undecodable" is a named `[TRANSIENT]` in the PRD refusal table.

    Trailing bytes after a complete gzip or zlib member are ignored, which matches
    `zlib.decompress` and therefore matches the reference twin. Verified locally: appending
    b"\\x00", b"XYZ" or b"\\n" to a valid gzip member changes nothing about the output.
    """
    if raw is None:
        return Refusal(EXTERNAL, "no-payload")
    raw = bytes(raw)
    magic = magic_hex(raw)

    if len(raw) >= 2 and raw[0] == 0x1F and raw[1] == 0x8B:
        # The gzip ISIZE trailer is deliberately NOT consulted as a rejection here, and this is
        # a corrected bug rather than an omission. ISIZE lives in the LAST FOUR BYTES OF THE
        # MEMBER, not of the input. `zlib.decompress` ignores anything after a complete member,
        # so a payload with trailing bytes still decodes correctly, but `raw[-4:]` then reads
        # junk. Measured locally: a valid gzip member with b"XYZ" appended read a declared size
        # of 1,515,804,672 and was refused `decoded-cap` even though it decodes to 372,058
        # bytes. A truncated member misreads the trailer the same way and refused `decoded-cap`
        # instead of the correct `undecodable`. Both are false rejections, and a false rejection
        # on this path is a bond that cannot be settled.
        #
        # Skipping the pre-check costs nothing that matters. `_inflate_capped` enforces cap 3
        # DURING inflation, so an over-cap payload still refuses without being materialised: the
        # 5,000,000 byte bomb stops at 4,194,304 bytes after 16 rounds. The trailer is recorded
        # on the result as a diagnostic and is never trusted.
        out, problem = _inflate_capped(raw, _GZIP_WBITS, cap)
        if problem == "over-cap":
            return Refusal(EXTERNAL, "decoded-cap", "gzip stream exceeded %d" % cap)
        if problem is not None:
            return Refusal(TRANSIENT, "undecodable", "gzip: %s" % problem)
        return Decoded(out, "gzip", magic, len(raw), gzip_declared_size(raw))

    if len(raw) >= 1 and raw[0] == 0x78:
        out, problem = _inflate_capped(raw, _ZLIB_WBITS, cap)
        if problem == "over-cap":
            return Refusal(EXTERNAL, "decoded-cap", "zlib stream exceeded %d" % cap)
        if problem is not None:
            return Refusal(TRANSIENT, "undecodable", "zlib: %s" % problem)
        return Decoded(out, "zlib", magic, len(raw), None)

    # No raw-deflate branch. See `decode_payload` for the measurement that removed it: across all
    # eight captured payloads, six are 1f8b and two are 3c21, and none is raw deflate, so the
    # branch had no true positive to justify its false-positive risk. Anything that is not a gzip
    # or zlib wrapper is served as-is.
    over = Refusal(EXTERNAL, "decoded-cap", "%d > %d" % (len(raw), cap)) \
        if len(raw) > cap else None
    if over is not None:
        return over
    return Decoded(raw, "identity", magic, len(raw), None)


# ---------------------------------------------------------------------------
# 5. Commitment normalization
# ---------------------------------------------------------------------------

_WHITESPACE_RUN = re.compile(r"\s+")
_OUTSIDE_ALPHABET = re.compile(r"[^a-z0-9 ]+")


def normalize_text(value):
    """The fixed, reproducible normalization. Four steps, in this order, and nothing else.

      1. lowercase;
      2. collapse every whitespace run to a single space;
      3. strip everything outside `[a-z0-9 ]`;
      4. trim.

    The order is the specification, not an implementation detail, and step 3 after step 2 has two
    visible consequences, both measured locally and both pinned by tests.

    First, a stripped character between two WORDS joins them, so "gzip/deflate" normalizes to
    "gzipdeflate" and "co-operate" to "cooperate".

    Second, and less obvious: a stripped character between two SPACES leaves both spaces behind,
    and step 2 has already run so nothing re-collapses them. "a - b" normalizes to "a  b" with two
    spaces, and "30 EUR / (c) 2026" to "30 eur  c 2026". THIS FUNCTION IS THEREFORE NOT
    IDEMPOTENT: a second pass collapses the gap and yields a different string, so
    `commitment_hash(normalize(s))` is not `commitment_hash(s)`.

    The rule that keeps that harmless: hash the caller's ORIGINAL string exactly once, at bond
    creation, and compare against the stored hash forever after. Never normalize defensively on
    the way in. Reordering to collapse last would be a better normalizer and a breaking change to
    every commitment hash already recorded, so the order stays as pinned.
    """
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    lowered = value.lower()
    collapsed = _WHITESPACE_RUN.sub(" ", lowered)
    stripped = _OUTSIDE_ALPHABET.sub("", collapsed)
    return stripped.strip()


def normalize_commitment(commitment):
    """`Bond.commitment_norm`. Identical to `normalize_text`, named for the storage field."""
    return normalize_text(commitment)


def commitment_hash(commitment):
    """`Bond.commitment_hash`: sha256 hex of the normalized form, never of the raw words."""
    return sha256_hex(normalize_commitment(commitment))


# ---------------------------------------------------------------------------
# Text extraction (PRD section 6 lists this as deterministic)
# ---------------------------------------------------------------------------

_DROP_ELEMENTS = re.compile(
    r"<(script|style|noscript|template|svg)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL)
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG = re.compile(r"<[^>]*>", re.DOTALL)
_NAMED_ENTITY = {
    "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'",
    "nbsp": " ", "mdash": "-", "ndash": "-", "hellip": "...",
    "lsquo": "'", "rsquo": "'", "ldquo": '"', "rdquo": '"',
    "copy": "(c)", "reg": "(r)", "trade": "(tm)", "middot": "-",
}
_ENTITY = re.compile(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")


def _unescape(text):
    """Hand-rolled entity unescaping over a fixed table plus numeric references.

    Deliberately not `html.unescape`. The spliced copy runs inside GenVM and a fixed table of
    seventeen entities plus the numeric forms is auditable and cannot shift under it. An unknown
    named entity is left exactly as written, so nothing is invented.
    """
    def replace(match):
        body = match.group(1)
        if body[0] == "#":
            try:
                if body[1] in "xX":
                    code = int(body[2:], 16)
                else:
                    code = int(body[1:], 10)
            except (ValueError, IndexError):
                return match.group(0)
            if 0 < code < 0x110000:
                try:
                    return chr(code)
                except ValueError:
                    return match.group(0)
            return match.group(0)
        replacement = _NAMED_ENTITY.get(body.lower())
        return replacement if replacement is not None else match.group(0)
    return _ENTITY.sub(replace, text)


def extract_text(decoded):
    """Decoded bytes to collapsed plain text. Deterministic, lossy, and only ever a gate input.

    `errors="replace"` rather than a strict decode, because a mojibake page is still a document
    and the gates are the right place to reject it. A UnicodeDecodeError here would be a
    `[TRANSIENT]` on a page that is merely badly encoded.
    """
    if isinstance(decoded, Decoded):
        decoded = decoded.data
    if isinstance(decoded, (bytes, bytearray)):
        text = bytes(decoded).decode("utf-8", "replace")
    else:
        text = decoded or ""
    text = _COMMENT.sub(" ", text)
    text = _DROP_ELEMENTS.sub(" ", text)
    text = _TAG.sub(" ", text)
    text = _unescape(text)
    return _WHITESPACE_RUN.sub(" ", text).strip()


# ---------------------------------------------------------------------------
# 4. The four gates
# ---------------------------------------------------------------------------

#: Gate A qualifies at `len(text) >= 0.60 * median(text)` across the URL's own change points.
GATE_A_RATIO = 0.60

#: Gate A is DISABLED BY DEFAULT and this is the single most counter-intuitive constant here.
#:
#: The reason is one measured pair, and only that pair. cloud.google.com/terms/deprecation went
#: from 2,738 to 35,689 extracted characters, a 13x inflation, with no policy change whatsoever;
#: the larger capture is an SPA chrome rebuild of the same unchanged text. A length floor on that
#: page rejects the faithful capture and admits the inflated one, which is worse than having no
#: gate. So gate A stays in the code, off, with a ratio bucket exported into the admissibility
#: tuple, so it can be studied without being trusted.
#:
#: WITHDRAWN, and left here because a deleted claim is harder to audit than a corrected one: an
#: earlier version of this comment said gate A "passed 4 of 4 known-bad snapshots" while B, C and
#: D "each caught 4 of 4". That result was an artefact of the measuring script, which fetched the
#: `id_` replay and never decompressed it, so four faithful gzip captures were scored as binary
#: noise. All four flip to QUALIFIED on decompression alone. The tell was in the result itself:
#: "every bad snapshot scored 0 of N sections" is what compressed bytes score, not what a
#: deficient page scores. Gates B, C and D therefore have NO measured true positive. They are
#: retained as a fail-closed structural safeguard, justified by the argument in the module header
#: rather than by data, and the honest statement of their strength is that every payload captured
#: for this project qualifies once it is decoded.
GATE_A_ENABLED_DEFAULT = False


class GateSpec(object):
    """What the document must structurally contain. Pinned per bond at creation.

    Validated against the baseline before any funds are locked, which is what stops a promisor
    choosing anchors that make the gate permanently unpassable.
    """

    __slots__ = ("anchor", "sections", "terminal", "enable_gate_a", "gate_a_ratio")

    def __init__(self, anchor, sections, terminal,
                 enable_gate_a=GATE_A_ENABLED_DEFAULT, gate_a_ratio=GATE_A_RATIO):
        self.anchor = anchor
        self.sections = tuple(sections or ())
        self.terminal = terminal
        self.enable_gate_a = bool(enable_gate_a)
        self.gate_a_ratio = float(gate_a_ratio)

    def validate(self):
        """Reject a spec that cannot discriminate, before it is stored.

        The floor of two sections is the important one. Gate C requires N-1 of N, so a
        single-section spec has a floor of zero and passes on any document at all, which is a
        gate-shaped hole rather than a gate.
        """
        if not normalize_text(self.anchor):
            return Refusal(EXPECTED, "gate-spec-anchor", "anchor normalizes to empty")
        if len(self.sections) < 2:
            return Refusal(EXPECTED, "gate-spec-sections",
                           "%d section(s); N-1 of N needs N >= 2 to discriminate"
                           % len(self.sections))
        if len(self.sections) > 12:
            return Refusal(EXPECTED, "gate-spec-sections", "%d > 12" % len(self.sections))
        for section in self.sections:
            normalized = normalize_text(section)
            if not (3 <= len(normalized) <= 64):
                return Refusal(EXPECTED, "gate-spec-section-length", repr(section))
        normalized = [normalize_text(s) for s in self.sections]
        if len(set(normalized)) != len(normalized):
            return Refusal(EXPECTED, "gate-spec-duplicate-section")
        if not normalize_text(self.terminal):
            return Refusal(EXPECTED, "gate-spec-terminal", "terminal normalizes to empty")

        # Gate D independence, PRD section 5. The terminal marker must be independent of every
        # other gate input, in BOTH directions, by equality or by substring.
        #
        # This exists because the declared markers for two of the four measured pages were
        # degenerate. AWS's terminal marker was "service terms", the same string as its anchor.
        # GCP's was "definitions", one of its own section words. On those pages gate D could not
        # fail unless B or C had already failed, so it contributed nothing and the composite was
        # three gates wearing four names. A gate that cannot fail independently is not a gate.
        terminal = normalize_text(self.terminal)
        anchor = normalize_text(self.anchor)
        if terminal in anchor or anchor in terminal:
            return Refusal(EXPECTED, "gate-spec-terminal-not-independent",
                           "terminal %r overlaps anchor %r" % (self.terminal, self.anchor))
        for section in self.sections:
            other = normalize_text(section)
            if terminal in other or other in terminal:
                return Refusal(EXPECTED, "gate-spec-terminal-not-independent",
                               "terminal %r overlaps section %r" % (self.terminal, section))
        return None

    def __repr__(self):
        return "GateSpec(anchor=%r, %d sections, gate_a=%s)" % (
            self.anchor, len(self.sections), self.enable_gate_a)


class Qualification(object):
    """The verdict, and enough arithmetic to explain it.

    A snapshot that fails is SKIPPED, never counted as a loss of the commitment. That single
    rule is the difference between this working and being a random number generator pointed at
    an escrow, so `qualified` is the only field the state machine may branch on for a payout,
    and `failed_gates` exists to be recorded.
    """

    __slots__ = ("gate_a", "gate_a_ratio", "gate_b", "gate_c", "gate_c_hits",
                 "gate_c_total", "gate_d", "qualified", "text_len", "decoded_len")

    def __init__(self, gate_a, gate_a_ratio, gate_b, gate_c, gate_c_hits, gate_c_total,
                 gate_d, qualified, text_len, decoded_len):
        self.gate_a = gate_a
        self.gate_a_ratio = gate_a_ratio
        self.gate_b = gate_b
        self.gate_c = gate_c
        self.gate_c_hits = gate_c_hits
        self.gate_c_total = gate_c_total
        self.gate_d = gate_d
        self.qualified = qualified
        self.text_len = text_len
        self.decoded_len = decoded_len

    @property
    def failed_gates(self):
        failed = []
        if self.gate_a is False:
            failed.append("A")
        if not self.gate_b:
            failed.append("B")
        if not self.gate_c:
            failed.append("C")
        if not self.gate_d:
            failed.append("D")
        return tuple(failed)

    @property
    def ratio_bucket(self):
        """Coarse bucket for the strict-equality admissibility tuple.

        A float ratio must never enter an equality comparison across validators. Twentieths,
        capped at 40, means two validators that fetched the same bytes agree exactly.
        """
        if self.gate_a_ratio is None:
            return None
        return min(40, int(self.gate_a_ratio * 20))

    def __repr__(self):
        return "Qualification(%s a=%s b=%s c=%d/%d d=%s)" % (
            "QUALIFIED" if self.qualified else "REJECTED",
            self.gate_a, self.gate_b, self.gate_c_hits, self.gate_c_total, self.gate_d)


def qualify(text, spec, median_text_len=None, decoded_len=None):
    """Apply gates A, B, C and D to extracted text. Returns a `Qualification` or a `Refusal`.

    Gate A  length against the running median, qualifying at >= 0.60 * median.
            DISABLED BY DEFAULT, for the one thing that was actually measured: chrome inflated
            extracted text 13x on one page, from 2,738 to 35,689 characters, with no policy
            change at all. See `GATE_A_ENABLED_DEFAULT`.
    Gate B  the document's own title phrase is present.
    Gate C  at least N-1 of N expected sections present.
    Gate D  the document reaches its own final section, by a marker that `GateSpec.validate`
            forces to be independent of both the anchor and every section.

    Composite requires A and B and C and D.

    NONE OF B, C OR D HAS A MEASURED TRUE POSITIVE, and saying so is the point. An earlier
    version of this docstring credited each of them with catching 4 of 4 bad snapshots; that
    number came from a measuring script that read the archive's `id_` replay without
    decompressing it, so four faithful gzip captures were graded as binary. Decompressed, all
    four qualify. Every payload captured for this project qualifies once decoded, so these gates
    are a fail-closed structural safeguard held in place by the argument in the module header,
    not by evidence that they have ever rejected a real deficient page. The one synthetic
    negative that exists, a chrome-only shell derived from a real capture, shows gate B passing
    while C and D fail, which is the only evidence here that they do separate work.

    Matching is done on the normalized forms of both sides, so casing, entity noise and
    whitespace differences between two faithful captures cannot flip a gate.
    """
    bad = spec.validate()
    if bad is not None:
        return bad

    normalized = normalize_text(text)
    text_len = len(text or "")

    ratio = None
    gate_a = None
    if median_text_len:
        ratio = text_len / float(median_text_len)
    if spec.enable_gate_a:
        if not median_text_len:
            return Refusal(EXPECTED, "gate-a-no-median",
                           "gate A is enabled but no median was supplied")
        gate_a = ratio >= spec.gate_a_ratio

    gate_b = normalize_text(spec.anchor) in normalized

    hits = 0
    for section in spec.sections:
        if normalize_text(section) in normalized:
            hits += 1
    total = len(spec.sections)
    gate_c = hits >= total - 1

    gate_d = normalize_text(spec.terminal) in normalized

    qualified = bool(gate_b and gate_c and gate_d) and (gate_a is not False)
    return Qualification(gate_a, ratio, gate_b, gate_c, hits, total, gate_d,
                         qualified, text_len,
                         len(text or "") if decoded_len is None else decoded_len)


# ---------------------------------------------------------------------------
# Injected transport
# ---------------------------------------------------------------------------

class FetchResult(object):
    __slots__ = ("status", "body", "headers", "url")

    def __init__(self, status, body, headers, url):
        self.status = status
        self.body = body
        self.headers = headers
        self.url = url

    def __repr__(self):
        return "FetchResult(%d, %d bytes)" % (self.status, len(self.body or b""))


def response_parts(response):
    """Normalize whatever the injected `fetch` returned into `(status, body, headers)`.

    `.status` first, and that ordering is not cosmetic. GenVM's `web.request` result exposes
    `.status`; the published documentation example uses `.status_code`, which does not exist. A
    module that read `.status_code` first would work against a mock and fail on chain, so the
    correct name is preferred and the wrong one is accepted only as a last resort.
    """
    if response is None:
        return None
    status = None
    for name in ("status", "statusCode", "status_code"):
        if hasattr(response, name):
            status = getattr(response, name)
            break
        if isinstance(response, dict) and name in response:
            status = response[name]
            break
    if status is None:
        return None
    body = getattr(response, "body", None)
    if body is None and isinstance(response, dict):
        body = response.get("body")
    headers = getattr(response, "headers", None)
    if headers is None and isinstance(response, dict):
        headers = response.get("headers")
    if isinstance(body, str):
        body = body.encode("utf-8")
    if body is None:
        body = b""
    return int(status), bytes(body), dict(headers or {})


def fetch_bytes(fetch, url, method="GET", timeout=WAYBACK_TIMEOUT_SECONDS, headers=None):
    """Call the injected `fetch` once and classify the result. Returns `FetchResult` or `Refusal`.

    Classification, and every branch of it is "absence is never success":

      200          the only success.
      3xx          `[EXTERNAL]`, and the redirect is NEVER followed. A 14-digit timestamp one
                   second off a real capture returns 302, and following it would hand the
                   contract a different document with a different digest while every validator
                   believed it read the requested one.
      403, 429     `[EXTERNAL]`. Rate limiting and refusal are the source being unreachable.
      other        `[EXTERNAL]`.
      raised       `[TRANSIENT]`. A transport failure is retryable and is not evidence.

    `fetch` is called with keyword arguments and must accept `method`, `headers` and `timeout`.
    """
    try:
        response = fetch(url, method=method, headers=dict(headers or {}), timeout=timeout)
    except Exception as error:                                   # noqa: BLE001
        return Refusal(TRANSIENT, "transport", "%s: %s" % (type(error).__name__, error))

    parts = response_parts(response)
    if parts is None:
        return Refusal(TRANSIENT, "response-shape",
                       "no status on %s" % type(response).__name__)
    status, body, response_headers = parts

    if 300 <= status < 400:
        return Refusal(EXTERNAL, "redirect",
                       "http %d, not followed; location=%r"
                       % (status, response_headers.get("location")))
    if status in (403, 429):
        return Refusal(EXTERNAL, "throttled", "http %d" % status)
    if status != 200:
        return Refusal(EXTERNAL, "non-200", "http %d" % status)
    return FetchResult(status, body, response_headers, url)


def load_change_points(fetch, target, from_date, to_date, limit, fields=CDX_DEFAULT_FIELDS):
    """Fetch and parse one bounded CDX window. Returns `CdxIndex` or `Refusal`.

    The limit is passed into `parse_cdx`, so the returned index can answer `saturated` instead of
    leaving the caller to remember what it asked for. Unanchored: see `load_anchored_window`.
    """
    url = cdx_query_url(target, from_date, to_date, limit, fields=fields)
    result = fetch_bytes(fetch, url)
    if is_refusal(result):
        return result
    return parse_cdx(result.body, requested_limit=limit)


def load_anchored_window(fetch, target, timestamp, to_date, limit,
                         fields=CDX_DEFAULT_FIELDS):
    """Fetch a window anchored at `timestamp`, and require the pin to come back at row 0.

    The whole anchoring rule in one call: build with `from=<pin>`, parse with the limit so
    saturation is known, then check position rather than mere membership. Returns the `CdxIndex` on
    success, so the caller still has the rows and the saturation flag; the row itself is
    `index.oldest_first[0]`.
    """
    url = cdx_window_for(target, timestamp, to_date, limit, fields=fields)
    if is_refusal(url):
        return url
    result = fetch_bytes(fetch, url)
    if is_refusal(result):
        return result
    index = parse_cdx(result.body, requested_limit=limit)
    if is_refusal(index):
        return index
    row = require_timestamp_at_row_zero(index, timestamp)
    if is_refusal(row):
        return row
    return index


# ---------------------------------------------------------------------------
# 6. The ordered pipeline
# ---------------------------------------------------------------------------

class Admission(object):
    """An admitted snapshot, plus the ordered list of deterministic steps that admitted it.

    `steps` is not a log. It is how `test_archive.py` proves that the digest was compared before
    the payload was decoded, which is an ordering claim that cannot be checked by reading the
    return value alone.

    `digest_state` is the honest answer to "was this payload confirmed against the index?", and it
    exists because the answer is not a boolean. `as-archived` means the digest agreed, which is
    definitive. `transport-decoded` means the bytes arrived inflated and the column is a hash of the
    stored form, so agreement was never possible and nothing was confirmed. A caller that stores an
    Admission must store this alongside it, because a bond opened on a `transport-decoded` baseline
    rests on `decoded_sha256` and on nothing else.
    """

    __slots__ = ("timestamp", "digest", "expected_digest", "digest_state", "raw_len", "decoded",
                 "text", "qualification", "decoded_sha256", "steps")

    def __init__(self, timestamp, digest, raw_len, decoded, text, qualification,
                 decoded_sha256, steps, expected_digest=None,
                 digest_state=DIGEST_AS_ARCHIVED):
        self.timestamp = timestamp
        self.digest = digest
        self.expected_digest = expected_digest
        self.digest_state = digest_state
        self.raw_len = raw_len
        self.decoded = decoded
        self.text = text
        self.qualification = qualification
        self.decoded_sha256 = decoded_sha256
        self.steps = tuple(steps)

    @property
    def qualified(self):
        return self.qualification.qualified

    @property
    def digest_confirmed(self):
        """True only when the index's own column agreed with the bytes in hand."""
        return self.digest_state == DIGEST_AS_ARCHIVED

    @property
    def encoding(self):
        return self.decoded.encoding

    @property
    def decoded_len(self):
        return len(self.decoded)

    def __repr__(self):
        return "Admission(%s %s %d -> %d bytes, %s, digest %s)" % (
            self.timestamp, self.decoded.encoding, self.raw_len, len(self.decoded),
            "QUALIFIED" if self.qualified else "REJECTED", self.digest_state)


def admit_snapshot(raw, expected_digest, spec, timestamp=None, warc_length=None,
                   median_text_len=None, decode=None):
    """The whole deterministic path over one snapshot, in the one order that is correct.

        cap 1  cdx warc length  <=   250,000     cheapest, index-only, may be skipped
        cap 2  raw payload      <= 2,500,000     after fetch, before anything reads the bytes
        digest base32(sha1(payload)) vs cdx      over the bytes AS RECEIVED, classified not gated
        decode magic bytes, branch, guarded      cap 3 enforced during inflation
        cap 3  decoded          <= 4,000,000
        text   strip, unescape, collapse
        gates  A B C D

    Two orderings in there are load-bearing.

    The digest is compared BEFORE the decode because the only case in which the comparison can
    fail for the right reason is the case where the bytes in hand are still the stored ones, and
    after a decode they never are. Comparing afterwards would hash whatever happened to be held,
    which is the shape of a check that always passes. `classify_digest` carries the rest of that
    argument, including why a mismatch on an already-inflated payload is recorded and not refused.

    The caps run cheapest first: an index integer, then a length, then the only step that costs
    real memory.

    `decode` is injectable so a test can substitute an identity-only decoder and measure what a
    build with no decompression would have concluded. That is the central claim of this project
    and it needs to be executable rather than asserted.
    """
    steps = []
    decode = decode_checked if decode is None else decode

    if timestamp is not None:
        bad = require_exact_timestamp(timestamp)
        if bad is not None:
            return bad
        steps.append("timestamp")

    if warc_length is not None:
        bad = check_warc_length(warc_length)
        if bad is not None:
            return bad
        steps.append("cap-warc-length")

    if raw is None:
        return Refusal(EXTERNAL, "no-payload")
    raw = bytes(raw)

    bad = check_raw_len(len(raw))
    if bad is not None:
        return bad
    steps.append("cap-raw")

    digest_state = classify_digest(raw, expected_digest)
    if is_refusal(digest_state):
        return digest_state
    steps.append("digest")
    steps.append("digest-" + digest_state)

    decoded = decode(raw)
    if is_refusal(decoded):
        return decoded
    if not isinstance(decoded, Decoded):
        return Refusal(TRANSIENT, "decode-shape", type(decoded).__name__)
    steps.append("decode")

    bad = check_decoded_len(len(decoded))
    if bad is not None:
        return bad
    steps.append("cap-decoded")

    text = extract_text(decoded.data)
    steps.append("extract")

    qualification = qualify(text, spec, median_text_len=median_text_len,
                            decoded_len=len(decoded))
    if is_refusal(qualification):
        return qualification
    steps.append("gates")

    return Admission(
        timestamp=timestamp,
        digest=cdx_digest(raw),
        expected_digest=(str(expected_digest).strip().upper() if expected_digest else None),
        digest_state=digest_state,
        raw_len=len(raw),
        decoded=decoded,
        text=text,
        qualification=qualification,
        decoded_sha256=sha256_hex(decoded.data),
        steps=steps,
    )


def retrieve_snapshot(fetch, timestamp, target, expected_digest, spec,
                      warc_length=None, median_text_len=None, decode=None):
    """Fetch one `id_` snapshot and admit it. Returns `Admission` or `Refusal`.

    The 14-digit check and cap 1 both run before the fetch, so a caller error and an oversize
    change point cost nothing.
    """
    bad = require_exact_timestamp(timestamp)
    if bad is not None:
        return bad
    if warc_length is not None:
        bad = check_warc_length(warc_length)
        if bad is not None:
            return bad

    result = fetch_bytes(fetch, snapshot_url(timestamp, target))
    if is_refusal(result):
        return result

    return admit_snapshot(result.body, expected_digest, spec, timestamp=timestamp,
                          warc_length=None, median_text_len=median_text_len, decode=decode)


def admissibility_tuple(admission):
    """`EQ_SNAPSHOT_ADMISSIBILITY`, for `gl.eq_principle.strict_eq`.

    Pure arithmetic over fetched bytes, so any disagreement means two validators fetched
    different things and must revert `[TRANSIENT]` rather than resolve into a payout.

    `decoded_sha256` and not a URL. The lesson carried over from the OFAC path is that an
    equivalence principle compares content and derived verdict, never the retrieval address:
    every validator there fetched a different presigned URL and still agreed on the bytes.

    `ratio_bucket` is emitted ONLY when gate A actually ran. It used to be emitted whenever the
    caller happened to supply a median, which put a disabled gate's arithmetic into consensus:

        text_len 48934, median 48934  ->  ratio 1.000000  ->  bucket 20
        text_len 48934, median 48935  ->  ratio 0.999980  ->  bucket 19

    `int(ratio * 20)` truncates, so a ratio sitting on a bucket edge flips buckets on a one
    character change in the median. Both validators pass gate B, C and D, both call the snapshot
    qualified, and the tuples still differ. strict_eq then reverts over a field that carries no
    decision. The median comes from a CDX response each validator fetches separately, so agreement
    on it is exactly what cannot be assumed. Bucketing narrows that surface; it does not close it.

    With the gate off, which is how it ships, the slot is None and a supplied median cannot cause
    a revert. The ratio stays on the `Qualification` as a diagnostic either way.

    `digest_state` is in the tuple deliberately, and it is the one slot that earns its place by
    being able to disagree. If one validator's transport undid the content encoding and another's
    did not, the two hold different bytes, compute different `digest` values, and reach different
    states. Any one of those three differences reverts, which is the correct outcome: a payout must
    not be resolved out of a set of validators who did not read the same body.
    """
    q = admission.qualification
    return (
        admission.timestamp,
        admission.digest,
        admission.digest_state,
        admission.raw_len,
        admission.decoded.encoding,
        admission.decoded_sha256,
        q.ratio_bucket if q.gate_a is not None else None,
        bool(q.gate_b),
        q.gate_c_hits,
        bool(q.gate_d),
        bool(q.qualified),
    )
