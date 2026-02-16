import sqlite3, os
db = r'C:\AI_WORKSPACE\ai-office\data\office.db'
print(f"DB exists: {os.path.exists(db)}")
conn = sqlite3.connect(db)
c = conn.cursor()

tables = [t[0] for t in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print(f"\nTables: {tables}\n")
for t in tables:
    count = c.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    print(f"  {t}: {count} rows")

print("\nCleaning ALL data...")
for t in ["messages", "tool_logs", "decisions", "tasks", "reactions", "build_results", "api_usage"]:
    if t in tables:
        c.execute(f"DELETE FROM [{t}]")
        print(f"  Cleared {t}")

conn.commit()
conn.close()
print("\nDone! Database is clean.")
