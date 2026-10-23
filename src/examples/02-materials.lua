-- One sphere per material: matte, plastic, metal, chrome, glass, glow
RADIUS = 10

local items = {
  { -6, -3.5, ORANGE, MATTE },
  {  0, -3.5, RED,    PLASTIC },
  {  6, -3.5, GRAY,   METAL },
  { -6,  3.5, WHITE,  CHROME },
  {  0,  3.5, CYAN,   GLASS },
  {  6,  3.5, YELLOW, GLOW },
}

function voxel(x, y, z)
  -- floor tiles
  if y == -R and abs(x) <= 9 and abs(z) <= 7 then
    if (x + z) % 2 == 0 then return DARK_GRAY end
    return GRAY
  end
  for _, it in ipairs(items) do
    if dist(x, y, z, it[1], -6.5, it[2]) <= 2.6 then
      return it[3], it[4]
    end
  end
end
