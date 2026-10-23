-- A little mushroom character
RADIUS = 10

function voxel(x, y, z)
  -- grass disc
  if y == -R then
    if len(x, z) <= 8 then return GREEN end
    return nil
  end

  -- eyes on the front of the stem
  if y == -4 and (x == -1 or x == 1) and z == 2 then return BLACK end

  -- stem
  if y <= 0 and len(x, z) <= 2.5 then return TAN end

  -- cap: the top half of a squashed sphere
  local cy = y - 1
  if cy >= 0 then
    local d = (x * x + z * z) / 64 + (cy * cy) / 36
    if d <= 1 then
      -- white spots on the outer layer
      if d > 0.72 and hash(floor(x / 3), floor(cy / 3), floor(z / 3)) > 0.62 then
        return WHITE
      end
      return RED, PLASTIC
    end
  end
end
