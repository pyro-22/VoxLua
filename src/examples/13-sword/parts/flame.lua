-- Flame: a see-through glowing shell around the blade, shaped with noise.
-- It is scaled to 0 (hidden) until the strike of the slash clip.
function voxel(x, y, z)
  if y < -3 or y > 12 then return nil end
  local d = max(abs(x), abs(z))
  if d < 2 or d > 3 then return nil end          -- around the blade, not inside it
  local heat = noise(x / 2, y / 3, z / 2) - (y + 3) / 40
  if heat > 0.5 then return YELLOW, GLOW, 0.5 end
  if heat > 0.3 then return ORANGE, GLOW, 0.35 end
end
