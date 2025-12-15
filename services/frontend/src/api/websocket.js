// WebSocket client for real-time meeting updates
// Uses relative URLs - nginx handles routing to backend

// Determine WebSocket protocol based on current page protocol
const getWebSocketUrl = (path) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}${path}`
}

/**
 * WebSocket manager for real-time meeting updates.
 * Handles connection, reconnection, and event subscriptions.
 */
export class MeetingWebSocket {
  constructor(meetingId) {
    this.meetingId = meetingId
    this.ws = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 2000 // Start with 2 seconds
    this.eventHandlers = {
      transcript: [],
      status: [],
      summary: [],
      connected: [],
      disconnected: [],
      error: []
    }
    this.isManualClose = false
    this.isConnected = false
    
    console.log(`🔌 WebSocket Manager created for meeting: ${meetingId}`)
  }
  
  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log('⚠️ WebSocket already connecting or connected')
      return
    }
    
    try {
      const url = getWebSocketUrl(`/ws/meeting/${this.meetingId}`)
      console.log(`🔌 Connecting to WebSocket: ${url}`)
      
      this.ws = new WebSocket(url)
      
      this.ws.onopen = () => {
        console.log(`✅ WebSocket connected to meeting ${this.meetingId}`)
        this.isConnected = true
        this.reconnectAttempts = 0
        this.reconnectDelay = 2000
        this.triggerEvent('connected', { meetingId: this.meetingId })
      }
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          console.log('📩 WebSocket message received:', message.type)
          
          switch (message.type) {
            case 'transcript':
              this.triggerEvent('transcript', message.data)
              break
            case 'status':
              this.triggerEvent('status', message.data)
              break
            case 'summary':
              this.triggerEvent('summary', message.data)
              break
            case 'connected':
              // Initial connection confirmation
              console.log('🎉 WebSocket connection confirmed:', message.data)
              break
            case 'pong':
              // Heartbeat response
              break
            default:
              console.log('Unknown message type:', message.type)
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }
      
      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error)
        this.triggerEvent('error', { error, meetingId: this.meetingId })
      }
      
      this.ws.onclose = (event) => {
        console.log(`🔌 WebSocket closed for meeting ${this.meetingId}`, event.code, event.reason)
        this.isConnected = false
        this.triggerEvent('disconnected', { meetingId: this.meetingId })
        
        // Attempt reconnection if not manually closed
        if (!this.isManualClose) {
          this.attemptReconnect()
        }
      }
      
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      this.triggerEvent('error', { error, meetingId: this.meetingId })
    }
  }
  
  /**
   * Attempt to reconnect with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached for meeting ${this.meetingId}`)
      return
    }
    
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1)
    
    console.log(`🔄 Reconnecting to meeting ${this.meetingId} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    
    setTimeout(() => {
      if (!this.isManualClose) {
        this.connect()
      }
    }, delay)
  }
  
  /**
   * Send a message to the server (e.g., ping for keepalive)
   */
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof message === 'string' ? message : JSON.stringify(message))
    } else {
      console.warn('Cannot send message - WebSocket not connected')
    }
  }
  
  /**
   * Send ping to keep connection alive
   */
  ping() {
    this.send('ping')
  }
  
  /**
   * Register event handler
   */
  on(eventType, handler) {
    if (this.eventHandlers[eventType]) {
      this.eventHandlers[eventType].push(handler)
    } else {
      console.warn(`Unknown event type: ${eventType}`)
    }
  }
  
  /**
   * Unregister event handler
   */
  off(eventType, handler) {
    if (this.eventHandlers[eventType]) {
      this.eventHandlers[eventType] = this.eventHandlers[eventType].filter(h => h !== handler)
    }
  }
  
  /**
   * Trigger event handlers
   */
  triggerEvent(eventType, data) {
    if (this.eventHandlers[eventType]) {
      this.eventHandlers[eventType].forEach(handler => {
        try {
          handler(data)
        } catch (error) {
          console.error(`Error in ${eventType} handler:`, error)
        }
      })
    }
  }
  
  /**
   * Disconnect and cleanup
   */
  disconnect() {
    console.log(`🔌 Disconnecting WebSocket for meeting ${this.meetingId}`)
    this.isManualClose = true
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    this.isConnected = false
  }
  
  /**
   * Check if WebSocket is currently connected
   */
  getConnectionState() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN
  }
}

/**
 * Create and connect to a meeting WebSocket
 * @param {string} meetingId - Meeting UUID or Webex meeting ID
 * @param {Object} handlers - Event handlers { onTranscript, onStatus, onSummary, onConnected, onDisconnected, onError }
 * @returns {MeetingWebSocket} WebSocket instance
 */
export function connectToMeeting(meetingId, handlers = {}) {
  const ws = new MeetingWebSocket(meetingId)
  
  // Register handlers
  if (handlers.onTranscript) ws.on('transcript', handlers.onTranscript)
  if (handlers.onStatus) ws.on('status', handlers.onStatus)
  if (handlers.onSummary) ws.on('summary', handlers.onSummary)
  if (handlers.onConnected) ws.on('connected', handlers.onConnected)
  if (handlers.onDisconnected) ws.on('disconnected', handlers.onDisconnected)
  if (handlers.onError) ws.on('error', handlers.onError)
  
  // Connect
  ws.connect()
  
  // Optional: Setup ping interval to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.getConnectionState()) {
      ws.ping()
    }
  }, 30000) // Ping every 30 seconds
  
  // Store interval ID for cleanup
  ws.pingInterval = pingInterval
  
  // Override disconnect to also clear interval
  const originalDisconnect = ws.disconnect.bind(ws)
  ws.disconnect = () => {
    clearInterval(pingInterval)
    originalDisconnect()
  }
  
  return ws
}

export default { MeetingWebSocket, connectToMeeting }

