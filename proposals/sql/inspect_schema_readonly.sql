-- LECTURE SEULE. A executer sur la base selectionnee AVANT toute migration.
-- Ne cree, ne supprime et ne modifie aucune donnee.
-- Les marqueurs indiquent les etapes presentes, sans remplacer le diagnostic
-- prive /api/admin/setup qui controle aussi les colonnes, index et declencheurs.

SELECT name, type, tbl_name
FROM sqlite_master
WHERE type IN ('table','index','trigger')
  AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'
ORDER BY type, name;

SELECT '0001_rewards' AS migration,
       EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='rewards') AS marqueur_present
UNION ALL
SELECT '0002_configurable_budget', EXISTS(SELECT 1 FROM pragma_table_info('budgets') WHERE name='limit_cents')
UNION ALL
SELECT '0003_manual_discounts', EXISTS(SELECT 1 FROM pragma_table_info('rewards') WHERE name='discount_applied')
UNION ALL
SELECT '0004_manual_rewards_food_only', EXISTS(SELECT 1 FROM pragma_table_info('rewards') WHERE name='source')
UNION ALL
SELECT '0005_reward_notification_sms', EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_sms')
UNION ALL
SELECT '0006_phone_correction', EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name='active_challenge_id')
UNION ALL
SELECT '0007_preview_test_consumption', EXISTS(SELECT 1 FROM pragma_table_info('rewards') WHERE name='preview_test_consumed')
UNION ALL
SELECT '0008_launch_without_sms', EXISTS(SELECT 1 FROM pragma_table_info('rewards') WHERE name='phone_ciphertext')
UNION ALL
SELECT '0009_device_reward_limits', EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='reward_exceptions');

PRAGMA table_info(employees);
PRAGMA table_info(budgets);
PRAGMA table_info(sessions);
PRAGMA table_info(rewards);
PRAGMA foreign_key_check;
