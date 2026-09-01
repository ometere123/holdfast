"""Live pre-flight: will the two network calls `create_bond` makes actually succeed today?

The offline pass proved the spec qualifies the bytes Wayback replayed in January. It cannot prove
the archive still answers, that the pin is still at row 0, or that the replay still returns those
same bytes. Those three are the difference between a bond that opens and a stake spent on an
[EXTERNAL] revert, so they are checked here first, against the live archive, using the URLs the
contract itself builds.

Nothing is printed but statuses, counts, lengths and digests. The snapshot body is ~90 KB of
gzip and the CDX body is a few kilobytes of JSON; both are summarised, never dumped.
"""

import hashlib
import json
import re
import sys
import urllib.request

sys.path.insert(0, r"C:\Users\USER\Desktop\latestprojects\_build\holdfast-archive")

import archive  # noqa: E402

PAGE = "https://cloud.google.com/terms/"
STAMP = "20260129024608"
TO_DATE = "20260831000000"

# CDX_ROW_LIMIT is the contract's, not the archive module's, so it is read out of the contract
# rather than restated. A preflight that used a different row budget than the live call would be
# checking a different query.
CONTRACT = open(r"C:\Users\USER\Desktop\latestprojects\holdfast\contracts\Holdfast.py",
                encoding="utf-8").read()
CDX_ROW_LIMIT = int(re.search(r"^CDX_ROW_LIMIT = ([0-9_]+)", CONTRACT, re.M).group(1).replace("_", ""))
print("CDX_ROW_LIMIT read from the contract:", CDX_ROW_LIMIT)

cdx = archive.cdx_window_for(PAGE, STAMP, TO_DATE, CDX_ROW_LIMIT)
snap = archive.snapshot_url(STAMP, PAGE)
print("cdx url ", cdx)
print("snap url", snap)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "holdfast-preflight/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.status, response.read(), dict(response.headers)


print("\n== CDX ==")
status, body, _headers = fetch(cdx)
print("status      ", status)
print("bytes       ", len(body))
index = archive.parse_cdx(body.decode("utf-8", "replace"))
if archive.is_refusal(index):
    print("parse        ", index)
else:
    print("rows        ", len(index.rows))
    print("change_points", index.change_points)
    print("saturated   ", index.saturated)
    print("row 0       ", index.rows[0] if index.rows else None)
    at_zero = archive.require_timestamp_at_row_zero(index, STAMP)
    print("pin at row 0", at_zero if archive.is_refusal(at_zero) else "yes")
    enough = archive.has_min_change_points(index, archive.MIN_CHANGE_POINTS,
                                           requested_limit=CDX_ROW_LIMIT)
    print("enough      ", enough)

print("\n== snapshot ==")
status, body, headers = fetch(snap)
print("status         ", status)
print("raw bytes      ", len(body))
print("content-encoding", headers.get("Content-Encoding"))
print("magic          ", archive.magic_hex(body))
print("cdx digest     ", archive.cdx_digest(body))
if not archive.is_refusal(index) and index.rows:
    print("digest agrees  ", archive.cdx_digest(body) == index.rows[0].digest)
print("raw sha256     ", hashlib.sha256(body).hexdigest())

decoded, encoding = archive.decode_payload(body)
print("encoding       ", encoding)
print("decoded bytes  ", len(decoded))
text = archive.extract_text(decoded.decode("utf-8", "replace"))
spec = archive.GateSpec("terms",
                        ["definitions", "payment terms", "confidentiality",
                         "intellectual property", "term and termination"],
                        "governing law")
result = archive.qualify(text, spec, decoded_len=len(decoded))
print("QUALIFIED      ", result.qualified, "gate C", "%d of %d" % (result.gate_c_hits, result.gate_c_total))
print("text chars     ", result.text_len)
verbatim = "Google will notify Customer at least 12 months before"
print("verbatim excerpt present", verbatim in text)

fixture = open(r"C:\Users\USER\Desktop\latestprojects\_build\fixtures\holdfast"
               r"\snap-gcp-terms-gzip.bin", "rb").read()
print("\nbyte-identical to the fixture captured 2026-08-25:", body == fixture)
print("fixture sha256 ", hashlib.sha256(fixture).hexdigest())
print(json.dumps({"preflight": "done"}))
