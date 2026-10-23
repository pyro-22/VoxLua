-- Textures: a cottage built from the built-in pixel-art textures
--
--   return tex("brick")                      -- one texture on all 6 faces
--   return tex{ top = "grass_top", side = "grass_side", bottom = "dirt" }
--   return RED, tex("stone")                 -- tint a texture with a color
--
-- Faces: all, side, top, bottom, north (-z), south (+z), east (+x), west (-x)
-- Add your own PNGs in the Textures panel, or drop them on the window.
RADIUS = 10

local GRASS  = tex{ top = "grass_top", side = "grass_side", bottom = "dirt" }
local BRICK  = tex("brick")
local PLANKS = tex("planks")
local LOG    = tex{ top = "log_top", bottom = "log_top", side = "log_side" }
local LEAVES = tex("leaves")   -- has transparent pixels, so it gets holes
local STONE  = tex("stone")

function voxel(x, y, z)
  if y == -R then return GRASS end                         -- ground

  -- chimney (before the roof, so it pokes through)
  if x == -4 and z == -2 and y >= -4 and y <= 1 then return STONE end

  -- walls: a hollow box with a door and glass windows
  if x >= -6 and x <= 2 and z >= -4 and z <= 4 and y >= -9 and y <= -5 then
    local onWall = x == -6 or x == 2 or z == -4 or z == 4
    if not onWall then return nil end
    if z == 4 and x == -2 and y <= -8 then return nil end              -- door
    if (x == -6 or x == 2) and abs(z) <= 1 and y == -7 then
      return CYAN, 0.35, GLASS                                         -- windows
    end
    if (x == -6 or x == 2) and (z == -4 or z == 4) then return LOG end -- corners
    return BRICK
  end

  -- roof: two layers thick, sloping down towards ±z
  local k = y + 4                 -- 0 at the bottom edge of the roof
  local edge = 5 - k
  if k >= 0 and k <= 5 and x >= -7 and x <= 3 then
    if abs(z) <= edge and abs(z) >= edge - 1 then return PLANKS end
    if (x == -6 or x == 2) and abs(z) < edge - 1 then return BRICK end -- gable walls
  end

  -- a tree
  if x == 6 and z == -2 and y >= -9 and y <= -4 then return LOG end
  if dist(x, y, z, 6, -3, -2) <= 2.6 then return LEAVES end
end
