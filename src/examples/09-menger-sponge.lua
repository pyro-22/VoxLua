-- Menger sponge: a fractal made by removing the middle of every 3x3x3 block
RADIUS = 13   -- 27 cells wide = 3 x 3 x 3

function voxel(x, y, z)
  local a, b, c = x + 13, y + 13, z + 13      -- shift to 0..26
  for _ = 1, 3 do
    local middles = 0
    if a % 3 == 1 then middles = middles + 1 end
    if b % 3 == 1 then middles = middles + 1 end
    if c % 3 == 1 then middles = middles + 1 end
    if middles >= 2 then return nil end       -- the holes
    a, b, c = a // 3, b // 3, c // 3
  end
  return hsv((x + y + z) / 90 + 0.55, 0.45, 1), METAL
end
