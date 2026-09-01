"""Does the chosen spec qualify the real baseline bytes, and is its CDX row inside the caps?

Runs the exact composite the contract runs, on the exact bytes, with the exact arguments the
live `create_bond` call will carry. If gate C reports 5 of 5 and `qualified` is True here, the
only things left that the offline pass cannot settle are the live CDX row count and the model's
reading, and both of those are named in the output rather than assumed.
"""

import json
import sys

sys.path.insert(0, r"C:\Users\USER\Desktop\latestprojects\_build\holdfast-archive")

import archive  # noqa: E402

FIXTURES = r"C:\Users\USER\Desktop\latestprojects\_build\fixtures\holdfast"

PAGE = "https://cloud.google.com/terms/"
STAMP = "20260129024608"
ANCHOR = "terms"
SECTIONS = ["definitions", "payment terms", "confidentiality",
            "intellectual property", "term and termination"]
TERMINAL = "governing law"
COMMITMENT = (
    "Google will notify Customer at least 12 months before discontinuing any Service or "
    "associated material functionality, unless Google replaces such discontinued Service or "
    "functionality with a materially similar Service or functionality."
)

raw = open(FIXTURES + r"\snap-gcp-terms-gzip.bin", "rb").read()
decoded, encoding = archive.decode_payload(raw)
text = archive.extract_text(decoded.decode("utf-8", "replace"))

spec = archive.GateSpec(ANCHOR, SECTIONS, TERMINAL)
bad = spec.validate()
print("spec.validate()      ", bad)

result = archive.qualify(text, spec, decoded_len=len(decoded))
print("gate B               ", result.gate_b)
print("gate C               ", "%d of %d" % (result.gate_c_hits, result.gate_c_total), result.gate_c)
print("gate D               ", result.gate_d)
print("gate A               ", result.gate_a, "(None means disabled)")
print("QUALIFIED            ", result.qualified)
print("failed gates         ", result.failed_gates)
print("text_len             ", result.text_len)

print("\ncommitment raw chars ", len(COMMITMENT))
print("commitment normalized", len(archive.normalize_text(COMMITMENT)))
verbatim = "Google will notify Customer at least 12 months before"
print("an excerpt the model can cite verbatim is present:",
      verbatim in text, repr(verbatim))

# The pre-filter the contract applies to the CDX row before it fetches anything.
index = json.load(open(FIXTURES + r"\cdx-gcp-terms.json", encoding="utf-8"))
parsed = archive.parse_cdx(json.dumps(index))
print("\ncdx rows in fixture  ", len(parsed.rows) if hasattr(parsed, "rows") else parsed)
row = archive.find_timestamp(parsed, STAMP) if hasattr(parsed, "rows") else None
print("row at baseline      ", row)
if row is not None and not archive.is_refusal(row):
    print("warc_length          ", row.warc_length, "cap", archive.CDX_WARC_LENGTH_MAX)
    print("check_warc_length    ", archive.check_warc_length(row.warc_length))
    print("digest declared      ", row.digest)
    print("digest of these bytes", archive.cdx_digest(raw))
    print("digest agrees        ", archive.cdx_digest(raw) == row.digest)
print("check_raw_len        ", archive.check_raw_len(len(raw)))
print("check_decoded_len    ", archive.check_decoded_len(len(decoded)))
