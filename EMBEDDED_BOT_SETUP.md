# Embedded Bot-Runner Setup Complete ✅

## What Changed

The bot-runner is now **embedded** within the backend application as a managed subprocess. The architecture has been simplified:

### Before
```
services/
├── backend/          # Python FastAPI (port 8000)
├── bot-runner/       # Separate Node.js service (port 3001)
└── frontend/         # React app
```

### After
```
services/
├── backend/
│   ├── app/
│   │   ├── bot_runner/        # NEW: Python manager for Node.js subprocess
│   │   │   ├── __init__.py
│   │   │   └── manager.py     # Subprocess management logic
│   │   └── api/
│   │       └── meetings.py    # Updated to use bot_runner_manager
│   ├── bot-runner/            # MOVED: Node.js bot-runner code
│   │   ├── src/
│   │   ├── node_modules/
│   │   └── package.json
│   └── main.py                # Updated with shutdown handler
└── frontend/
```

## Key Features

### 1. **On-Demand Startup** 
- Bot-runner process starts automatically when the first meeting join request is received
- No need to manually start the bot-runner service

### 2. **Automatic Lifecycle Management**
- Backend starts → bot-runner NOT running (saves resources)
- First `/meetings/join` request → bot-runner starts automatically
- Backend shuts down → bot-runner stops gracefully

### 3. **Health Monitoring**
- Automatic health checks before making requests
- Process crash detection
- Subprocess output logging for debugging

### 4. **Centralized Configuration**
- Single `.env` file in `services/backend/` for both Python and Node.js
- Environment variables automatically inherited by bot-runner subprocess

## Files Modified

### New Files
1. `services/backend/app/bot_runner/__init__.py` - Package initialization
2. `services/backend/app/bot_runner/manager.py` - Subprocess manager (150 lines)

### Modified Files
1. `services/backend/app/api/meetings.py` - Added bot-runner manager integration
2. `services/backend/main.py` - Added shutdown handler
3. `services/backend/bot-runner/src/shared/config/index.js` - Updated .env path

### Moved
1. `services/bot-runner/` → `services/backend/bot-runner/`

## How It Works

```python
# In meetings.py - /meetings/join endpoint
bot_runner_manager.ensure_running()  # Start if not running
# Then make HTTP request to http://localhost:3001/join
```

The `BotRunnerManager`:
- Uses Python's `subprocess.Popen` to spawn Node.js process
- Sets working directory to `services/backend/bot-runner/`
- Runs: `node src/index.js --headless`
- Monitors process health via HTTP `/health` endpoint
- Automatically stops on backend shutdown

## Testing the Integration

### 1. Start the backend
```bash
cd services/backend
python main.py
```

Expected output:
```
🚀 Starting AI Meeting Notetaker...
✅ Database tables created/verified
📦 Bot-runner will start on-demand when first meeting is joined
```

### 2. Make a meeting join request
```bash
curl -X POST http://localhost:8000/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"meeting_url": "https://..."}'
```

Expected backend logs:
```
🚀 JOIN REQUEST received
🔄 Bot-runner not running, starting on-demand...
🚀 Starting bot-runner subprocess...
📦 Bot-runner process started (PID: 12345)
⏳ Waiting 5s for bot-runner to initialize...
✅ Bot-runner is ready and responding
✅ Bot successfully joined meeting
```

### 3. Verify bot-runner is running
```bash
curl http://localhost:3001/health
```

### 4. Stop the backend (Ctrl+C)
Expected output:
```
🛑 Shutting down AI Meeting Notetaker...
🛑 Stopping bot-runner subprocess...
✅ Bot-runner stopped gracefully
✅ Cleanup complete
```

## Troubleshooting

### Error: "node_modules not found"
```bash
cd services/backend/bot-runner
npm install
```

### Error: "Bot-runner started but not responding"
Check bot-runner logs in the backend output. The manager captures subprocess stdout/stderr.

### Error: "Bot-runner service failed to start"
- Verify Node.js is installed: `node --version`
- Check .env file has required variables (see below)
- Look for subprocess output in backend logs

## Migration Notes

- The old `services/bot-runner/` directory has been moved (not deleted)
- Bot-runner still runs on port 3001 and uses the same API
- No changes to bot-runner's internal logic or Webex integration
- Frontend doesn't need any changes

