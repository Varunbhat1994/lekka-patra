"""Authentication-related utility helpers.

Kept alongside the authentication/authorization modules so the
`security/` package can be reasoned about in isolation. `_normalize_mobile`
is used both by the RBAC owner check (`_owner_mobile`) and by the auth
routes that still live in server.py (OTP send/verify, Firebase verify,
profile update).
"""


def _normalize_mobile(m: str) -> str:
    """Strip non-digits from a mobile number and prepend the India country
    code (91) if the caller passed a plain 10-digit local number.

    Behavior is intentionally identical to the original function that
    lived in server.py.
    """
    m = "".join(ch for ch in (m or "") if ch.isdigit())
    if len(m) == 10:
        m = "91" + m
    return m
