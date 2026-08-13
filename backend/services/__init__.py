"""Business logic services (no HTTP layer).

Modules here are pure computation/data-access helpers used by multiple
route modules. They only depend on `core.database` and each other; they
never import from `routes.*`.
"""
