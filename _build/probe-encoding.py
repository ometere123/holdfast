"""Does the archive declare the archived gzip as a transport encoding, and can a header stop it?

WHY THIS MATTERS MORE THAN ANYTHING ELSE MEASURED FOR THIS PROJECT. The live `create_bond` call
computed the CDX digest over 819,751 bytes and got RH5GAEIT..., where the CDX column says
ORCARP7HG... over 89,652 bytes. Those two numbers are exactly `len(gzip.decompress(raw))` and
`base32(sha1(gzip.decompress(raw)))`, so GenVM handed the contract a DECOMPRESSED body. Every
offline test passes because the mock hands back whatever bytes it is given, which means the one
thing the fixture harness cannot reproduce is the transport, and the transport is the subject.

The preflight reported `content-encoding: None`, which was a measurement error: it did
`dict(response.headers).get("Content-Encoding")`, and a plain dict lookup is case sensitive, so a
lowercase `content-encoding` header reads as absent. This checks the headers case-insensitively
and asks the real question: is the encoding declared, and does `Accept-Encoding` control it?

Three requests, one per Accept-Encoding value. urllib never decompresses on its own, so whatever
comes back is what the wire carried, and the digest of those bytes says which side of the
compression boundary the response sat on.
"""

import base64
import gzip
import hashlib
import urllib.request

URL = "https://web.archive.org/web/20260129024608id_/https://cloud.google.com/terms/"

RAW = open(r"C:\Users\USER\Desktop\latestprojects\_build\fixtures\holdfast"
           r"\snap-gcp-terms-gzip.bin", "rb").read()
DECODED = gzip.decompress(RAW)


def digest(payload):
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii")


RAW_DIGEST = digest(RAW)
DECODED_DIGEST = digest(DECODED)
print("as archived   %7d bytes  %s   <- this is what the CDX index digests"
      % (len(RAW), RAW_DIGEST))
print("decompressed  %7d bytes  %s   <- this is what the contract computed on chain"
      % (len(DECODED), DECODED_DIGEST))

CASES = [
    ("no Accept-Encoding header", None),
    ("Accept-Encoding: identity", "identity"),
    ("Accept-Encoding: gzip", "gzip"),
]

for label, accept in CASES:
    headers = {"User-Agent": "holdfast-encoding-probe/1"}
    if accept is not None:
        headers["Accept-Encoding"] = accept
    request = urllib.request.Request(URL, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
        # Case-insensitive, which is the whole point. `response.headers` is an
        # email.message.Message and its own .get IS case-insensitive; the earlier mistake was
        # copying it into a plain dict first.
        declared = response.headers.get("Content-Encoding")
        length = response.headers.get("Content-Length")
        status = response.status

    which = ("AS ARCHIVED" if body == RAW
             else "DECOMPRESSED" if body == DECODED
             else "neither")
    print("\n%s" % label)
    print("  status %s, %d bytes on the wire, content-length %s" % (status, len(body), length))
    print("  content-encoding declared: %r" % declared)
    print("  magic %s" % body[:2].hex())
    print("  digest %s" % digest(body))
    print("  identical to %s" % which)
    if accept is not None and accept != "gzip":
        print("  so a client that asks for identity gets: %s" % which)
