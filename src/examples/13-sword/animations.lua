-- Animation keyframes. Edit them here, or with the mouse in Animate mode
-- (mouse edits rewrite this tab in this plain form).
--
--   clip "name" { fps = 12, frames = 24, loop = true }
--   key(part, frame, { pos = { x, y, z }, rot = { x, y, z }, scale = s, interp = "ease" })
--
-- pos is an offset in voxels, rot is in degrees around the part's pivot, scale is a
-- number or { x, y, z }. interp (linear, ease, in, out, step) shapes the motion from
-- this key to the next one. Lua works here too: loops can generate keys.

clip "idle" { fps = 12, frames = 24, loop = true }
key("handle", 0, { pos = { 0, 0, 0 }, rot = { 0, 0, -6 }, interp = "ease" })
key("handle", 12, { pos = { 0, 1, 0 }, rot = { 0, 0, 6 }, interp = "ease" })
key("handle", 24, { pos = { 0, 0, 0 }, rot = { 0, 0, -6 } })

key("gem", 0, { scale = 1, interp = "ease" })
key("gem", 6, { scale = 1.5, interp = "ease" })
key("gem", 12, { scale = 1, interp = "ease" })
key("gem", 18, { scale = 1.5, interp = "ease" })
key("gem", 24, { scale = 1 })

key("flame", 0, { scale = 0 })

clip "slash" { fps = 12, frames = 18, loop = false }
key("handle", 0, { pos = { 0, 0, 0 }, rot = { 0, 0, 0 }, interp = "ease" })
key("handle", 5, { pos = { -2, 1, 0 }, rot = { 0, 0, 50 }, interp = "in" })
key("handle", 8, { pos = { 3, -1, 0 }, rot = { 0, 0, -110 }, interp = "out" })
key("handle", 13, { pos = { 2, -1, 0 }, rot = { 0, 0, -100 }, interp = "ease" })
key("handle", 18, { pos = { 0, 0, 0 }, rot = { 0, 0, 0 } })

key("gem", 6, { scale = 1 })
key("gem", 8, { scale = 1.8, interp = "out" })
key("gem", 12, { scale = 1 })

key("flame", 0, { scale = 0, interp = "step" })
key("flame", 7, { scale = 1.3, interp = "out" })
key("flame", 10, { scale = 1, interp = "ease" })
key("flame", 15, { scale = 0 })
