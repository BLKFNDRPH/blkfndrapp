-- A fourth kind of admin: the platform administrator.
--
-- Owners hold a share and vote. The three job roles do one thing each: review
-- KYC, moderate projects, read the books. The platform administrator is the
-- operational hand — banning abusive users, watching the platform's health —
-- without a share and without a vote. Adding one is a hiring decision, not a
-- financial one, which is the whole reason the roster separates role from stake.
alter type admin_role add value if not exists 'platform_admin';
