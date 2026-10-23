-- A donut colored all the way around with hsv()
RADIUS = 12
local MAJOR, MINOR = 8, 3     -- ring radius, tube radius

function voxel(x, y, z)
  local q = len(x, z) - MAJOR           -- distance from the ring's center line
  if len(q, y) <= MINOR then
    local angle = atan(z, x)            -- -pi..pi around the ring
    return hsv(angle / (2 * pi), 0.75, 1), PLASTIC
  end
end
