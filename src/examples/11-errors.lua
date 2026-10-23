-- Error handling: remove the "--" from ONE line in voxel() to see the report
--
-- Errors underline the line in red, show the message in the console and
-- the status bar, and say which cell was being computed. The last working
-- model stays on screen.
RADIUS = 4

function voxel(x, y, z)
  local color, opacity, material = GREEN, 1, MATTE

  -- color = REDD               -- typo: unknown name 'REDD'
  -- opacity = 2                -- opacity must be between 0 and 1
  -- material = "wood"          -- unknown material 'wood'
  -- color = 99                 -- 99 is not in the palette
  -- color = RED + nil          -- arithmetic on a nil value
  -- while true do end          -- infinite loop: stopped with its line number

  if max(abs(x), abs(y), abs(z)) <= 3 then
    return color, opacity, material
  end
end
