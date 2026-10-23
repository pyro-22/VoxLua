-- Opacity: see-through shells around a solid core, with a slice cut away
RADIUS = 10

function voxel(x, y, z)
  if x > 0 and z > 0 then return nil end   -- cut out a quarter to look inside

  local d = len(x, y, z)
  if d <= 3 then return YELLOW, GLOW end
  if d > 4.5 and d <= 5.5 then return ORANGE, 0.6 end
  if d > 7 and d <= 8 then return RED, 0.25 end
end
