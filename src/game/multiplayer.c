#include "multiplayer.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>

// IPC state
static bool mp_active = false;
static MultiplayerSession mp_session = {0};
static HANDLE pipe_handle = INVALID_HANDLE_VALUE;
static char current_turn_player[64] = {0};
static bool is_my_turn = false;

// Callbacks
static mp_turn_start_callback on_turn_start = NULL;
static mp_remote_action_callback on_remote_action = NULL;
static mp_player_state_callback on_player_state = NULL;

// Message buffer
#define MSG_BUFFER_SIZE 4096
static char msg_buffer[MSG_BUFFER_SIZE];
static int msg_buffer_pos = 0;

// Forward declarations
static bool connect_to_pipe(const char* pipe_name);
static void disconnect_pipe(void);
static bool send_message(const char* json);
static bool receive_messages(void);
static void process_message(const char* json);

bool mp_init(int argc, char** argv) {
    // Parse command line for multiplayer flags
    bool has_multiplayer_flag = false;
    const char* pipe_name = NULL;
    const char* session_id = NULL;
    const char* participant_id = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-multiplayer") == 0) {
            has_multiplayer_flag = true;
        } else if (strcmp(argv[i], "-pipe") == 0 && i + 1 < argc) {
            pipe_name = argv[++i];
        } else if (strcmp(argv[i], "-session") == 0 && i + 1 < argc) {
            session_id = argv[++i];
        } else if (strcmp(argv[i], "-player") == 0 && i + 1 < argc) {
            participant_id = argv[++i];
        }
    }

    if (!has_multiplayer_flag) {
        OutputDebugStringA("Multiplayer: Not running in multiplayer mode\n");
        return false;
    }

    if (!pipe_name || !session_id || !participant_id) {
        OutputDebugStringA("Multiplayer: Missing required arguments\n");
        return false;
    }

    // Store session info
    strncpy(mp_session.pipe_name, pipe_name, sizeof(mp_session.pipe_name) - 1);
    strncpy(mp_session.session_id, session_id, sizeof(mp_session.session_id) - 1);
    strncpy(mp_session.participant_id, participant_id, sizeof(mp_session.participant_id) - 1);

    // Connect to launcher pipe
    if (!connect_to_pipe(pipe_name)) {
        OutputDebugStringA("Multiplayer: Failed to connect to launcher\n");
        return false;
    }

    mp_active = true;

    // Send ready message
    char ready_msg[256];
    snprintf(ready_msg, sizeof(ready_msg),
        "{\"type\":\"ready\",\"participantId\":\"%s\"}",
        mp_session.participant_id);
    send_message(ready_msg);

    OutputDebugStringA("Multiplayer: Initialized successfully\n");
    return true;
}

void mp_exit(void) {
    if (mp_active) {
        disconnect_pipe();
        mp_active = false;
    }
}

bool mp_is_active(void) {
    return mp_active;
}

bool mp_is_my_turn(void) {
    return mp_active && is_my_turn;
}

const MultiplayerSession* mp_get_session(void) {
    return mp_active ? &mp_session : NULL;
}

void mp_send_state(const PlayerState* state) {
    if (!mp_active || !state) return;

    char json[512];
    snprintf(json, sizeof(json),
        "{\"type\":\"state-update\","
        "\"participantId\":\"%s\","
        "\"tileIndex\":%d,"
        "\"elevation\":%d,"
        "\"rotation\":%d,"
        "\"currentHp\":%d,"
        "\"maxHp\":%d,"
        "\"currentAp\":%d,"
        "\"maxAp\":%d,"
        "\"isDead\":%s}",
        state->participant_id,
        state->tile_index,
        state->elevation,
        state->rotation,
        state->current_hp,
        state->max_hp,
        state->current_ap,
        state->max_ap,
        state->is_dead ? "true" : "false");

    send_message(json);
}

void mp_send_action(const PlayerAction* action) {
    if (!mp_active || !action) return;

    char json[512];

    if (strcmp(action->type, "move") == 0) {
        snprintf(json, sizeof(json),
            "{\"type\":\"action\",\"action\":\"move\",\"targetTile\":%d}",
            action->target_tile);
    } else if (strcmp(action->type, "attack") == 0) {
        snprintf(json, sizeof(json),
            "{\"type\":\"action\",\"action\":\"attack\","
            "\"targetId\":\"%s\",\"weaponMode\":\"%s\",\"aimedLocation\":\"%s\"}",
            action->target_id, action->weapon_mode, action->aimed_location);
    } else if (strcmp(action->type, "use-item") == 0) {
        snprintf(json, sizeof(json),
            "{\"type\":\"action\",\"action\":\"use-item\","
            "\"itemId\":\"%s\",\"targetId\":\"%s\"}",
            action->item_id, action->target_id);
    } else if (strcmp(action->type, "end-turn") == 0) {
        snprintf(json, sizeof(json), "{\"type\":\"action\",\"action\":\"end-turn\"}");
    }

    send_message(json);
}

bool mp_poll_message(void) {
    if (!mp_active) return false;
    return receive_messages();
}

const char* mp_get_current_turn_player(void) {
    return current_turn_player[0] ? current_turn_player : NULL;
}

void mp_set_turn_start_callback(mp_turn_start_callback cb) {
    on_turn_start = cb;
}

void mp_set_remote_action_callback(mp_remote_action_callback cb) {
    on_remote_action = cb;
}

void mp_set_player_state_callback(mp_player_state_callback cb) {
    on_player_state = cb;
}

// Internal functions

static bool connect_to_pipe(const char* pipe_name) {
    // Wait for pipe to be available
    if (!WaitNamedPipeA(pipe_name, 5000)) {
        return false;
    }

    pipe_handle = CreateFileA(
        pipe_name,
        GENERIC_READ | GENERIC_WRITE,
        0,
        NULL,
        OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED,
        NULL);

    if (pipe_handle == INVALID_HANDLE_VALUE) {
        return false;
    }

    // Set to message mode
    DWORD mode = PIPE_READMODE_BYTE;
    SetNamedPipeHandleState(pipe_handle, &mode, NULL, NULL);

    return true;
}

static void disconnect_pipe(void) {
    if (pipe_handle != INVALID_HANDLE_VALUE) {
        CloseHandle(pipe_handle);
        pipe_handle = INVALID_HANDLE_VALUE;
    }
}

static bool send_message(const char* json) {
    if (pipe_handle == INVALID_HANDLE_VALUE) return false;

    char buffer[MSG_BUFFER_SIZE];
    int len = snprintf(buffer, sizeof(buffer), "%s\n", json);

    DWORD written;
    return WriteFile(pipe_handle, buffer, len, &written, NULL) && written == (DWORD)len;
}

static bool receive_messages(void) {
    if (pipe_handle == INVALID_HANDLE_VALUE) return false;

    // Check if data available
    DWORD available = 0;
    if (!PeekNamedPipe(pipe_handle, NULL, 0, NULL, &available, NULL) || available == 0) {
        return false;
    }

    // Read available data
    char temp[1024];
    DWORD bytes_read;
    if (!ReadFile(pipe_handle, temp, sizeof(temp) - 1, &bytes_read, NULL)) {
        return false;
    }

    temp[bytes_read] = '\0';

    // Append to buffer and process complete messages
    for (DWORD i = 0; i < bytes_read; i++) {
        if (temp[i] == '\n') {
            msg_buffer[msg_buffer_pos] = '\0';
            if (msg_buffer_pos > 0) {
                process_message(msg_buffer);
            }
            msg_buffer_pos = 0;
        } else if (msg_buffer_pos < MSG_BUFFER_SIZE - 1) {
            msg_buffer[msg_buffer_pos++] = temp[i];
        }
    }

    return true;
}

// Simple JSON parsing helpers (minimal implementation)
static const char* json_get_string(const char* json, const char* key, char* out, int out_size) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":\"", key);
    const char* start = strstr(json, search);
    if (!start) return NULL;

    start += strlen(search);
    const char* end = strchr(start, '"');
    if (!end) return NULL;

    int len = (int)(end - start);
    if (len >= out_size) len = out_size - 1;
    strncpy(out, start, len);
    out[len] = '\0';
    return out;
}

static int json_get_int(const char* json, const char* key, int default_val) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char* start = strstr(json, search);
    if (!start) return default_val;

    start += strlen(search);
    return atoi(start);
}

static bool json_get_bool(const char* json, const char* key, bool default_val) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char* start = strstr(json, search);
    if (!start) return default_val;

    start += strlen(search);
    while (*start == ' ') start++;
    return strncmp(start, "true", 4) == 0;
}

static void process_message(const char* json) {
    char type[32] = {0};
    json_get_string(json, "type", type, sizeof(type));

    if (strcmp(type, "turn-start") == 0) {
        char player_id[64];
        json_get_string(json, "participantId", player_id, sizeof(player_id));
        int time_limit = json_get_int(json, "timeLimit", 30);

        strncpy(current_turn_player, player_id, sizeof(current_turn_player) - 1);
        is_my_turn = strcmp(player_id, mp_session.participant_id) == 0;

        if (on_turn_start) {
            on_turn_start(player_id, time_limit);
        }
    } else if (strcmp(type, "remote-action") == 0) {
        PlayerAction action = {0};
        json_get_string(json, "action", action.type, sizeof(action.type));
        action.target_tile = json_get_int(json, "targetTile", 0);
        json_get_string(json, "targetId", action.target_id, sizeof(action.target_id));
        json_get_string(json, "weaponMode", action.weapon_mode, sizeof(action.weapon_mode));
        json_get_string(json, "aimedLocation", action.aimed_location, sizeof(action.aimed_location));
        json_get_string(json, "itemId", action.item_id, sizeof(action.item_id));

        if (on_remote_action) {
            on_remote_action(&action);
        }
    } else if (strcmp(type, "player-state") == 0) {
        PlayerState state = {0};
        json_get_string(json, "participantId", state.participant_id, sizeof(state.participant_id));
        state.tile_index = json_get_int(json, "tileIndex", 0);
        state.elevation = json_get_int(json, "elevation", 0);
        state.rotation = json_get_int(json, "rotation", 0);
        state.current_hp = json_get_int(json, "currentHp", 0);
        state.max_hp = json_get_int(json, "maxHp", 0);
        state.current_ap = json_get_int(json, "currentAp", 0);
        state.max_ap = json_get_int(json, "maxAp", 0);
        state.is_dead = json_get_bool(json, "isDead", false);

        if (on_player_state) {
            on_player_state(&state);
        }
    }
}
