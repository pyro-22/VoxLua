-- Handle: grip, guard and pommel. It is the root part: the blade and the gem
-- are its children (gear icon on each tab), so they follow when it moves.
RADIUS = 12

function voxel(x, y, z)
  -- grip, wrapped in two leather colors
  if x == 0 and z == 0 and y >= -11 and y <= -7 then
    if y % 2 == 0 then return BROWN end
    return TAN
  end
  -- pommel
  if y == -12 and abs(x) <= 1 and abs(z) <= 1 then return YELLOW, METAL end
  -- guard, with gold tips
  if y >= -6 and y <= -5 and abs(x) <= 4 and abs(z) <= 1 then
    if abs(x) == 4 then return YELLOW, METAL end
    return GRAY, METAL
  end
end
