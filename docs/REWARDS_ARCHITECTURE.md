# Architecture des récompenses de Noël

La version de développement utilise **Cloudflare Pages Functions et D1**. Le précédent document de proposition Supabase ne décrit plus l’implémentation.

- Moteur déterministe partagé : `v3/game-session-engine.mjs`, rejoué par `server/api.mjs`.
- Budget, réservations, plafonds, unicité des récompenses et transitions du personnel : `migrations/0001_rewards.sql` et `server/store.mjs`.
- Authentification individuelle : JWT Cloudflare Access signé, audience et émetteur fixes, puis liste d’employés actifs D1 dans `server/auth.mjs`.
- Vérification après un score admissible : Twilio Verify, désactivé sans approbations et secrets serveur.
- Menu public : aucune donnée de budget ni identité ; absence de configuration = entraînement sans promesse de gain.
- Administration : `/admin/`, données privées servies exclusivement après autorisation serveur.
- Publication Pages : sources `functions/` compilées dans `v3/_worker.js` ; `v3/_routes.json` protège aussi les routes administratives.

Voir [configuration et limites](RECOMPENSES-CLOUDFLARE.md), [API](API-RECOMPENSES.md), [procédure du personnel](PROCEDURE-EMPLOYES.md) et [tests](TESTS-RECOMPENSES.md).

La simulation valide la cohérence d’une partie ; elle ne prouve pas qu’un humain a joué. Un téléphone vérifié ne garantit pas l’unicité d’une personne physique. Ces limites et les conditions juridiques doivent être traitées avant l’activation publique. Aucune intégration Lightspeed n’est effectuée.
