-- Gem: a glowing stone on the front of the guard. It pulses in both clips.
function voxel(x, y, z)
  if x == 0 and z == 2 and (y == -5 or y == -6) then return RED, GLOW end
end
