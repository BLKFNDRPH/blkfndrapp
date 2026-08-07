-- Where a project is physically based, so a listing can be pinned on a map.
--
-- Descriptive rather than financial, so it lives here and in the IPFS metadata
-- rather than on chain: the vault has no opinion about geography, and putting a
-- mutable address in an immutable contract would be the wrong trade.
--
-- The indexer owns these columns. It resolves them from the creator's pinned
-- metadata, which means the value is creator-supplied and should be treated as
-- a claim about location, not proof of one.

alter table public.projects
  add column if not exists location text not null default '';

-- Optional coordinates. Kept separate from the text so a listing can be pinned
-- precisely when the creator supplies a point, and still fall back to a plain
-- address search when they only type one. Nullable rather than defaulted,
-- because 0,0 is a real place in the Gulf of Guinea and would silently pin
-- every location-less project there.
alter table public.projects
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision;

-- Either both coordinates are present or neither is. A half-set point cannot be
-- rendered and would otherwise have to be guarded at every read site.
alter table public.projects
  drop constraint if exists projects_location_point_complete;

alter table public.projects
  add constraint projects_location_point_complete
  check (
    (location_lat is null and location_lng is null)
    or (location_lat is not null and location_lng is not null)
  );

-- Latitude and longitude have hard bounds; a value outside them is bad data,
-- not an unusual place.
alter table public.projects
  drop constraint if exists projects_location_within_bounds;

alter table public.projects
  add constraint projects_location_within_bounds
  check (
    location_lat is null
    or (location_lat between -90 and 90 and location_lng between -180 and 180)
  );

comment on column public.projects.location is
  'Creator-supplied place description, resolved from IPFS metadata by the indexer.';
comment on column public.projects.location_lat is
  'Optional latitude. Set only together with location_lng.';
