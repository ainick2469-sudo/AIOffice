"""Clean ALL old messages, tool logs, and smoke data from the database."""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ai_office.db")

def main():
    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Count before
    msg_count = cur.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    tool_count = cur.execute("SELECT COUNT(*) FROM tool_logs").fetchone()[0]
    decision_count = cur.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
    task_count = cur.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]

    print(f"Before cleanup:")
    print(f"  Messages:  {msg_count}")
    print(f"  Tool logs: {tool_count}")
    print(f"  Decisions: {decision_count}")
    print(f"  Tasks:     {task_count}")
    print()

    # Delete everything
    cur.execute("DELETE FROM messages")
    cur.execute("DELETE FROM tool_logs")
    cur.execute("DELETE FROM decisions")
    cur.execute("DELETE FROM tasks")

    # Also clean reactions and build_results if they exist
    for table in ["reactions", "build_results"]:
        try:
            cur.execute(f"DELETE FROM {table}")
        except sqlite3.OperationalError:
            pass

    conn.commit()

    print("Deleted ALL messages, tool logs, decisions, tasks, reactions, and build results.")
    print("Database is clean. Restart the app for a fresh start.")

    conn.close()

if __name__ == "__main__":
    main()
