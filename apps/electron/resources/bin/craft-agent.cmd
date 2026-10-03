@echo off
set "CRAFT_BUN_BIN=%CRAFT_BUN%"
if "%CRAFT_BUN_BIN%"=="" set "CRAFT_BUN_BIN=bun"
set "CRAFT_COMMANDS_BIN=%CRAFT_COMMANDS_ENTRY%"
if "%CRAFT_COMMANDS_BIN%"=="" set "CRAFT_COMMANDS_BIN=%CRAFT_CLI_ENTRY%"
if "%CRAFT_COMMANDS_BIN%"=="" goto unavailable
if not exist "%CRAFT_COMMANDS_BIN%" goto unavailable
if "%CRAFT_CLI_JSON_ONLY%"=="" set "CRAFT_CLI_JSON_ONLY=1"
"%CRAFT_BUN_BIN%" run "%CRAFT_COMMANDS_BIN%" %*

exit /b %errorlevel%
:unavailable
echo ROX does not bundle a configuration CLI. Use the ROX application interfaces or available session configuration tools. An explicit existing CRAFT_COMMANDS_ENTRY is required. 1>&2
exit /b 69
