-- A glass box with a metal frame and a glowing core
RADIUS = 8

function voxel(x, y, z)
  local ax, ay, az = abs(x), abs(y), abs(z)

  if max(ax, ay, az) == 7 then
    -- count how many coordinates sit on the outer shell: 2 or more = an edge
    local onEdge = 0
    if ax == 7 then onEdge = onEdge + 1 end
    if ay == 7 then onEdge = onEdge + 1 end
    if az == 7 then onEdge = onEdge + 1 end
    if onEdge >= 2 then return GRAY, METAL end
    return CYAN, 0.2, GLASS
  end

  if len(x, y, z) <= 3.5 then return ORANGE, GLOW end
end
