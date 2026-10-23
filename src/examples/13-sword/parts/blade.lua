-- Blade: chrome edges around a metal core, tapering to a point.
-- Child of the handle; the flame is its child.
function voxel(x, y, z)
  if z ~= 0 or y < -4 or y > 10 then return nil end
  local half = y <= 8 and 1 or 0          -- 3 wide, then 1 wide at the tip
  if abs(x) > half then return nil end
  if abs(x) == 1 or y >= 9 then return WHITE, CHROME end
  return GRAY, METAL
end
