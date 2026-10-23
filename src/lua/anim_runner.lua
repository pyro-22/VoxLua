-- Parses the Animation tab. Executed in a fresh Lua state.
-- Inputs:  __SRC (the tab's text), __LIMIT (instruction budget)
-- Outputs: __STATUS "ok" | "error", __JSON (clips as JSON), __ERR_MSG, __ERR_LINE

local floor, type, tostring = math.floor, type, tostring
__STATUS, __JSON, __ERR_MSG, __ERR_LINE = "error", "", "", 0

local INTERP = { linear = true, ease = true, ["in"] = true, out = true, step = true }
local clips, current = {}, nil

local env = {}
for _, k in ipairs { "assert", "error", "ipairs", "next", "pairs", "pcall", "select", "tonumber", "tostring", "type" } do
  env[k] = _G[k]
end
for _, k in ipairs { "abs", "floor", "ceil", "sqrt", "sin", "cos", "tan", "atan", "min", "max", "exp", "log" } do
  env[k] = math[k]
end
env.math, env.string, env.table = math, string, table
env.pi = math.pi

local function isName(s) return type(s) == "string" and s:match("^[%w_]+$") ~= nil end
local function isNum(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end

local function vec3(v, what)
  if type(v) ~= "table" or not (isNum(v[1]) and isNum(v[2]) and isNum(v[3])) then
    error(what .. " must be three numbers, like { 0, 2, 0 }", 3)
  end
  return { v[1], v[2], v[3] }
end

function env.clip(name, opts)
  if not isName(name) then error("clip names use letters, digits and _, like clip \"walk\"", 2) end
  current = { name = name, fps = 12, frames = 24, loop = true, keys = {} }
  clips[#clips + 1] = current
  local clip = current
  local function apply(o)
    if type(o) ~= "table" then error("clip options go in braces: clip \"" .. name .. "\" { fps = 12, frames = 24 }", 2) end
    if o.fps ~= nil then
      if not isNum(o.fps) or o.fps <= 0 or o.fps > 120 then error("fps must be between 1 and 120", 2) end
      clip.fps = o.fps
    end
    if o.frames ~= nil then
      if math.tointeger(o.frames) == nil or o.frames < 1 or o.frames > 10000 then error("frames must be a whole number from 1 to 10000", 2) end
      clip.frames = math.tointeger(o.frames)
    end
    if o.loop ~= nil then clip.loop = o.loop and true or false end
  end
  if opts ~= nil then apply(opts) end
  return apply
end

function env.key(part, frame, props)
  if not current then error("call clip \"name\" { ... } before key()", 2) end
  if not isName(part) then error("key(): the part name must be text, like key(\"arm\", 0, { ... })", 2) end
  local f = math.tointeger(frame)
  if f == nil or f < 0 then error("key(): the frame must be a whole number from 0 up", 2) end
  if type(props) ~= "table" then error("key(): properties go in braces, like { rot = { 0, 0, 45 } }", 2) end
  local k = { part = part, frame = f }
  for name, v in pairs(props) do
    if name == "pos" then k.pos = vec3(v, "pos")
    elseif name == "rot" then k.rot = vec3(v, "rot")
    elseif name == "scale" then
      if isNum(v) then k.scale = v else k.scale = vec3(v, "scale") end
    elseif name == "interp" then
      if not INTERP[v] then error("interp must be linear, ease, in, out or step", 2) end
      k.interp = v
    else
      error("key(): unknown property '" .. tostring(name) .. "' (use pos, rot, scale, interp)", 2)
    end
  end
  -- A later key on the same part and frame merges into the earlier one.
  for _, o in ipairs(current.keys) do
    if o.part == part and o.frame == f then
      for name, v in pairs(k) do o[name] = v end
      return
    end
  end
  current.keys[#current.keys + 1] = k
end

setmetatable(env, { __index = function(_, k) error("unknown name '" .. tostring(k) .. "'", 2) end })

-- JSON output (the data is simple: names are [%w_]+, numbers are finite)
local function jnum(n)
  if math.tointeger(n) then return tostring(math.tointeger(n)) end
  return string.format("%.6g", n)
end
local function jvec(v) return "[" .. jnum(v[1]) .. "," .. jnum(v[2]) .. "," .. jnum(v[3]) .. "]" end
local function jkey(k)
  local parts = { '"part":"' .. k.part .. '"', '"frame":' .. k.frame }
  if k.pos then parts[#parts + 1] = '"pos":' .. jvec(k.pos) end
  if k.rot then parts[#parts + 1] = '"rot":' .. jvec(k.rot) end
  if k.scale then parts[#parts + 1] = '"scale":' .. (type(k.scale) == "table" and jvec(k.scale) or jnum(k.scale)) end
  if k.interp then parts[#parts + 1] = '"interp":"' .. k.interp .. '"' end
  return "{" .. table.concat(parts, ",") .. "}"
end

local hooks = 0
debug.sethook(function()
  hooks = hooks + 1
  if hooks > __LIMIT // 1000 then error("the Animation tab ran too long and was stopped (infinite loop?)", 2) end
end, "", 1000)

local chunk, cerr = load(__SRC, "=animation", "t", env)
local ok, err
if chunk then
  ok, err = xpcall(chunk, function(e) return { msg = tostring(e), tb = debug.traceback("", 2) } end)
else
  ok, err = false, { msg = cerr }
end
debug.sethook()

if not ok then
  local line = err.msg:match("^animation:(%d+):") or (err.tb and err.tb:match("animation:(%d+):"))
  __ERR_LINE = tonumber(line) or 0
  __ERR_MSG = (err.msg:gsub("^animation:%d+: ", ""):gsub("^%[string .-%]:%d+: ", ""))
  return
end

local out = {}
for i, c in ipairs(clips) do
  local keys = {}
  for j, k in ipairs(c.keys) do keys[j] = jkey(k) end
  out[i] = '{"name":"' .. c.name .. '","fps":' .. jnum(c.fps) .. ',"frames":' .. c.frames ..
    ',"loop":' .. tostring(c.loop) .. ',"keys":[' .. table.concat(keys, ",") .. "]}"
end
__JSON = '{"clips":[' .. table.concat(out, ",") .. "]}"
__STATUS = "ok"
