import { supabase, isSupabaseEnabled } from './supabase-client.js';

/**
 * WebRTC Room Manager - Handles room persistence in Supabase
 */
class WebRTCRoomManager {
  constructor() {
    this.enabled = isSupabaseEnabled();
    if (!this.enabled) {
      console.warn('[RoomManager] Supabase not configured. Room persistence disabled.');
    }
  }

  /**
   * Save or update a WebRTC room in Supabase
   * @param {Object} roomData - Room data to save
   * @param {string} roomData.roomId - Unique room identifier
   * @param {string} roomData.desktopId - Desktop/server socket ID
   * @param {string} roomData.deviceName - Name of the desktop device
   * @param {string} roomData.signalingServer - Signaling server URL
   * @param {string} [roomData.userId] - User ID (optional, for authenticated users)
   * @param {Object} [roomData.transferState] - Transfer state for resuming
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveRoom(roomData) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('webrtc_rooms')
        .upsert({
          room_id: roomData.roomId,
          desktop_id: roomData.desktopId,
          device_name: roomData.deviceName,
          signaling_server: roomData.signalingServer,
          user_id: roomData.userId || null,
          status: 'active',
          desktop_online: true,
          last_heartbeat_at: new Date().toISOString(),
          transfer_state: roomData.transferState || null,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
        }, {
          onConflict: 'room_id'
        })
        .select()
        .single();

      if (error) {
        console.error('[RoomManager] Error saving room:', error);
        return { success: false, error: error.message };
      }

      console.log('[RoomManager] Room saved:', roomData.roomId);
      return { success: true, data };
    } catch (err) {
      console.error('[RoomManager] Unexpected error saving room:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update room heartbeat to keep it alive
   * @param {string} roomId - Room ID
   * @param {boolean} desktopOnline - Whether desktop is online
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateHeartbeat(roomId, desktopOnline = true) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { error } = await supabase
        .from('webrtc_rooms')
        .update({
          last_heartbeat_at: new Date().toISOString(),
          desktop_online: desktopOnline,
          status: desktopOnline ? 'active' : 'disconnected'
        })
        .eq('room_id', roomId);

      if (error) {
        console.error('[RoomManager] Error updating heartbeat:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('[RoomManager] Unexpected error updating heartbeat:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update transfer state for a room
   * @param {string} roomId - Room ID
   * @param {Object} transferState - Transfer state object
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateTransferState(roomId, transferState) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { error } = await supabase
        .from('webrtc_rooms')
        .update({ transfer_state: transferState })
        .eq('room_id', roomId);

      if (error) {
        console.error('[RoomManager] Error updating transfer state:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('[RoomManager] Unexpected error updating transfer state:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get room by ID
   * @param {string} roomId - Room ID
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async getRoom(roomId) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('webrtc_rooms')
        .select('*')
        .eq('room_id', roomId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          return { success: true, data: null };
        }
        console.error('[RoomManager] Error getting room:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (err) {
      console.error('[RoomManager] Unexpected error getting room:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get the most recent active room for the current user
   * @param {string} [userId] - User ID (optional)
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async getMostRecentRoom(userId = null) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      let query = supabase
        .from('webrtc_rooms')
        .select('*')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('updated_at', { ascending: false })
        .limit(1);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error('[RoomManager] Error getting recent room:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (err) {
      console.error('[RoomManager] Unexpected error getting recent room:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Mark a room as disconnected
   * @param {string} roomId - Room ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async markDisconnected(roomId) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { error } = await supabase
        .from('webrtc_rooms')
        .update({
          status: 'disconnected',
          desktop_online: false
        })
        .eq('room_id', roomId);

      if (error) {
        console.error('[RoomManager] Error marking room disconnected:', error);
        return { success: false, error: error.message };
      }

      console.log('[RoomManager] Room marked as disconnected:', roomId);
      return { success: true };
    } catch (err) {
      console.error('[RoomManager] Unexpected error marking disconnected:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete a room
   * @param {string} roomId - Room ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteRoom(roomId) {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { error } = await supabase
        .from('webrtc_rooms')
        .delete()
        .eq('room_id', roomId);

      if (error) {
        console.error('[RoomManager] Error deleting room:', error);
        return { success: false, error: error.message };
      }

      console.log('[RoomManager] Room deleted:', roomId);
      return { success: true };
    } catch (err) {
      console.error('[RoomManager] Unexpected error deleting room:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Cleanup expired rooms
   * @returns {Promise<{success: boolean, deletedCount?: number, error?: string}>}
   */
  async cleanupExpired() {
    if (!this.enabled) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const { data, error } = await supabase.rpc('cleanup_expired_webrtc_rooms');

      if (error) {
        console.error('[RoomManager] Error cleaning up expired rooms:', error);
        return { success: false, error: error.message };
      }

      console.log('[RoomManager] Cleaned up expired rooms:', data);
      return { success: true, deletedCount: data };
    } catch (err) {
      console.error('[RoomManager] Unexpected error cleaning up:', err);
      return { success: false, error: err.message };
    }
  }
}

// Export singleton instance
export default new WebRTCRoomManager();
