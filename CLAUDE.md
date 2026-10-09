# Backend (Medusa 2.21, port 9000)

- Logic: `src/lib/cms-*.ts`; API: `src/api/admin/cms/route.ts` (CMS), `src/api/store/tcg/*` (storefront); module `src/modules/tcg-catalog`; jobs `src/jobs`; scripts `src/scripts`.
- `bannedCars-cms/server-module/src` mirrors files from here: sync both when editing shared files.
- Production build runs: `pnpm typecheck && pnpm test`, then `pnpm build` and restart the process (check `lsof -i :9000`).
- Each stock listing = own Medusa product with unique explicit handle. Unpriced new stock = DRAFT + `price_pending`.
- Never let storefront/CMS write DB or mark orders paid. Use workflows/module services for multi-step changes.
- Setup, Scryfall import, image sync, API list: README.md (read the relevant section only). Never read `.env`.
