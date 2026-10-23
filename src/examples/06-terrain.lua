-- Island terrain from fbm() noise, with see-through water
RADIUS = 16
local WATER = -6

function voxel(x, y, z)
  local d = len(x, z)
  if d > 15.5 then return nil end               -- keep everything round

  -- height of the ground at this (x, z) column
  local h = floor((fbm(x / 8, 3, z / 8, 4) - 0.5) * 26)
  -- sink the edges so it becomes an island
  h = h - floor(max(0, d - 5) * 0.9)

  if y > h then
    if y <= WATER then return BLUE, 0.45, GLASS end
    return nil
  end

  if h <= WATER + 1 then return TAN end         -- beach
  if y >= 4 then return WHITE end               -- snow
  if y == h then return GREEN end               -- grass on top
  if y > h - 3 then return BROWN end            -- dirt
  return GRAY                                   -- rock
end
