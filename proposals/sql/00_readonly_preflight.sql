-- READ ONLY: individual console commands for the installed 0001 schema.
-- These checks do not change, migrate, or enable anything.
-- Record the selected database name in the console before running any check.
PRAGMA foreign_keys;
PRAGMA foreign_key_check;
SELECT type,name FROM sqlite_schema
 WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
 ORDER BY type,name;
SELECT sql FROM sqlite_schema WHERE type='table' AND name='budgets';
SELECT month,used_cents,reserved_cents,10000-used_cents-reserved_cents AS remaining_cents
 FROM budgets ORDER BY month;
SELECT month,used_cents,reserved_cents FROM budgets
 WHERE month IS NULL OR typeof(used_cents)<>'integer' OR typeof(reserved_cents)<>'integer';
SELECT b.month,b.used_cents,b.reserved_cents,
 COALESCE((SELECT SUM(s.cap_cents) FROM sessions s WHERE s.month=b.month AND s.reservation_active=1),0) AS expected_reserved_cents,
 COALESCE((SELECT SUM(r.value_cents) FROM rewards r WHERE r.month=b.month),0) AS expected_used_cents
 FROM budgets b ORDER BY b.month;
