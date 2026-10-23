-- Start here: how scripts work, in 15 lines
--
-- voxel(x, y, z) runs once for every cell of the grid.
-- x, y and z go from -R to R, and y points up.
-- Return a color to fill the cell, or nothing to leave it empty:
--
--   return RED                -- palette color (hover a name to see it)
--   return rgb(255, 128, 0)   -- any color
--   return GREEN, 0.5         -- 50% opacity
--   return BLUE, METAL        -- material
--   return CYAN, 0.4, GLASS   -- both
--
-- Edit a number below: the model updates as you type.

RADIUS = 8

function voxel(x, y, z)
  if len(x, y, z) <= 7 then
    if y > 2 then return RED end
    if y < -2 then return BLUE end
    return WHITE
  end
end
