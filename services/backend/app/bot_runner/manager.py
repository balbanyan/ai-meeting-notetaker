"""
Bot Runner Process Manager
Manages the Node.js bot-runner as an embedded subprocess
"""

import subprocess
import os
import time
import httpx
import atexit
from pathlib import Path
from typing import Optional


class BotRunnerManager:
    """Manages the bot-runner Node.js subprocess"""
    
    _instance: Optional['BotRunnerManager'] = None
    
    def __new__(cls):
        """Singleton pattern to ensure only one bot-runner process"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        """Initialize the bot-runner manager"""
        if self._initialized:
            return
            
        self.process: Optional[subprocess.Popen] = None
        self.bot_runner_url = "http://localhost:3001"
        self.startup_wait_seconds = 15  # Increased for Puppeteer browser launch
        self.health_check_timeout = 5.0  # Increased for initial health check
        
        # Determine bot-runner directory path (relative to backend/app/)
        backend_dir = Path(__file__).parent.parent.parent
        self.bot_runner_dir = backend_dir / "bot-runner"
        
        # Register cleanup on exit
        atexit.register(self.stop)
        
        self._initialized = True
        print("🔧 BotRunnerManager initialized")
    
    def is_running(self) -> bool:
        """Check if bot-runner process is running and healthy"""
        # Check if process exists and hasn't terminated
        if self.process is None:
            return False
        
        if self.process.poll() is not None:
            # Process has terminated
            print(f"⚠️ Bot-runner process terminated with code {self.process.returncode}")
            self.process = None
            return False
        
        # Check if bot-runner API is responding
        try:
            response = httpx.get(
                f"{self.bot_runner_url}/health",
                timeout=self.health_check_timeout
            )
            return response.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False
        except Exception as e:
            print(f"⚠️ Health check error: {e}")
            return False
    
    def start(self) -> bool:
        """Start the bot-runner subprocess"""
        if self.is_running():
            print("✅ Bot-runner already running")
            return True
        
        try:
            print("🚀 Starting bot-runner subprocess...")
            
            # Verify bot-runner directory exists
            if not self.bot_runner_dir.exists():
                raise FileNotFoundError(f"Bot-runner directory not found: {self.bot_runner_dir}")
            
            # Verify node_modules exists
            node_modules = self.bot_runner_dir / "node_modules"
            if not node_modules.exists():
                raise FileNotFoundError(
                    f"node_modules not found in {self.bot_runner_dir}. "
                    f"Run 'npm install' in the bot-runner directory."
                )
            
            # Start Node.js process in headless mode
            # Use node directly to run src/index.js with --headless flag
            self.process = subprocess.Popen(
                ["node", "src/index.js", "--headless"],
                cwd=str(self.bot_runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,  # Merge stderr into stdout for easier capture
                text=True,
                bufsize=0,  # Unbuffered for immediate output
                env={**os.environ}  # Inherit environment variables
            )
            
            print(f"📦 Bot-runner process started (PID: {self.process.pid})")
            
            # Wait for bot-runner to be ready with retry logic
            print(f"⏳ Waiting up to {self.startup_wait_seconds}s for bot-runner to initialize...")
            max_attempts = self.startup_wait_seconds  # Try every second
            
            for attempt in range(max_attempts):
                time.sleep(1)
                
                # Check if process crashed
                if self.process.poll() is not None:
                    print(f"❌ Bot-runner process crashed with code {self.process.returncode}")
                    self._print_process_output()
                    return False
                
                # Check if API is responding
                if self.is_running():
                    print(f"✅ Bot-runner is ready and responding (took {attempt + 1}s)")
                    return True
                    
                if attempt % 3 == 0 and attempt > 0:
                    print(f"⏳ Still waiting... ({attempt}/{max_attempts}s)")
            
            # Timeout - not responding
            print("❌ Bot-runner started but not responding to health checks after timeout")
            print(f"⚠️ Process poll status: {self.process.poll()}")
            self._print_process_output()
            self.stop()
            return False
                
        except FileNotFoundError as e:
            print(f"❌ Bot-runner startup failed: {e}")
            return False
        except Exception as e:
            print(f"❌ Failed to start bot-runner: {e}")
            if self.process:
                self._print_process_output()
                self.stop()
            return False
    
    def stop(self) -> None:
        """Stop the bot-runner subprocess gracefully"""
        if self.process is None:
            return
        
        try:
            print("🛑 Stopping bot-runner subprocess...")
            
            # Try graceful termination first
            self.process.terminate()
            
            try:
                # Wait up to 5 seconds for graceful shutdown
                self.process.wait(timeout=5)
                print("✅ Bot-runner stopped gracefully")
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't stop gracefully
                print("⚠️ Bot-runner didn't stop gracefully, forcing kill...")
                self.process.kill()
                self.process.wait()
                print("✅ Bot-runner killed")
                
        except Exception as e:
            print(f"⚠️ Error stopping bot-runner: {e}")
        finally:
            self.process = None
    
    def ensure_running(self) -> bool:
        """Ensure bot-runner is running, start if needed"""
        if self.is_running():
            return True
        
        print("🔄 Bot-runner not running, starting on-demand...")
        return self.start()
    
    def _print_process_output(self) -> None:
        """Print recent stdout/stderr from the process for debugging"""
        if self.process is None:
            print("⚠️ No process to read output from")
            return
        
        try:
            # Read all available output
            if self.process.stdout:
                try:
                    # Set non-blocking
                    import fcntl
                    import os
                    fd = self.process.stdout.fileno()
                    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
                    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
                    
                    stdout = self.process.stdout.read()
                    if stdout:
                        print("📋 Bot-runner output:")
                        print(stdout)
                    else:
                        print("📋 Bot-runner output: (empty)")
                except:
                    # If non-blocking fails, try blocking read with timeout
                    print("📋 Attempting to read output (this might hang)...")
                    stdout = self.process.stdout.readline()
                    if stdout:
                        print(f"📋 Bot-runner output: {stdout}")
        except Exception as e:
            print(f"⚠️ Could not read process output: {e}")


# Global singleton instance
bot_runner_manager = BotRunnerManager()

