"""Authentication and authorization modules for the Lekka Patra backend.

The security package is self-contained: it owns session verification,
paywall/trial gating, and role-based owner checks. All modules here
depend only on core.database (single shared MongoDB handle) and, where
needed, on each other in a strictly one-directional way:

    utils.py           (leaf — no security imports)
        ↑
    authentication.py  (depends on core.database)
        ↑
    authorization.py   (depends on core.database, authentication, utils)

server.py (and future route modules) import from this package. No module
outside `security/` should ever redefine `get_current_user`,
`compute_access`, `require_write_access`, `is_owner`, `require_owner`,
or `_promote_owner_if_needed`.
"""
