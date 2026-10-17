# Carrier appointment expiration policy

Carrier appointments are not treated as perpetual by default.

A verified appointment requires a recorded effective date and a finite expiration
date. The date range must be ordered and currently valid when verification is
recorded. Missing or expired dates block product activation, eligibility, and
product preflight.

The database constraint in migration 0093 rejects active or
appointment-verified contracts that lack an expiration date. Before applying
this migration, review existing records and obtain documented expiration
evidence; do not populate guessed dates to satisfy the constraint.

A carrier with genuinely indefinite appointments requires a separately
reviewed and documented policy implementation, not a null expiry shortcut.

The carrier preflight remains advisory. Business submission authorization
must be enforced inside the eventual submission transaction.
