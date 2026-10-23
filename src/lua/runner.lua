-- Host-side runner. Executed in a fresh Lua state for every run.
-- Inputs (globals set from JS):
--   __SRC        user script
--   __RADIUS     grid radius
--   __PALETTE    "NAME=rrggbb,NAME=rrggbb,..." in palette order
--   __MATERIALS  "matte,plastic,..." in material-id order
--   __GLASS_ALPHA default opacity for glass
--   __TEXTURES   "name,name,..." texture names (index = position, from 1)
--   __LIMIT      instruction budget
-- Outputs (globals read by JS):
--   __STATUS "ok" | "error"
--   __DATA   "index,rgb,alpha,material,texset,..." for every filled voxel
--   __TEXSETS "t,t,t,t,t,t;..." texture per face (+x,-x,+y,-y,+z,-z; 0 = none) per texset id
--   __COUNT  number of filled voxels
--   __PRINTS print() output joined by "\n"
--   __ERR_KIND, __ERR_MSG, __ERR_LINE, __ERR_AT

local floor, sqrt, type, tostring = math.floor, math.sqrt, type, tostring
local R = __RADIUS
local S = 2 * R + 1
local CUSTOM = 0x1000000 -- marks colors made by rgb()/hex()/hsv()

__STATUS, __DATA, __COUNT, __PRINTS, __TEXSETS = "error", "", 0, "", ""
__ERR_KIND, __ERR_MSG, __ERR_LINE, __ERR_AT = "", "", 0, ""

local prints, nprints = {}, 0
local MAX_PRINTS = 500

-- A marker table so validation errors can be told apart from script errors.
local VoxError = {}
local function voxerror(msg) error(setmetatable({ msg = msg }, VoxError), 0) end

---------------------------------------------------------------------------
-- Sandbox environment
---------------------------------------------------------------------------
local env = {}
for _, k in ipairs { "assert", "error", "ipairs", "next", "pairs", "pcall", "select", "tonumber",
  "tostring", "type", "xpcall", "rawequal", "rawget", "rawset", "rawlen", "setmetatable", "getmetatable" } do
  env[k] = _G[k]
end
local function copy(t) local r = {} for k, v in pairs(t) do r[k] = v end return r end
env.math, env.string, env.table, env.utf8 = copy(math), copy(string), copy(table), copy(utf8)
env.unpack = table.unpack

env.print = function(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
  if nprints < MAX_PRINTS then
    nprints = nprints + 1
    prints[nprints] = table.concat(parts, "\t")
  elseif nprints == MAX_PRINTS then
    nprints = nprints + 1
    prints[nprints] = "... (further output hidden)"
  end
end

for _, k in ipairs { "abs", "floor", "ceil", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan",
  "exp", "log", "min", "max", "fmod", "modf" } do
  env[k] = math[k]
end
env.pi = math.pi
env.huge = math.huge
math.randomseed(1234)
env.random = math.random
env.seed = math.randomseed

env.R, env.SIZE, env.RADIUS = R, S, R

-- Palette constants and lookup
local palette, NPAL, WHITE = {}, 0, nil
for name, hex in string.gmatch(__PALETTE, "([%w_]+)=(%x+)") do
  NPAL = NPAL + 1
  palette[NPAL] = tonumber(hex, 16)
  env[name] = NPAL
  if name == "WHITE" then WHITE = palette[NPAL] end
end

-- Materials: constants are lowercase names
local MATERIAL_ID, GLASS_ID = {}, -1
do
  local i = 0
  for name in string.gmatch(__MATERIALS, "[%w_]+") do
    MATERIAL_ID[name] = i
    env[string.upper(name)] = name
    if name == "glass" then GLASS_ID = i end
    i = i + 1
  end
end

-- Math helpers
function env.len(x, y, z)
  z = z or 0
  return sqrt(x * x + y * y + z * z)
end
function env.dist(x1, y1, z1, x2, y2, z2)
  local dx, dy, dz = x1 - x2, y1 - y2, z1 - z2
  return sqrt(dx * dx + dy * dy + dz * dz)
end
function env.clamp(v, lo, hi)
  if v < lo then return lo elseif v > hi then return hi end
  return v
end
function env.mix(a, b, t) return a + (b - a) * t end
env.lerp = env.mix
function env.round(v) return floor(v + 0.5) end
function env.sign(v) if v > 0 then return 1 elseif v < 0 then return -1 end return 0 end

local function hash3(x, y, z)
  local h = (x * 73856093) ~ (y * 19349663) ~ (z * 83492791)
  h = (h ~ (h >> 13)) * 1274126177
  h = h ~ (h >> 16)
  return (h & 0xffffff) / 16777216
end
local function cell(v) return floor(v) % 65536 end
function env.hash(x, y, z)
  return hash3(cell(x), cell(y or 0), cell(z or 0))
end

local function fade(t) return t * t * t * (t * (t * 6 - 15) + 10) end
local function L(a, b, t) return a + (b - a) * t end
local function noise(x, y, z)
  y, z = y or 0, z or 0
  local xi, yi, zi = floor(x), floor(y), floor(z)
  local u, v, w = fade(x - xi), fade(y - yi), fade(z - zi)
  xi, yi, zi = xi % 65536, yi % 65536, zi % 65536
  local x1, y1, z1 = xi + 1, yi + 1, zi + 1
  return L(
    L(L(hash3(xi, yi, zi), hash3(x1, yi, zi), u), L(hash3(xi, y1, zi), hash3(x1, y1, zi), u), v),
    L(L(hash3(xi, yi, z1), hash3(x1, yi, z1), u), L(hash3(xi, y1, z1), hash3(x1, y1, z1), u), v),
    w)
end
env.noise = noise
function env.fbm(x, y, z, octaves)
  y, z = y or 0, z or 0
  local sum, amp, freq, norm = 0, 1, 1, 0
  for _ = 1, octaves or 4 do
    sum = sum + noise(x * freq, y * freq, z * freq) * amp
    norm = norm + amp
    amp, freq = amp * 0.5, freq * 2
  end
  return sum / norm
end

-- Color helpers
local function byte(v, fname)
  if type(v) ~= "number" then error(fname .. " expects numbers, got " .. type(v), 3) end
  if v ~= v then return 0 end
  v = floor(v + 0.5)
  if v < 0 then return 0 elseif v > 255 then return 255 end
  return v
end
function env.rgb(r, g, b)
  return CUSTOM + (byte(r, "rgb") << 16) + (byte(g, "rgb") << 8) + byte(b, "rgb")
end
function env.hex(v)
  if type(v) == "string" then
    local n = tonumber((v:gsub("^#", "")), 16)
    if not n then error("hex(): '" .. v .. "' is not a hex color like \"#ff8800\"", 2) end
    v = n
  end
  if type(v) ~= "number" then error("hex() expects a number or a string", 2) end
  return CUSTOM + (floor(v) & 0xffffff)
end
function env.hsv(h, s, v)
  s, v = s or 1, v or 1
  h = (h % 1) * 6
  local i = floor(h)
  local f = h - i
  local p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
  local r, g, b
  if i == 0 then r, g, b = v, t, p
  elseif i == 1 then r, g, b = q, v, p
  elseif i == 2 then r, g, b = p, v, t
  elseif i == 3 then r, g, b = p, q, v
  elseif i == 4 then r, g, b = t, p, v
  else r, g, b = v, p, q end
  return env.rgb(r * 255, g * 255, b * 255)
end

-- Textures. tex() returns a marker object naming a "texset": which texture
-- goes on each of the 6 faces. Identical texsets share one id.
local TexMark = {}
local TEX_ID, texNames = {}, {}
for name in string.gmatch(__TEXTURES, "[%w_]+") do
  texNames[#texNames + 1] = name
  TEX_ID[name] = #texNames
end
local texsets, texsetId, texCache = {}, {}, {}
-- Face order matches the mesher: +x (east), -x (west), +y (top), -y (bottom), +z (south), -z (north)
local FACE_KEYS = {
  all = { 1, 2, 3, 4, 5, 6 }, side = { 1, 2, 5, 6 }, top = { 3 }, bottom = { 4 },
  east = { 1 }, west = { 2 }, south = { 5 }, north = { 6 },
}
local FACE_PRIORITY = { "all", "side", "top", "bottom", "east", "west", "south", "north" }

local function texId(name)
  if type(name) ~= "string" then error("texture names are text, like tex(\"brick\")", 3) end
  local id = TEX_ID[name]
  if not id then error("unknown texture '" .. name .. "'. Add it in the Textures panel", 3) end
  return id
end

local function texsetOf(faces)
  local key = table.concat(faces, ",")
  local id = texsetId[key]
  if not id then
    texsets[#texsets + 1] = key
    id = #texsets
    texsetId[key] = id
  end
  return setmetatable({ set = id }, TexMark)
end

function env.tex(spec)
  if type(spec) == "string" then
    local cached = texCache[spec]
    if cached then return cached end
    local id = texId(spec)
    cached = texsetOf({ id, id, id, id, id, id })
    texCache[spec] = cached
    return cached
  end
  if type(spec) ~= "table" then
    error("tex() expects a texture name or a table like { top = \"grass_top\", side = \"dirt\" }", 2)
  end
  for k in pairs(spec) do
    if not FACE_KEYS[k] then
      error("tex{}: unknown face '" .. tostring(k) .. "' (use all, side, top, bottom, north, south, east, west)", 2)
    end
  end
  local faces = { 0, 0, 0, 0, 0, 0 }
  for _, key in ipairs(FACE_PRIORITY) do
    if spec[key] ~= nil then
      local id = texId(spec[key])
      for _, f in ipairs(FACE_KEYS[key]) do faces[f] = id end
    end
  end
  return texsetOf(faces)
end

-- Reading an undefined global is almost always a typo (REDD, MEATL, ...).
setmetatable(env, {
  __index = function(_, k)
    error("unknown name '" .. tostring(k) .. "'", 2)
  end,
})

---------------------------------------------------------------------------
-- Error reporting
---------------------------------------------------------------------------
local function lineOf(msg, tb)
  local line = msg:match("^script:(%d+):")
  if not line and tb then line = tb:match("script:(%d+):") end
  return tonumber(line) or 0
end
local function clean(msg)
  msg = msg:gsub("^script:%d+: ", "")
  return (msg:gsub("^%[string .-%]:%d+: ", ""))
end

local function handler(e)
  if getmetatable(e) == VoxError then return e end
  return { msg = tostring(e), tb = debug.traceback("", 2) }
end

local function fail(kind, e, at)
  __STATUS = "error"
  __ERR_KIND = kind
  __ERR_LINE = lineOf(e.msg, e.tb)
  __ERR_MSG = clean(e.msg)
  __ERR_AT = at or ""
  __PRINTS = table.concat(prints, "\n")
end

-- Instruction budget: stops infinite loops with a line number.
local hooks, maxHooks = 0, __LIMIT // 1000
debug.sethook(function()
  hooks = hooks + 1
  if hooks > maxHooks then
    error("script ran too long and was stopped (infinite loop?)", 2)
  end
end, "", 1000)

---------------------------------------------------------------------------
-- Run
---------------------------------------------------------------------------
local chunk, cerr = load(__SRC, "=script", "t", env)
if not chunk then
  fail("compile", { msg = cerr })
  debug.sethook()
  return
end

local ok, e = xpcall(chunk, handler)
if not ok then
  fail("runtime", e)
  debug.sethook()
  return
end

local voxel = rawget(env, "voxel")
if type(voxel) ~= "function" then
  fail("api", { msg = "define  function voxel(x, y, z)  and return a color from it" })
  debug.sethook()
  return
end

local function resolveColor(c)
  local t = type(c)
  if t == "number" then
    if c == 0 then return nil end
    local i = math.tointeger(c)
    if not i then voxerror("color " .. tostring(c) .. " is not a whole number") end
    if i >= CUSTOM then return i - CUSTOM end
    if i >= 1 and i <= NPAL then return palette[i] end
    if i > NPAL and i <= 0xffffff then
      voxerror(("color %d is not in the palette (1-%d). For hex colors use hex(0x%06x)"):format(i, NPAL, i))
    end
    voxerror("color " .. tostring(c) .. " is not in the palette (1-" .. NPAL .. ")")
  elseif t == "string" then
    local n = c:match("^#(%x%x%x%x%x%x)$")
    if not n then voxerror("'" .. c .. "' is not a color. Use a palette name, rgb(), hex() or \"#rrggbb\"") end
    return tonumber(n, 16)
  elseif c == true then
    return WHITE
  end
  voxerror("expected a color, got a " .. t)
end

local out, n, count = {}, 0, 0
local cx, cy, cz = 0, 0, 0

-- Extra return values (opacity, material, texture) can come in any order.
local alpha, mat, texset
local function extra(v)
  if v == nil then return end
  local t = type(v)
  if t == "number" then
    if alpha ~= nil then voxerror("two opacity values returned") end
    alpha = v
  elseif t == "string" then
    if mat ~= nil then voxerror("two materials returned") end
    mat = v
  elseif getmetatable(v) == TexMark then
    if texset ~= nil then voxerror("two textures returned") end
    texset = v.set
  else
    voxerror("expected an opacity (0-1), a material or a tex(), got a " .. t)
  end
end

local function emit(a, b, c, d)
  local col
  alpha, mat, texset = nil, nil, nil
  if getmetatable(a) == TexMark then
    col = "#ffffff" -- texture alone: untinted
    texset = a.set
    extra(b); extra(c); extra(d)
  elseif type(a) == "table" then
    col = a[1] or a.color or "#ffffff"
    if getmetatable(col) == TexMark then texset = col.set; col = "#ffffff" end
    alpha = a.alpha or a.opacity
    mat = a.mat or a.material
    if a.tex ~= nil then
      if getmetatable(a.tex) ~= TexMark then voxerror("tex = ... must be a tex()") end
      texset = a.tex.set
    end
    extra(a[2]); extra(a[3]); extra(a[4])
  else
    col = a
    extra(b); extra(c); extra(d)
  end
  local rgb = resolveColor(col)
  if not rgb then return end
  local m = 0
  if mat ~= nil then
    m = MATERIAL_ID[mat]
    if not m then voxerror("unknown material '" .. tostring(mat) .. "'") end
  end
  if alpha == nil then alpha = (m == GLASS_ID) and __GLASS_ALPHA or 1 end
  if alpha ~= alpha or alpha < 0 or alpha > 1 then
    voxerror("opacity must be between 0 and 1, got " .. tostring(alpha))
  end
  local a8 = floor(alpha * 255 + 0.5)
  if a8 == 0 then return end
  out[n + 1] = (cz + R) * S * S + (cy + R) * S + (cx + R)
  out[n + 2] = rgb
  out[n + 3] = a8
  out[n + 4] = m
  out[n + 5] = texset or 0
  n = n + 5
  count = count + 1
end

local function loop()
  for z = -R, R do
    cz = z
    for y = -R, R do
      cy = y
      for x = -R, R do
        cx = x
        local a, b, c, d = voxel(x, y, z)
        if a ~= nil and a ~= false and a ~= 0 then emit(a, b, c, d) end
      end
    end
  end
end

ok, e = xpcall(loop, handler)
debug.sethook()
if not ok then
  local at = cx .. "," .. cy .. "," .. cz
  if getmetatable(e) == VoxError then
    fail("return", { msg = e.msg }, at)
    -- No line for a bad return value: point at the voxel() definition instead.
    __ERR_LINE = debug.getinfo(voxel, "S").linedefined
  else
    fail("runtime", e, at)
    -- "return f()" is a tail call, which drops voxel()'s line from the trace.
    if __ERR_LINE == 0 then __ERR_LINE = debug.getinfo(voxel, "S").linedefined end
  end
  return
end

__STATUS = "ok"
__DATA = table.concat(out, ",")
__TEXSETS = table.concat(texsets, ";")
__COUNT = count
__PRINTS = table.concat(prints, "\n")
