-- A random city block: hash() gives each building its own height
RADIUS = 12

function voxel(x, y, z)
  if y == -R then return DARK_GRAY end            -- ground

  -- 5x5 lots: one row of street, then a 4x4 building
  local lx, lz = (x + R) % 5, (z + R) % 5
  if lx == 0 or lz == 0 then return nil end

  local bx, bz = (x + R) // 5, (z + R) // 5
  local top = floor(hash(bx, 0, bz) * 16) + 3 - R
  if y > top then return nil end

  local wall = lx == 1 or lx == 4 or lz == 1 or lz == 4
  local corner = (lx == 1 or lx == 4) and (lz == 1 or lz == 4)
  if wall and not corner and y % 2 == 0 and y < top then
    if hash(x, y, z) > 0.55 then return YELLOW, GLOW end   -- lit window
    return NAVY, 0.7, GLASS                                -- dark window
  end

  return hsv(hash(bx, 1, bz), 0.12, 0.85)
end
