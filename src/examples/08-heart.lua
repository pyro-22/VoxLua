-- A heart from an implicit equation (fill where the formula is <= 0)
RADIUS = 10

function voxel(x, y, z)
  local s = 1 / 8
  local X, Y, Z = x * s, z * s, (y + 1) * s     -- the formula has Z pointing up
  local a = X * X + 2.25 * Y * Y + Z * Z - 1
  if a * a * a - X * X * Z * Z * Z - 0.1125 * Y * Y * Z * Z * Z <= 0 then
    return PINK, PLASTIC
  end
end
