"""Pick the arguments for a real bond, offline, against the exact bytes the archive replays.

WHY THIS IS NOT GUESSWORK. `create_bond` makes its network calls only after every deterministic
check has passed, and then it needs three more things to be true of the live baseline: the CDX
window must hold at least MIN_CHANGE_POINTS rows, the capture must pass gates B, C and D, and a
model must read the quoted commitment as holding in the extracted text. The first is a property
of the archive. The last two are properties of THIS DOCUMENT, and this project already has the
document on disk as the bytes Wayback replays for that timestamp. So the gate inputs and the
commitment are chosen by running the contract's own pipeline over those bytes rather than by
picking phrases that look plausible and paying for the answer on chain.

Prints excerpts only. The decoded document is ~90k characters and printing it would tell nobody
anything.
"""

import sys

sys.path.insert(0, r"C:\Users\USER\Desktop\latestprojects\_build\holdfast-archive")

import archive  # noqa: E402

FIXTURE = r"C:\Users\USER\Desktop\latestprojects\_build\fixtures\holdfast\snap-gcp-terms-gzip.bin"
PAGE = "https://cloud.google.com/terms/"
STAMP = "20260129024608"

raw = open(FIXTURE, "rb").read()
decoded, encoding = archive.decode_payload(raw)
text = archive.extract_text(decoded.decode("utf-8", "replace"))
normalized = archive.normalize_text(text)

print("raw bytes      ", len(raw))
print("encoding       ", encoding)
print("decoded bytes  ", len(decoded))
print("text chars     ", len(text))
print("normalized     ", len(normalized))
print("anchor derived ", repr(archive.normalize_text("terms")))
print("gate B present ", archive.normalize_text("terms") in normalized)

# Candidate gate C sections and gate D terminals, tested for presence and for the independence
# rule that GateSpec.validate enforces.
CANDIDATE_SECTIONS = [
    "definitions", "payment terms", "confidentiality", "intellectual property",
    "term and termination", "governing law", "data processing", "service level agreement",
    "acceptable use policy", "limitation of liability", "indemnification", "warranties",
    "dispute resolution", "privacy notice", "google cloud platform", "customer data",
]
CANDIDATE_TERMINALS = [
    "governing law", "miscellaneous", "entire agreement", "notices",
    "limitation of liability", "indemnification", "survival", "assignment",
]

print("\n== sections present ==")
for section in CANDIDATE_SECTIONS:
    print("  %-26s %s" % (section, archive.normalize_text(section) in normalized))

print("\n== terminals present ==")
for terminal in CANDIDATE_TERMINALS:
    print("  %-26s %s" % (terminal, archive.normalize_text(terminal) in normalized))

# Sentences that read like a durable commitment. Reported with their length, because the
# contract needs 40 to 400 raw characters and 20 normalized.
print("\n== candidate commitment sentences ==")
NEEDLES = ["at least", "will provide", "will not", "no less than", "prior written",
           "days' notice", "days notice", "we will", "google will"]
seen = set()
found = 0
for piece in text.replace("\r", " ").split("."):
    stripped = " ".join(piece.split())
    if not (40 <= len(stripped) <= 380):
        continue
    low = stripped.lower()
    if not any(needle in low for needle in NEEDLES):
        continue
    if stripped in seen:
        continue
    seen.add(stripped)
    found += 1
    if found > 24:
        break
    print("  [%3d] %s" % (len(stripped), stripped[:300]))
print("total candidates", len(seen))
