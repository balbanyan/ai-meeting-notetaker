"""
Bot Runner Manager Package
Manages the embedded Node.js bot-runner subprocess
"""

from app.bot_runner.manager import BotRunnerManager, bot_runner_manager

__all__ = ["BotRunnerManager", "bot_runner_manager"]

