import sys, os
os.chdir(r'C:\AI_WORKSPACE\ai-office')
sys.path.insert(0, r'C:\AI_WORKSPACE\ai-office')

print("Testing imports...")
try:
    from server import database
    print("  database.py: OK")
except Exception as e:
    print(f"  database.py: FAIL - {e}")

try:
    from server import models
    print("  models.py: OK")
except Exception as e:
    print(f"  models.py: FAIL - {e}")

try:
    from server import tool_executor
    print("  tool_executor.py: OK")
except Exception as e:
    print(f"  tool_executor.py: FAIL - {e}")

try:
    from server import routes_api
    print("  routes_api.py: OK")
except Exception as e:
    print(f"  routes_api.py: FAIL - {e}")

try:
    from server import agent_engine
    print("  agent_engine.py: OK")
except Exception as e:
    print(f"  agent_engine.py: FAIL - {e}")

try:
    from server import build_runner
    print("  build_runner.py: OK")
except Exception as e:
    print(f"  build_runner.py: FAIL - {e}")

try:
    from server import project_manager
    print("  project_manager.py: OK")
except Exception as e:
    print(f"  project_manager.py: FAIL - {e}")

print("\nDone.")
