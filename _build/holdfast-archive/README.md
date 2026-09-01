# holdfast-archive

`archive.py` is the single deliverable. Stdlib only (`base64 hashlib json re zlib`), no clock, no filesystem, no network: every
input is an argument and HTTP happens only through an injected `fetch(url, method, headers, timeout)`, enforced by the AST scan
in `test_archive.py`. Failures are returned as `Refusal(tag, reason, detail)`, tag `[EXPECTED]` `[EXTERNAL]` `[TRANSIENT]` `[LLM_ERROR]`, tested with `is_refusal(value)`.

## Public API

    cdx_window_for(target, ts, to_date, limit, fields=(...)) -> url | Refusal  # ANCHORED, use this
    cdx_query_url(target, from_date, to_date, limit, ...)  # unanchored: the 365 day count only
    snapshot_url(ts, target) -> .../web/<ts>id_/<target>   # `id_` raw replay, load-bearing
    is_exact_timestamp(v) / require_exact_timestamp(v) -> bool / None | Refusal ; find_timestamp
    parse_cdx(body, requested_limit=None) -> CdxIndex | Refusal          # `[]` is [EXTERNAL]
    require_timestamp_at_row_zero(index, ts) -> CdxRow | Refusal ; require_timestamp(index, ts)
    next_cursor(index) -> ts ; index.saturated / .position_of(ts) / .newest / .change_points
    has_min_change_points(index, threshold=3, requested_limit=None) -> bool | Refusal
    cdx_digest(raw) / sha256_hex(b)   # base32(sha1(bytes in hand)); the CDX `collapse=digest` label
    classify_digest(raw, expected) -> DIGEST_AS_ARCHIVED | DIGEST_TRANSPORT_DECODED | Refusal
    check_warc_length(n) / check_raw_len(n) / check_decoded_len(n) -> None | Refusal
    decode_payload(raw) -> (bytes, kind)   # 1f8b gzip, 78 zlib, else identity. No raw deflate.
    decode_checked(raw, cap=4_000_000) -> Decoded | Refusal ; magic_hex / gzip_declared_size(raw)
    extract_text(decoded) -> str ; normalize_text / normalize_commitment / commitment_hash
    GateSpec(anchor, sections, terminal, enable_gate_a=False, gate_a_ratio=0.60).validate()
    qualify(text, spec, median_text_len=None, decoded_len=None) -> Qualification | Refusal
    admit_snapshot(raw, expected_digest, spec, timestamp=None, warc_length=None, ...) -> Admission
    fetch_bytes(fetch, url, method="GET", timeout=120, headers=None) -> FetchResult | Refusal
    response_parts(response) -> (status, body, headers)   # GenVM gives `.status`, not `.status_code`
    load_anchored_window(fetch, target, ts, to_date, limit) / load_change_points(fetch, target, ...)
    retrieve_snapshot(fetch, ts, target, expected_digest, spec, ...) -> Admission | Refusal
    admissibility_tuple(admission) -> 11-tuple  # str/int/bool/None only, safe for strict_eq

`Admission.steps` fixes the order: `timestamp, cap-warc-length, cap-raw, digest, digest-<state>, decode, cap-decoded, extract, gates`, cap 1 only when given
`warc_length`. The digest is compared before the decode and, for the reason `classify_digest` records (measured on chain, tx `0xc3a12dd2`: GenVM's transport decompresses
first), refuses `[TRANSIENT]` only while the bytes still start `1f8b`, else notes `transport-decoded` and the caller pins `decoded_sha256`. CDX rows come oldest first, so
`limit=` drops the NEWEST: anchor each window at the timestamp the call needs, require row 0, advance the cursor to the newest row EXAMINED, treat `saturated` as work
waiting, not an error.

## Splice contract

`archive.py` is copied inline between `# --- BEGIN archive.py ---` and `# --- END archive.py ---`,
imports hoisted to the contract top, nothing else edited. The contract asserts at build time that
`sha256` of the spliced region equals `sha256` of this file, so editing either copy fails the guard.
