#ifndef MULTIPLAYER_H
#define MULTIPLAYER_H

#include <stdbool.h>

// Multiplayer IPC interface
// Communicates with the Electron launcher via named pipe

#ifdef __cplusplus
extern "C" {
#endif

// Session info passed from launcher
typedef struct {
    char session_id[64];
    char participant_id[64];
    char pipe_name[256];
    bool is_host;
} MultiplayerSession;

// Player state to sync
typedef struct {
    char participant_id[64];
    int tile_index;
    int elevation;
    int rotation;
    int current_hp;
    int max_hp;
    int current_ap;
    int max_ap;
    bool is_dead;
} PlayerState;

// Combat action
typedef struct {
    char type[32];        // "move", "attack", "use-item", "end-turn"
    int target_tile;
    char target_id[64];
    char weapon_mode[16]; // "single", "burst", "aimed"
    char aimed_location[16];
    char item_id[32];
} PlayerAction;

// Initialize multiplayer subsystem
// Returns true if running in multiplayer mode
bool mp_init(int argc, char** argv);

// Cleanup multiplayer subsystem
void mp_exit(void);

// Check if running in multiplayer mode
bool mp_is_active(void);

// Check if it's the local player's turn
bool mp_is_my_turn(void);

// Get session info
const MultiplayerSession* mp_get_session(void);

// Send local player state to launcher
void mp_send_state(const PlayerState* state);

// Send player action to launcher
void mp_send_action(const PlayerAction* action);

// Poll for incoming messages from launcher
// Returns true if a message was received
bool mp_poll_message(void);

// Get the current turn player ID (NULL if not in combat)
const char* mp_get_current_turn_player(void);

// Callbacks from launcher
typedef void (*mp_turn_start_callback)(const char* player_id, int time_limit);
typedef void (*mp_remote_action_callback)(const PlayerAction* action);
typedef void (*mp_player_state_callback)(const PlayerState* state);

void mp_set_turn_start_callback(mp_turn_start_callback cb);
void mp_set_remote_action_callback(mp_remote_action_callback cb);
void mp_set_player_state_callback(mp_player_state_callback cb);

#ifdef __cplusplus
}
#endif

#endif // MULTIPLAYER_H
