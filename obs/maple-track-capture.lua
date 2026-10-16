-- Maple Track OBS capture timer
-- Calls a tiny local Node helper every 10 seconds. The helper asks OBS
-- obs-websocket for a source screenshot and forwards it to the tracker.
local obs = obslua
local source_name = ""
local helper_url = "http://127.0.0.1:8787/capture"
local interval_seconds = 10
local running = false
local tick_count = 0

local function url_encode(value)
    return (value:gsub("([^%w%-_%.~])", function(char)
        return string.format("%%%02X", string.byte(char))
    end))
end

function script_description()
    return "Requests a local Maple Track screenshot from the configured OBS source every 10 seconds. Requires maple-track-obs-bridge.js to be running."
end

function script_properties()
    local props = obs.obs_properties_create()
    local sources = obs.obs_properties_add_list(props, "source_name", "OBS source to sample", obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
    obs.obs_property_list_add_string(sources, "Select a source…", "")
    local inputs = obs.obs_enum_inputs()
    if inputs ~= nil then
        for _, input in ipairs(inputs) do
            obs.obs_property_list_add_string(sources, input, input)
        end
        obs.source_list_release(inputs)
    end
    obs.obs_properties_add_text(props, "helper_url", "Local bridge URL", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_int(props, "interval_seconds", "Capture interval (seconds)", 10, 3600, 5)
    obs.obs_properties_add_button(props, "toggle", running and "Stop capture timer" or "Start capture timer", toggle_timer)
    return props
end

function script_defaults(settings)
    obs.obs_data_set_default_string(settings, "source_name", "")
    obs.obs_data_set_default_string(settings, "helper_url", "http://127.0.0.1:8787/capture")
    obs.obs_data_set_default_int(settings, "interval_seconds", 10)
end

function script_update(settings)
    source_name = obs.obs_data_get_string(settings, "source_name")
    helper_url = obs.obs_data_get_string(settings, "helper_url")
    interval_seconds = math.max(10, obs.obs_data_get_int(settings, "interval_seconds"))
end

function toggle_timer(props, property)
    running = not running
    tick_count = 0
    if running then
        obs.timer_add(capture_tick, interval_seconds * 1000)
        obs.script_log(obs.LOG_INFO, "Maple Track capture timer started for source: " .. (source_name ~= "" and source_name or "(none)"))
    else
        obs.timer_remove(capture_tick)
        obs.script_log(obs.LOG_INFO, "Maple Track capture timer stopped")
    end
    return true
end

function capture_tick()
    if not running then return end
    if source_name == "" then
        obs.script_log(obs.LOG_WARNING, "Maple Track: choose an OBS source in the script settings")
        return
    end
    tick_count = tick_count + 1
    local separator = helper_url:find("?", 1, true) and "&" or "?"
    local url = helper_url .. separator .. "source=" .. url_encode(source_name) .. "&timestamp=" .. tostring(os.time())
    local command
    if package.config:sub(1, 1) == "\\" then
        command = 'start "" /b curl.exe -s -X POST "' .. url .. '" >NUL 2>NUL'
    else
        command = 'curl -s -X POST "' .. url .. '" >/dev/null 2>&1 &'
    end
    local ok = os.execute(command)
    if ok ~= 0 and ok ~= true then
        obs.script_log(obs.LOG_WARNING, "Maple Track: failed to invoke local capture bridge")
    else
        obs.script_log(obs.LOG_INFO, "Maple Track: requested capture #" .. tostring(tick_count) .. " from " .. source_name)
    end
end

function script_load(settings)
    script_update(settings)
end

function script_unload()
    if running then obs.timer_remove(capture_tick) end
    running = false
end
